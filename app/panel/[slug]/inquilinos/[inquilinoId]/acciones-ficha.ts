"use server";

// app/panel/[slug]/inquilinos/[inquilinoId]/acciones-ficha.ts — lo que la ficha ESCRIBE.
//
// Mismo motivo que en `acciones-agenda.ts`: estas seis funciones son las que tocan plata, datos
// personales y contraseñas de un profesional, y vivían intercaladas entre el marcado de una
// pantalla de quinientas líneas. Una regla que hay que poder auditar no puede estar enterrada
// entre etiquetas — es lo primero que alguien tiene que poder leer entero.
//
// Las seis comparten la misma forma, y conviene verla una vez acá arriba en vez de seis veces
// abajo:
//
//   1. volver a pedir el actor de la sesión. NO se confía en el que renderizó la pantalla: entre
//      que se dibujó el formulario y que se envía pueden pasar horas, la sesión puede haber
//      caducado o el rol haber cambiado. Una server action es un endpoint HTTP público.
//   2. delegar en el servicio, que es el que aplica el permiso.
//   3. revalidar la ruta SIN la query, porque `revalidatePath` toma un path: con "?periodo=..."
//      no invalida nada, y se ve el estado viejo después de haber escrito bien.
//   4. volver a la ficha con un código en la URL, que la pantalla traduce a un aviso.
//
// El contexto viaja explícito en `CtxFicha` en vez de capturarse del entorno: una server action
// serializa todo lo que captura, así que capturar poco es también lo que la mantiene liviana.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actorDeSesion } from "../../../../../src/lib/sesion.ts";
import { editarInquilino } from "../../../../../src/servicios/config/inquilinos.ts";
import { despreciarInquilino } from "../../../../../src/servicios/plata/despreciar.ts";
import { crearAcceso, restablecerClave } from "../../../../../src/servicios/config/accesos.ts";
import { anularCobro, registrarCobro } from "../../../../../src/servicios/plata/cobros.ts";

/** Lo que cada acción necesita saber de la pantalla desde la que se disparó. */
export type CtxFicha = { slug: string; inquilinoId: string; periodo: string };

/** La ruta que hay que revalidar: sin query, o no invalida nada. */
function ruta(ctx: CtxFicha): string {
  return `/panel/${ctx.slug}/inquilinos/${ctx.inquilinoId}`;
}

/** La vuelta a la ficha conservando el mes que se estaba mirando. */
function volver(ctx: CtxFicha, extra: Record<string, string>): string {
  const q = new URLSearchParams({ periodo: ctx.periodo, ...extra });
  return `${ruta(ctx)}?${q.toString()}`;
}

/** El actor de AHORA, no el de cuando se dibujó el formulario. */
async function actorVigente(slug: string) {
  const a = await actorDeSesion(slug);
  if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);
  return a;
}

export async function registrarPago(ctx: CtxFicha, formData: FormData): Promise<void> {
  const a = await actorVigente(ctx.slug);

  const r = await registrarCobro(a, {
    inquilinoId: ctx.inquilinoId,
    monto: formData.get("monto"),
    medio: formData.get("medio"),
    referencia: formData.get("referencia") ?? undefined,
    fecha: formData.get("fecha") ?? undefined,
  });

  revalidatePath(ruta(ctx));
  // El duplicado se avisa distinto que el alta: para el operador "ya estaba cargado" y "listo"
  // son dos cosas muy diferentes, y confundirlas hace que busque un pago que nunca se asentó.
  const extra: Record<string, string> = !r.ok
    ? { error: r.error }
    : !r.data.ok
      ? { error: r.data.error }
      : r.data.duplicado
        ? { ok: "repetido" }
        : { ok: "1" };
  redirect(volver(ctx, extra));
}

export async function anularPago(ctx: CtxFicha, formData: FormData): Promise<void> {
  const a = await actorVigente(ctx.slug);

  const r = await anularCobro(a, { asientoId: formData.get("asientoId"), motivo: formData.get("motivo") });
  revalidatePath(ruta(ctx));
  const extra: Record<string, string> = !r.ok ? { error: r.error } : !r.data.ok ? { error: r.data.error } : { ok: "anulado" };
  redirect(volver(ctx, extra));
}

// Editar los datos del profesional vive ACÁ y ya no en la lista: es donde uno está mirando a esa
// persona. En la lista quedaron solo las dos acciones que se hacen sin abrir a nadie.
export async function guardarDatos(ctx: CtxFicha, formData: FormData): Promise<void> {
  const a = await actorVigente(ctx.slug);

  const r = await editarInquilino(a, {
    inquilinoId: ctx.inquilinoId,
    nombre: formData.get("nombre"),
    pagador: formData.get("pagador"),
    email: formData.get("email"),
    whatsapp: formData.get("whatsapp"),
    // Una casilla destildada no viaja en el formulario: ausente significa "no se le factura".
    facturable: formData.get("facturable") === "true",
  });
  revalidatePath(ruta(ctx));
  redirect(volver(ctx, r.ok && r.data.ok ? { ok: "datos" } : { error: "DATOS" }));
}

// Sacarle el precio a lo ya cargado. Es EXPLÍCITO y aparte de la casilla: cambiar una marca de
// la ficha no puede borrar plata de meses anteriores sin que nadie lo pida.
export async function sacarPrecios(ctx: CtxFicha): Promise<void> {
  const a = await actorVigente(ctx.slug);

  const r = await despreciarInquilino(a, { inquilinoId: ctx.inquilinoId });
  revalidatePath(ruta(ctx));
  const codigo = !r.ok ? r.error : r.data.ok ? null : r.data.error;
  redirect(
    volver(ctx, codigo ? { error: codigo } : { ok: "despreciado", n: String(r.ok && r.data.ok ? r.data.reservas : 0) }),
  );
}

export async function darAcceso(ctx: CtxFicha, formData: FormData): Promise<void> {
  const a = await actorVigente(ctx.slug);

  const r = await crearAcceso(a, {
    inquilinoId: ctx.inquilinoId,
    email: formData.get("email"),
    password: formData.get("password"),
  });
  revalidatePath(ruta(ctx));
  const codigo = !r.ok ? r.error : r.data.ok ? null : r.data.error;
  redirect(volver(ctx, codigo ? { error: codigo } : { ok: "acceso" }));
}

export async function resetearClave(ctx: CtxFicha, formData: FormData): Promise<void> {
  const a = await actorVigente(ctx.slug);

  const r = await restablecerClave(a, { inquilinoId: ctx.inquilinoId, password: formData.get("password") });
  revalidatePath(ruta(ctx));
  const codigo = !r.ok ? r.error : r.data.ok ? null : r.data.error;
  redirect(volver(ctx, codigo ? { error: codigo } : { ok: "clave" }));
}
