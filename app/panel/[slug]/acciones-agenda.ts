"use server";

// app/panel/[slug]/acciones-agenda.ts — lo que la agenda ESCRIBE.
//
// Estaba intercalado entre el marcado de una pantalla de seiscientas líneas, y es la parte con
// reglas de permisos: cuál de los dos caminos toma cada acción según el rol, y por qué. Eso no
// puede vivir enterrado entre etiquetas — es lo primero que hay que poder leer entero.
//
// Cada función recibe el contexto explícito (slug, vista, fecha) en vez de capturarlo del
// entorno. Una server action serializa TODO lo que captura, así que capturar poco es también lo
// que la mantiene liviana.
//
// El patrón que se repite en las cuatro: DOS caminos según el rol, no uno con un `if` adentro. El
// del profesional no acepta el id de otro; si lo tomara del formulario, un campo oculto cambiado
// en el navegador alcanzaría para operar a nombre ajeno y el permiso no lo frenaría — la acción
// parecería legítima.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actorDeSesion } from "../../../src/lib/sesion.ts";
import { puede } from "../../../src/lib/permisos.ts";
import {
  cancelarReservaAjena,
  cancelarReservaPropia,
  crearReservaAjena,
  crearReservaPropia,
  mensajeDeMovimiento,
  moverReservaAjena,
  moverReservaPropia,
  noShowReservaAjena,
} from "../../../src/servicios/agenda/acciones.ts";
import { resumirConflictos, serializarConflictos } from "../../../src/dominio/conflictos.ts";
import type { Vista } from "../../../src/dominio/calendario.ts";

/** Lo que cada acción necesita saber de la pantalla desde la que se disparó. */
export type CtxAgenda = { slug: string; vista: Vista; fecha: string; salas?: string };

/** La vuelta a la agenda conservando lo que se estaba mirando. */
function volver(ctx: CtxAgenda, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ fecha: ctx.fecha, vista: ctx.vista, ...extra });
  if (ctx.salas) q.set("salas", ctx.salas);
  return `/panel/${ctx.slug}?${q.toString()}`;
}

export async function crearTurno(ctx: CtxAgenda, formData: FormData): Promise<void> {
  const actor = await actorDeSesion(ctx.slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(ctx.slug)}`);

  const fecha = String(formData.get("fecha") ?? "");
  const comun = {
    salaId: formData.get("salaId"),
    fecha,
    hora: formData.get("hora"),
    duracionMin: formData.get("duracionMin"),
    repeticion: formData.get("repeticion") ?? "no",
  };
  const r = puede(actor.rol, "reserva.crear.ajena")
    ? await crearReservaAjena(actor, { ...comun, inquilinoId: formData.get("inquilinoId") })
    : await crearReservaPropia(actor, comun);

  const q = new URLSearchParams({ fecha, vista: ctx.vista });
  if (!r.ok) q.set("error", r.error); // SIN_PERMISO / ENTRADA_INVALIDA (del envoltorio)
  else if (!r.data.ok) q.set("error", r.data.error); // SLOT_OCUPADO, FUERA_DE_HORARIO, …
  else {
    q.set("creada", String(r.data.creadas));
    // Las ocurrencias que no entraron viajan con FECHA Y MOTIVO, no como un número. "3 fechas
    // quedaron afuera" obliga a recorrer la agenda a mano buscando cuáles; el motor ya sabe que
    // fue el lunes 17 y que ese consultorio lo tenía otro profesional (§4.9).
    if (r.data.conflictos.length > 0) {
      q.set("chocaron", String(r.data.conflictos.length));
      q.set("dias", serializarConflictos(resumirConflictos(r.data.conflictos)));
    }
  }

  revalidatePath(`/panel/${ctx.slug}`);
  redirect(`/panel/${ctx.slug}?${q.toString()}`);
}

/**
 * Editar un turno desde su detalle: día, hora o consultorio.
 *
 * Usa el MISMO servicio que arrastrar el bloque —no hay un segundo camino con otras reglas— pero
 * viene de un formulario, así que redirige. Arrastrar no existe en el teléfono, que es justo
 * donde se agenda apurado.
 */
export async function editarTurno(ctx: CtxAgenda, formData: FormData): Promise<void> {
  const actor = await actorDeSesion(ctx.slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(ctx.slug)}`);

  const ocupacionId = String(formData.get("ocupacionId") ?? "");
  const entrada = {
    ocupacionId,
    salaDestinoId: formData.get("salaDestinoId"),
    fecha: formData.get("fecha"),
    hora: formData.get("hora"),
  };
  const r = puede(actor.rol, "reserva.editar.ajena")
    ? await moverReservaAjena(actor, entrada)
    : await moverReservaPropia(actor, entrada);

  const codigo = !r.ok ? r.error : r.data.ok ? null : r.data.error;
  revalidatePath(`/panel/${ctx.slug}`);
  // Con error el detalle sigue abierto: el mensaje sin el turno adelante no se entiende.
  redirect(
    volver(
      { ...ctx, fecha: String(formData.get("fecha") ?? ctx.fecha) },
      codigo ? { turno: ocupacionId, errorTurno: codigo } : {},
    ),
  );
}

/**
 * Mover arrastrando. A diferencia del resto NO redirige: la grilla ya movió el bloque en pantalla
 * y un redirect volvería a montar todo. Devuelve el resultado y la grilla decide si avisa; el
 * revalidate deja la agenda del servidor como fuente de verdad.
 */
export async function moverArrastrando(
  ctx: CtxAgenda,
  input: { ocupacionId: string; salaDestinoId: string; fecha: string; hora: string },
): Promise<{ ok: boolean; mensaje: string }> {
  const actor = await actorDeSesion(ctx.slug);
  if (!actor) return { ok: false, mensaje: mensajeDeMovimiento("SIN_PERMISO") };

  const r = await moverReservaAjena(actor, input);
  const codigo = !r.ok ? r.error : r.data.ok ? null : r.data.error;
  if (codigo) return { ok: false, mensaje: mensajeDeMovimiento(codigo) };

  revalidatePath(`/panel/${ctx.slug}`);
  return { ok: true, mensaje: "" };
}

/**
 * Cancelar un turno, o marcarlo como ausente.
 *
 * Cancelar tiene dos caminos por el mismo motivo que crear. Marcar no-show NO tiene versión
 * propia: que alguien declare que no vino a su propio turno para no pagarlo no es una función, es
 * un agujero.
 */
export async function sobreTurno(
  cual: "cancelar" | "noShow",
  ctx: CtxAgenda,
  fd: FormData,
): Promise<void> {
  const actor = await actorDeSesion(ctx.slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(ctx.slug)}`);

  const ocupacionId = String(fd.get("ocupacionId") ?? "");
  const puedeAjena = puede(actor.rol, "reserva.editar.ajena");
  const r =
    cual === "cancelar"
      ? puedeAjena
        ? await cancelarReservaAjena(actor, { ocupacionId, alcance: fd.get("alcance") ?? "solo" })
        : await cancelarReservaPropia(actor, { ocupacionId, alcance: fd.get("alcance") ?? "solo" })
      : await noShowReservaAjena(actor, { ocupacionId, accion: fd.get("accion") });

  const codigo = !r.ok ? r.error : r.data.ok ? null : r.data.error;
  revalidatePath(`/panel/${ctx.slug}`);
  redirect(volver(ctx, codigo ? { turno: ocupacionId, errorTurno: codigo } : {}));
}
