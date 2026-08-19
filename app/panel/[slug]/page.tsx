// app/panel/[slug]/page.tsx — la pantalla del producto: el calendario del centro (§6.4).
// El centro viaja en la URL, nunca en una cookie (§6.1). Sin membresía => 404, no 403: a un
// extraño no se le confirma la existencia del centro.
//
// Todo el estado del calendario (día, vista, mes del lateral, salas filtradas) vive en la URL.
// Eso es lo que hace que el botón "atrás" funcione, que se pueda mandar por WhatsApp el link de
// un día concreto, y que la pantalla no dependa de JavaScript para navegar.

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { actorDeSesion } from "../../../src/lib/sesion.ts";
import { intentar } from "../../../src/lib/db-salud.ts";
import { BaseNoLista } from "../../BaseNoLista.tsx";
import { cargarAgenda } from "../../../src/servicios/agenda/dia.ts";
import {
  cancelarReservaAjena,
  crearReservaAjena,
  cancelarReservaPropia,
  crearReservaPropia,
  mensajeDeError,
  mensajeDeMovimiento,
  mensajeDeTurno,
  moverReservaAjena,
  moverReservaPropia,
  noShowReservaAjena,
} from "../../../src/servicios/agenda/acciones.ts";
import { prisma } from "../../../src/db/prisma.ts";
import { puede } from "../../../src/lib/permisos.ts";
import { fechaEnZona, formatHora } from "../../../src/dominio/motor/zona.ts";
import { formatearPesos } from "../../../src/dominio/tarifa.ts";
import { esVista, fechaDeParam, navegar, type Vista } from "../../../src/dominio/calendario.ts";
import { horasYMinutos, nombreDePeriodo } from "../../../src/dominio/reporte.ts";
import { Logo } from "../../Logo.tsx";
import { IconoMas } from "../../Iconos.tsx";
import { AvisoAlta } from "./AvisoAlta.tsx";
import { CerrarBurbujas } from "./CerrarBurbujas.tsx";
import { ocupacionMensualPorSala } from "../../../src/servicios/reportes/mensual.ts";
import { describirConflictos, parsearConflictos, resumirConflictos, serializarConflictos } from "../../../src/dominio/conflictos.ts";
import { SIN_SALA } from "../../../src/servicios/agenda/dia.ts";
import { Grilla } from "./Grilla.tsx";
import { VistaMes } from "./VistaMes.tsx";
import { MiniCalendario } from "./MiniCalendario.tsx";
import { NuevaReserva } from "./NuevaReserva.tsx";
import { DetalleTurno } from "./DetalleTurno.tsx";

type Params = { slug: string };
type Query = {
  fecha?: string;
  vista?: string;
  mes?: string;
  salas?: string;
  error?: string;
  creada?: string;
  chocaron?: string;
  dias?: string;
  turno?: string;
  errorTurno?: string;
  // Tocar una celda de la grilla: abre el alta con ese consultorio y esa hora ya puestos. Va por
  // la URL y no por estado del cliente porque en esta pantalla la URL ES el estado — el formulario
  // abierto se puede compartir, sobrevive al refresh y "atrás" lo cierra.
  nuevo?: string;
  hora?: string;
  sala?: string;
};

/**
 * El cuerpo compartido de las acciones sobre un turno. Vive FUERA del componente a propósito:
 * una server action serializa todo lo que captura de su entorno, y capturar una función definida
 * adentro de la página revienta con "Functions cannot be passed directly to Client Components".
 * Acá las actions solo capturan strings.
 */
async function ejecutarSobreTurno(
  cual: "cancelar" | "noShow",
  fd: FormData,
  ctx: { slug: string; vista: Vista; fecha: string; salas?: string },
): Promise<void> {
  const actor = await actorDeSesion(ctx.slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(ctx.slug)}`);

  const ocupacionId = String(fd.get("ocupacionId") ?? "");
  // Cancelar tiene dos caminos por el mismo motivo que crear: el del profesional verifica contra
  // la base que la fila sea SUYA. Marcar no-show es del centro y no tiene versión propia — que
  // alguien declare que no vino a su propio turno para no pagarlo no es una función, es un agujero.
  const puedeAjena = puede(actor.rol, "reserva.editar.ajena");
  const r =
    cual === "cancelar"
      ? puedeAjena
        ? await cancelarReservaAjena(actor, { ocupacionId, alcance: fd.get("alcance") ?? "solo" })
        : await cancelarReservaPropia(actor, { ocupacionId, alcance: fd.get("alcance") ?? "solo" })
      : await noShowReservaAjena(actor, { ocupacionId, accion: fd.get("accion") });

  const codigo = !r.ok ? r.error : r.data.ok ? null : r.data.error;
  const q = new URLSearchParams({ fecha: ctx.fecha, vista: ctx.vista });
  if (ctx.salas) q.set("salas", ctx.salas);
  // Con error el detalle sigue abierto: el mensaje sin el turno adelante no se entiende.
  if (codigo) {
    q.set("turno", ocupacionId);
    q.set("errorTurno", codigo);
  }

  revalidatePath(`/panel/${ctx.slug}`);
  redirect(`/panel/${ctx.slug}?${q.toString()}`);
}

export default async function PanelPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Query> }) {
  // En Next 16 params y searchParams son Promise (§11.0).
  const { slug } = await params;
  const sp = await searchParams;

  // Esta es la PRIMERA consulta de la app, así que es acá donde revienta una base sin esquema o
  // caída. Se muestra qué falta en vez de un stack de Prisma; lo que no sea un problema de base
  // (incluido el NEXT_REDIRECT de más abajo) sigue propagando intacto.
  const sesion = await intentar(() => actorDeSesion(slug));
  if (!sesion.ok) return <BaseNoLista falla={sesion.falla} />;
  const actor = sesion.valor;
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);

  const vista: Vista = sp.vista && esVista(sp.vista) ? sp.vista : "dia";
  const salasFiltro = sp.salas ? sp.salas.split(",").filter(Boolean) : null;

  // También bajo `intentar`: con el esquema viejo el actor resuelve bien y recién acá aparece la
  // columna que falta (P2022), que es el otro modo en que la base rompe la pantalla.
  const cargada = await intentar(() =>
    cargarAgenda({
      actor,
      // `null` = HOY en la zona de la SEDE, resuelto adentro del servicio: la zona NUNCA se clava
      // acá (§14.4). Un `?fecha=` basura cae a null en vez de romper la pantalla (§9).
      fecha: fechaDeParam(sp.fecha),
      vista,
      salas: salasFiltro,
    }),
  );
  if (!cargada.ok) return <BaseNoLista falla={cargada.falla} />;
  const agenda = cargada.valor;
  if (!agenda) notFound();

  const ahora = new Date();
  const hoy = fechaEnZona(ahora, agenda.tz); // HOY del CENTRO, no el del navegador
  const mesLateral = fechaDeParam(sp.mes) ?? agenda.fecha;

  // Ocupación del mes por consultorio, para la barrita del lateral. Es el mes que se está
  // mirando en el minicalendario, no "el mes actual": si alguien navega a septiembre, las
  // barras tienen que hablar de septiembre o estarían contando otra cosa que lo que se ve.
  // La ocupación del centro (el KPI de arriba y las barras del lateral) es información de
  // negocio: cuánto rinde cada consultorio le importa a quien lo alquila, no a quien lo usa.
  const veOcupacion = puede(actor.rol, "finanzas.ver.agregada");
  const ocupacionMes = veOcupacion ? await ocupacionMensualPorSala({ operadorId: actor.operadorId, periodo: mesLateral.slice(0, 7) }) : [];
  const ocupPorSala = new Map(ocupacionMes.map((o) => [o.salaId, o]));

  /** Arma un link conservando lo que no cambia. Las URLs son el estado de la pantalla. */
  function href(fecha: string, extra: Record<string, string> = {}): string {
    const q = new URLSearchParams({ fecha, vista, ...(sp.salas ? { salas: sp.salas } : {}), ...(sp.mes ? { mes: sp.mes } : {}), ...extra });
    return `/panel/${slug}?${q.toString()}`;
  }

  /** Link para prender/apagar una sala del filtro lateral. */
  function hrefSala(salaId: string): string {
    const actuales = new Set(agenda!.salasVisibles);
    if (actuales.has(salaId)) actuales.delete(salaId);
    else actuales.add(salaId);
    // Todas prendidas = sin filtro (URL corta y compartible).
    const todas = actuales.size === 0 || actuales.size === agenda!.salas.length;
    const q = new URLSearchParams({ fecha: agenda!.fecha, vista });
    if (!todas) q.set("salas", [...actuales].join(","));
    if (sp.mes) q.set("mes", sp.mes);
    return `/panel/${slug}?${q.toString()}`;
  }

  const puedeCargar = puede(actor.rol, "reserva.crear.ajena");
  // El profesional también agenda: lo suyo. Sin esto entraba a la agenda y no tenía botón —
  // podía mirar y nada más, que es justo lo contrario de para qué está la app.
  const puedeCargarPropia = puede(actor.rol, "reserva.crear.propia") && actor.inquilinoId !== null;
  const inquilinos = puedeCargar
    ? await prisma.inquilino.findMany({
        where: { operadorId: actor.operadorId, estado: "activo" },
        select: { id: true, nombre: true },
        orderBy: { nombre: "asc" },
      })
    : [];

  // Aviso de precio: se muestra la tarifa GENERAL vigente (la que aplica salvo excepción). El
  // precio exacto de cada combinación está en la pantalla de precios; acá alcanza con que nadie
  // cargue una reserva creyendo que no cobra nada.
  const puedePrecios = puede(actor.rol, "tarifa.administrar");
  const general = puedePrecios
    ? await prisma.tarifa.findFirst({
        where: { operadorId: actor.operadorId, salaId: null, inquilinoId: null, vigenteHasta: null },
        select: { precioHoraCent: true },
        orderBy: { vigenteDesde: "desc" },
      })
    : null;
  const precios = puedePrecios
    ? {
        texto: general
          ? `Se cobra la tarifa vigente (general: ${formatearPesos(general.precioHoraCent, agenda.moneda)} la hora).`
          : "Todavía no cargaste precios: esta reserva no va a generar deuda.",
        href: `/panel/${slug}/tarifas`,
      }
    : null;

  // Server action delgada: resuelve la sesión y delega en la acción de dominio, que declara su
  // permiso. Nada de lógica de negocio acá.
  async function crear(formData: FormData) {
    "use server";
    const actorAccion = await actorDeSesion(slug);
    if (!actorAccion) redirect(`/login?centro=${encodeURIComponent(slug)}`);

    const fechaForm = String(formData.get("fecha") ?? "");
    // Dos caminos, no uno con un `if` adentro: el del profesional NO acepta inquilinoId. Si la
    // acción propia lo tomara del formulario, un campo oculto cambiado en el navegador alcanzaría
    // para agendar a nombre de otro, y el permiso no lo frenaría — la acción parecería legítima.
    const comun = {
      salaId: formData.get("salaId"),
      fecha: fechaForm,
      hora: formData.get("hora"),
      duracionMin: formData.get("duracionMin"),
      repeticion: formData.get("repeticion") ?? "no",
    };
    const r = puede(actorAccion.rol, "reserva.crear.ajena")
      ? await crearReservaAjena(actorAccion, { ...comun, inquilinoId: formData.get("inquilinoId") })
      : await crearReservaPropia(actorAccion, comun);

    const q = new URLSearchParams({ fecha: fechaForm, vista });
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

    revalidatePath(`/panel/${slug}`);
    redirect(`/panel/${slug}?${q.toString()}`);
  }

  // Mover un turno arrastrándolo. A diferencia de `crear`, NO redirige: la grilla ya movió el
  // bloque en pantalla y un redirect volvería a montar todo. Devuelve el resultado y la grilla
  // decide si avisa; el revalidate deja la agenda del servidor como fuente de verdad.
  /**
   * Editar un turno desde su detalle: cambiar día, hora o consultorio. Usa el MISMO servicio que
   * arrastrar el bloque —no hay un segundo camino con otras reglas— pero viene de un formulario,
   * así que redirige. Arrastrar no existe en el teléfono, que es justo donde se agenda apurado.
   */
  async function editarTurno(formData: FormData): Promise<void> {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);

    const ocupacionId = String(formData.get("ocupacionId") ?? "");
    const entrada = {
      ocupacionId,
      salaDestinoId: formData.get("salaDestinoId"),
      fecha: formData.get("fecha"),
      hora: formData.get("hora"),
    };
    // Dos caminos según el rol, igual que crear y cancelar: el del profesional verifica contra la
    // base que la fila sea suya antes de tocarla.
    const r = puede(a.rol, "reserva.editar.ajena")
      ? await moverReservaAjena(a, entrada)
      : await moverReservaPropia(a, entrada);

    const codigo = !r.ok ? r.error : r.data.ok ? null : r.data.error;
    const q = new URLSearchParams({ fecha: String(formData.get("fecha") ?? ""), vista });
    if (sp.salas) q.set("salas", sp.salas);
    // Con error el detalle sigue abierto: el mensaje sin el turno adelante no se entiende.
    if (codigo) {
      q.set("turno", ocupacionId);
      q.set("errorTurno", codigo);
    }
    revalidatePath(`/panel/${slug}`);
    redirect(`/panel/${slug}?${q.toString()}`);
  }

  async function mover(input: { ocupacionId: string; salaDestinoId: string; fecha: string; hora: string }) {
    "use server";
    const actorAccion = await actorDeSesion(slug);
    if (!actorAccion) return { ok: false, mensaje: mensajeDeMovimiento("SIN_PERMISO") };

    const r = await moverReservaAjena(actorAccion, input);
    const codigo = !r.ok ? r.error : r.data.ok ? null : r.data.error;
    if (codigo) return { ok: false, mensaje: mensajeDeMovimiento(codigo) };

    revalidatePath(`/panel/${slug}`);
    return { ok: true, mensaje: "" };
  }

  // Acciones sobre un turno existente. Vuelven al mismo día y vista, con el detalle CERRADO si
  // salió bien (el turno ya no es lo que era) y abierto con el error si no.
  const puedeEditarTurnos = puede(actor.rol, "reserva.editar.ajena");
  // El profesional edita lo suyo. `turnoAbierto` ya viene proyectado según el actor, así que si
  // llegó con identidad es porque es propio: un turno ajeno se proyecta como "ocupado" sin dueño.
  const puedeEditarPropio = puede(actor.rol, "reserva.editar.propia") && actor.inquilinoId !== null;

  async function cancelarTurno(fd: FormData) {
    "use server";
    await ejecutarSobreTurno("cancelar", fd, { slug, vista, fecha: agenda!.fecha, salas: sp.salas });
  }

  // El turno abierto sale de la agenda YA PROYECTADA: si el que mira no lo puede ver, no está en
  // la lista y el panel no se abre. No hay una segunda consulta que se saltee la privacidad.
  const turnoAbierto = sp.turno ? agenda.reservas.find((r) => r.id === sp.turno) : undefined;


  return (
    <>
      {/* Un solo listener para todas las burbujas de la pantalla (crear turno, tuerca). */}
      <CerrarBurbujas />

      {/* ── Barra superior ──────────────────────────────────────────────── */}
      <header className="barra">
        <Link href={`/panel/${slug}`} style={{ display: "flex", alignItems: "center" }} aria-label="Inicio">
          <Logo alto={26} variante="compacto" />
        </Link>

        <Link href={`/panel/${slug}?vista=${vista}`} className="btn-suave" style={{ padding: "8px 16px", borderRadius: 999, fontWeight: 500, fontSize: 14 }}>
          Hoy
        </Link>

        <span style={{ display: "flex", gap: 2 }}>
          <Link className="nav-circ" href={href(navegar(vista, agenda.fecha, -1))} aria-label="Anterior">
            ‹
          </Link>
          <Link className="nav-circ" href={href(navegar(vista, agenda.fecha, 1))} aria-label="Siguiente">
            ›
          </Link>
        </span>

        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flexShrink: 1 }}>
          {agenda.titulo}
        </h1>

        {/* El reloj de la zona del centro: el único lugar donde un error de zona se ve (§4.3.3). */}
        <span className="tenue oculta-mobile" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
          {formatHora(ahora, agenda.tz)} · {agenda.tz.split("/").at(-1)!.replace(/_/g, " ")}
        </span>

        {/* Los accesos a las secciones —"Calendario" y "Mis reservas" incluidos— viven en el menú
            lateral, que pone el layout del panel. En la barra quedó solo la elección de vista, que
            es de esta pantalla y de ninguna otra. */}
        <nav className="segmentado" style={{ marginLeft: "auto" }}>
          <Link href={href(agenda.fecha, { vista: "dia" })} aria-current={vista === "dia" ? "page" : undefined}>
            Día
          </Link>
          <Link href={href(agenda.fecha, { vista: "semana" })} aria-current={vista === "semana" ? "page" : undefined}>
            Semana
          </Link>
          <Link href={href(agenda.fecha, { vista: "mes" })} aria-current={vista === "mes" ? "page" : undefined}>
            Mes
          </Link>
        </nav>

      </header>

      <div className="marco">
        {/* ── Lateral ───────────────────────────────────────────────────── */}
        <aside className="lateral">
          <MiniCalendario mes={mesLateral} elegida={agenda.fecha} hoy={hoy} vista={vista} href={href} />

          {/* Filtro de salas: las "casillas de calendarios". Prender y apagar es solo un link. */}
          <h2 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--tenue)", margin: "18px 0 6px" }}>
            Consultorios
          </h2>
          {/* De qué mes hablan las barras, dicho una vez acá y no repetido en cada fila. Sin esto
              el porcentaje al lado de cada consultorio no se sabe si es del día, de la semana o
              del mes — y son tres números muy distintos. */}
          {veOcupacion && (
            <p className="tenue" style={{ margin: "-2px 0 6px", fontSize: 11 }}>
              Ocupación de {nombreDePeriodo(mesLateral.slice(0, 7))}
            </p>
          )}
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
            {agenda.salas.map((s) => {
              const prendida = agenda.salasVisibles.includes(s.id);
              const ocup = ocupPorSala.get(s.id);
              return (
                <li key={s.id}>
                  <Link
                    href={hrefSala(s.id)}
                    style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 6px", borderRadius: 8, color: "var(--texto)", fontSize: 13 }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 15,
                        height: 15,
                        borderRadius: 4,
                        flexShrink: 0,
                        border: `2px solid ${s.color}`,
                        background: prendida ? s.color : "transparent",
                      }}
                    />
                    <span style={{ opacity: prendida ? 1 : 0.55, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                      {s.nombre}
                      {!s.activa && <span className="tenue"> (archivado)</span>}
                    </span>
                    {/* La ocupación del mes, con el número al lado de la barra. Una barra sola se
                        compara entre consultorios pero no se puede leer en valor absoluto, y acá
                        las dos lecturas importan: cuál rinde más, y cuánto rinde. */}
                    {ocup && ocup.aperturaMin > 0 && (
                      <span
                        title={`${horasYMinutos(ocup.minutos)} de ${horasYMinutos(ocup.aperturaMin)} en ${nombreDePeriodo(mesLateral.slice(0, 7))}`}
                        style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}
                      >
                        <span style={{ width: 34, height: 5, borderRadius: 999, background: "var(--borde)", overflow: "hidden" }}>
                          <span style={{ display: "block", width: `${ocup.pct}%`, height: "100%", borderRadius: 999, background: s.color }} />
                        </span>
                        <span className="tenue" style={{ fontSize: 11, fontVariantNumeric: "tabular-nums", minWidth: 26, textAlign: "right" }}>
                          {ocup.pct}%
                        </span>
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* ── Lienzo ────────────────────────────────────────────────────── */}
        <section className="lienzo">
          {/* KPI con el DENOMINADOR visible: un porcentaje sin denominador no se puede auditar. */}
          <p
            id="kpi"
            className="tenue"
            style={{ margin: 0, padding: "8px 16px", borderBottom: "1px solid var(--borde)", fontSize: 13, display: "flex", gap: 14, flexWrap: "wrap" }}
          >
            {veOcupacion && (
              <span>
                Ocupación <strong style={{ color: "var(--texto)" }}>{agenda.kpis.ocupacionPct}%</strong> ({horasYMinutos(agenda.kpis.ocupadasMin)} de{" "}
                {horasYMinutos(agenda.kpis.disponiblesMin)})
              </span>
            )}
            <span>
              {agenda.reservas.filter((r) => !r.esBloqueo).length} turno
              {agenda.reservas.filter((r) => !r.esBloqueo).length === 1 ? "" : "s"}
            </span>
            {sp.error && !puedeCargar && <span className="error">{mensajeDeError(sp.error)}</span>}
          </p>

          {/* El resultado del alta va ACÁ y no adentro del panel de crear: ese panel se cierra
              solo al guardar, así que un aviso adentro no lo ve nadie — y con series es donde más
              importa, porque es donde se saltean fechas. */}
          {sp.creada && (
            <AvisoAlta
              creadas={Number(sp.creada)}
              total={Number(sp.chocaron ?? 0)}
              grupos={describirConflictos(parsearConflictos(sp.dias))}
            />
          )}

          {vista === "mes" ? (
            <VistaMes dia={agenda} hoy={hoy} href={href} />
          ) : (
            // Sin permiso para editar turnos ajenos no se pasa la acción: la grilla no ofrece el
            // gesto en vez de ofrecerlo y que el servidor lo rechace después.
            <Grilla
              dia={agenda}
              hoy={hoy}
              mover={puedeEditarTurnos ? mover : undefined}
              // Sin identidad el turno es un "ocupado" y no hay detalle que abrir: no se ofrece
              // el link en vez de abrir un panel vacío.
              // Clickeable para quien ve identidad (el centro) y también para el profesional, que
              // ve la suya: sin esto podía crear un turno y después no tenía forma de abrirlo para
              // cancelarlo. Los ajenos igual se proyectan como "ocupado" y su detalle no existe.
              baseTurno={puede(actor.rol, "agenda.ver.identidad") || puedeEditarPropio ? href(agenda.fecha) : undefined}
              // Tocar una celda vacía abre el alta con ese consultorio y esa hora ya puestos. Solo
              // para quien puede crear: ofrecer el gesto y después negarlo es peor que no ofrecerlo.
              baseNuevo={puedeCargar || puedeCargarPropia ? href(agenda.fecha) : undefined}
            />
          )}
        </section>
      </div>

      {turnoAbierto && (
        <DetalleTurno
          turno={turnoAbierto}
          moneda={agenda.moneda}
          cerrarHref={href(agenda.fecha)}
          puedeEditar={puedeEditarTurnos || puedeEditarPropio}
          cancelar={cancelarTurno}
          editar={editarTurno}
          salas={agenda.salas.filter((s) => s.activa).map((s) => ({ id: s.id, nombre: s.nombre }))}
          error={sp.errorTurno ? mensajeDeTurno(sp.errorTurno) : undefined}
        />
      )}

      {/* ── Crear turno: redondo, abajo a la izquierda ────────────────────────
          Fuera del <aside>: el lateral se esconde abajo de 880px y el botón de crear no puede
          desaparecer en un teléfono. Sigue siendo <details>/<summary>, o sea que abre y cierra
          sin una línea de JavaScript.
          Queda abierto si hubo error (para que el mensaje se lea) y cuando se llegó tocando una
          celda de la grilla: ese click tiene que dejar el formulario a la vista, no esconderlo
          detrás del "+" con los datos ya cargados. Después de crear se cierra: el formulario no
          tiene nada más que hacer y abierto tapa la agenda que se acaba de modificar. El aviso de
          "turno creado" aparece arriba, sobre la grilla. */}
      {(puedeCargar || puedeCargarPropia) && (
        <details className="crear-flotante" data-burbuja open={Boolean(sp.error) || sp.nuevo === "1"}>
          <summary aria-label="Crear turno" title="Crear turno">
            <IconoMas />
          </summary>
          <div className="globo">
            <NuevaReserva
              // La `key` cambia con la celda que se tocó, y eso REMONTA el formulario.
              //
              // Hace falta porque los campos de hora y consultorio arrancan de un valor inicial
              // —`useState` en el selector de horario, `defaultValue` en el select de sala— y esos
              // dos solo se leen al MONTAR. Al tocar otra celda, Next navega pero React reusa el
              // mismo formulario: llegaban props nuevas y los campos seguían mostrando lo de antes.
              // Se tocaban las 14:00 y "Empieza" seguía diciendo 09:00.
              //
              // Con la key, cada celda es un formulario distinto para React. Es lo mismo que hace
              // falta para que "atrás" devuelva el formulario al estado anterior.
              key={`${sp.sala ?? ""}|${sp.hora ?? ""}|${agenda.fecha}`}
              salas={agenda.salas.filter((s) => s.activa).map((s) => ({ id: s.id, nombre: s.nombre }))}
              // Vacío para el profesional: no elige de quién es el turno, es suyo.
              inquilinos={puedeCargar ? inquilinos : []}
              fecha={agenda.fecha}
              // Lo que dijo la celda que se tocó. Se valida contra las salas visibles: un `sala=`
              // escrito a mano en la URL no tiene por qué existir, y un select con un valor que no
              // está entre sus opciones queda mostrando el primero sin avisar.
              // La columna "Sin consultorio" es sintética: tocarla significa "sin sala", que en el
              // formulario es la opción de valor vacío, no un id.
              salaInicial={sp.sala === SIN_SALA ? "" : sp.sala && agenda.salas.some((s) => s.id === sp.sala && s.activa) ? sp.sala : undefined}
              horaInicial={sp.hora && /^\d{2}:\d{2}$/.test(sp.hora) ? sp.hora : undefined}
              // El mismo horario con el que se dibuja la grilla: las horas que se ofrecen para
              // empezar son exactamente las filas que se ven.
              aperturaMin={agenda.aperturaMin}
              cierreMin={agenda.cierreMin}
              accion={crear}
              error={sp.error ? mensajeDeError(sp.error) : undefined}
              creada={
                sp.creada
                  ? { creadas: Number(sp.creada), total: Number(sp.chocaron ?? 0), grupos: describirConflictos(parsearConflictos(sp.dias)) }
                  : undefined
              }
              precios={precios}
            />
          </div>
        </details>
      )}
    </>
  );
}
