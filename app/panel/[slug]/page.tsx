// app/panel/[slug]/page.tsx — la pantalla del producto: el calendario del centro (§6.4).
// El centro viaja en la URL, nunca en una cookie (§6.1). Sin membresía => 404, no 403: a un
// extraño no se le confirma la existencia del centro.
//
// Todo el estado del calendario (día, vista, mes del lateral, salas filtradas) vive en la URL.
// Eso es lo que hace que el botón "atrás" funcione, que se pueda mandar por WhatsApp el link de
// un día concreto, y que la pantalla no dependa de JavaScript para navegar.

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { actorDeSesion } from "../../../src/lib/sesion.ts";
import { esMovil } from "../../../src/lib/movil.ts";
import { intentar } from "../../../src/lib/db-salud.ts";
import { BaseNoLista } from "../../BaseNoLista.tsx";
import { cargarAgenda } from "../../../src/servicios/agenda/dia.ts";
import { mensajeDeError, mensajeDeTurno } from "../../../src/servicios/agenda/acciones.ts";
import { prisma } from "../../../src/db/prisma.ts";
import { puede } from "../../../src/lib/permisos.ts";
import { fechaEnZona, formatHora } from "../../../src/dominio/motor/zona.ts";
import { formatearPesos } from "../../../src/dominio/tarifa.ts";
import { esVista, fechaDeParam, navegar, type Vista } from "../../../src/dominio/calendario.ts";
import { horasYMinutos, nombreDePeriodo } from "../../../src/dominio/reporte.ts";
import { Logo } from "../../Logo.tsx";
import { IconoMas } from "../../Iconos.tsx";
import { AvisoAlta } from "./AvisoAlta.tsx";
import { ocupacionMensualPorSala } from "../../../src/servicios/reportes/mensual.ts";
import { SIN_SALA } from "../../../src/servicios/agenda/dia.ts";
import { Grilla } from "./Grilla.tsx";
import {
  crearTurno,
  editarTurno as editarTurnoAccion,
  moverArrastrando,
  sobreTurno,
} from "./acciones-agenda.ts";
import { describirConflictos, parsearConflictos } from "../../../src/dominio/conflictos.ts";
import { VistaMes } from "./VistaMes.tsx";
import { Deslizar } from "./Deslizar.tsx";
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

  // Con qué vista abre la agenda cuando la URL no lo dice. En un monitor el DÍA —se ve la grilla
  // horaria entera—; en un teléfono el MES, que es lo que se mira parado: "qué hay este mes".
  // La grilla del día en 326px de ancho útil obliga a arrastrar de costado para ver el tercer
  // consultorio, y eso no es una agenda, es un rompecabezas.
  //
  // Se decide en el servidor por el user-agent y no en el navegador por el ancho: con CSS la
  // página se pintaría en una vista y saltaría a la otra, y el parpadeo se ve.
  const movil = esMovil((await headers()).get("user-agent"));
  const vista: Vista = sp.vista && esVista(sp.vista) ? sp.vista : movil ? "mes" : "dia";
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
  // También bajo `intentar`, como las dos consultas de arriba. Quedaba afuera y era el único
  // camino por el que un problema de base en esta pantalla terminaba en la pantalla en blanco de
  // Next —"This page couldn't load" y un número— en vez de decir qué falta.
  const ocupCargada = veOcupacion
    ? await intentar(() => ocupacionMensualPorSala({ operadorId: actor.operadorId, periodo: mesLateral.slice(0, 7) }))
    : ({ ok: true, valor: [] } as const);
  if (!ocupCargada.ok) return <BaseNoLista falla={ocupCargada.falla} />;
  const ocupacionMes = ocupCargada.valor;
  const ocupPorSala = new Map(ocupacionMes.map((o) => [o.salaId, o]));

  /** Arma un link conservando lo que no cambia. Las URLs son el estado de la pantalla. */
  function href(fecha: string, extra: Record<string, string> = {}): string {
    const q = new URLSearchParams({ fecha, vista, ...(sp.salas ? { salas: sp.salas } : {}), ...(sp.mes ? { mes: sp.mes } : {}), ...extra });
    return `/panel/${slug}?${q.toString()}`;
  }

  /**
   * Ir a otra fecha de la AGENDA. A diferencia de `href`, NO arrastra `mes`.
   *
   * `mes` existe para poder hojear el calendarito del lateral sin mover la agenda. Pero cuando la
   * que se mueve es la agenda, el lateral tiene que acompañarla: quedaba la agenda en octubre y el
   * calendarito en agosto, dos meses distintos en la misma pantalla y ninguna pista de por qué.
   * Al soltar el parámetro, `mesLateral` vuelve a su default, que es la fecha de la agenda.
   */
  function hrefFecha(fecha: string): string {
    const q = new URLSearchParams({ fecha, vista, ...(sp.salas ? { salas: sp.salas } : {}) });
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
  // Las dos consultas que quedaban sueltas, también bajo `intentar`: son las últimas por las que
  // un problema de base tiraba la pantalla abajo sin explicar nada.
  const inqCargados = puedeCargar
    ? await intentar(() =>
        prisma.inquilino.findMany({
          where: { operadorId: actor.operadorId, estado: "activo" },
          select: { id: true, nombre: true },
          orderBy: { nombre: "asc" },
        }),
      )
    : ({ ok: true, valor: [] as { id: string; nombre: string }[] } as const);
  if (!inqCargados.ok) return <BaseNoLista falla={inqCargados.falla} />;
  const inquilinos = inqCargados.valor;

  // Aviso de precio: se muestra la tarifa GENERAL vigente (la que aplica salvo excepción). El
  // precio exacto de cada combinación está en la pantalla de precios; acá alcanza con que nadie
  // cargue una reserva creyendo que no cobra nada.
  const puedePrecios = puede(actor.rol, "tarifa.administrar");
  const tarCargada = puedePrecios
    ? await intentar(() =>
        prisma.tarifa.findFirst({
          where: { operadorId: actor.operadorId, salaId: null, inquilinoId: null, vigenteHasta: null },
          select: { precioHoraCent: true },
          orderBy: { vigenteDesde: "desc" },
        }),
      )
    : ({ ok: true, valor: null } as const);
  if (!tarCargada.ok) return <BaseNoLista falla={tarCargada.falla} />;
  const general = tarCargada.valor;
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
  // El contexto que cada acción necesita de esta pantalla. Lo demás vive en acciones-agenda.ts:
  // son las reglas de permisos, y estaban intercaladas entre el marcado de seiscientas líneas.
  const ctxAcciones = { slug, vista, fecha: agenda.fecha, salas: sp.salas };

  async function crear(formData: FormData) {
    "use server";
    await crearTurno(ctxAcciones, formData);
  }

  async function editarTurno(formData: FormData): Promise<void> {
    "use server";
    await editarTurnoAccion(ctxAcciones, formData);
  }

  async function mover(input: { ocupacionId: string; salaDestinoId: string; fecha: string; hora: string }) {
    "use server";
    return moverArrastrando(ctxAcciones, input);
  }

  // Acciones sobre un turno existente. Vuelven al mismo día y vista, con el detalle CERRADO si
  // salió bien (el turno ya no es lo que era) y abierto con el error si no.
  const puedeEditarTurnos = puede(actor.rol, "reserva.editar.ajena");
  // El profesional edita lo suyo. `turnoAbierto` ya viene proyectado según el actor, así que si
  // llegó con identidad es porque es propio: un turno ajeno se proyecta como "ocupado" sin dueño.
  const puedeEditarPropio = puede(actor.rol, "reserva.editar.propia") && actor.inquilinoId !== null;

  async function cancelarTurno(fd: FormData) {
    "use server";
    await sobreTurno("cancelar", ctxAcciones, fd);
  }

  // El turno abierto sale de la agenda YA PROYECTADA: si el que mira no lo puede ver, no está en
  // la lista y el panel no se abre. No hay una segunda consulta que se saltee la privacidad.
  const turnoAbierto = sp.turno ? agenda.reservas.find((r) => r.id === sp.turno) : undefined;


  return (
    <>
      {/* Un solo listener para todas las burbujas de la pantalla (crear turno, tuerca). */}

      {/* ── Barra superior ──────────────────────────────────────────────── */}
      <header className="barra">
        <Link href={`/panel/${slug}`} style={{ display: "flex", alignItems: "center" }} aria-label="Inicio">
          <Logo alto={26} variante="compacto" />
        </Link>

        <Link href={`/panel/${slug}?vista=${vista}`} className="btn-suave" style={{ padding: "8px 16px", borderRadius: 999, fontWeight: 500, fontSize: 14 }}>
          Hoy
        </Link>

        {/* El período va ENTRE las flechas y no después: "‹ Agosto ›" se lee como una sola cosa
            —qué estoy mirando y cómo me muevo—, mientras que "‹ › Agosto" son dos controles
            sueltos y hay que mirar dos veces para entender que las flechas mueven ESE mes. */}
        <span style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0, flexShrink: 1 }}>
          <Link className="nav-circ" href={hrefFecha(navegar(vista, agenda.fecha, -1))} aria-label="Anterior">
            ‹
          </Link>
          <h1
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 500,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
              flexShrink: 1,
              textAlign: "center",
              padding: "0 4px",
            }}
          >
            {agenda.titulo}
          </h1>
          <Link className="nav-circ" href={hrefFecha(navegar(vista, agenda.fecha, 1))} aria-label="Siguiente">
            ›
          </Link>
        </span>

        {/* El reloj de la zona del centro: el único lugar donde un error de zona se ve (§4.3.3). */}
        <span className="tenue oculta-mobile" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
          {formatHora(ahora, agenda.tz)} · {agenda.tz.split("/").at(-1)!.replace(/_/g, " ")}
        </span>

        {/* En el teléfono la única vista es el mes, así que el selector no se muestra. Pero tocar
            un día lleva a la vista del día —es donde se ven los horarios y se carga un turno— y
            de ahí hay que poder volver. Esto NO es un selector: es la salida de un camino, y por
            eso aparece solo cuando se está adentro de él.
            Sin esto, en la app instalada en el teléfono no habría botón de atrás a la vista. */}
        {vista !== "mes" && (
          <Link
            href={href(agenda.fecha, { vista: "mes" })}
            className="btn-suave solo-mobile"
            style={{ marginLeft: "auto", padding: "8px 14px", borderRadius: 999, fontSize: 14, whiteSpace: "nowrap" }}
          >
            ‹ Mes
          </Link>
        )}

        {/* Los accesos a las secciones —"Calendario" y "Mis reservas" incluidos— viven en el menú
            lateral, que pone el layout del panel. En la barra quedó solo la elección de vista, que
            es de esta pantalla y de ninguna otra. */}
        {/* `data-vista` no es decorativo: en el teléfono el CSS esconde semana y mes, y la regla
            necesita nombrar cuál es cuál. Por posición se rompería el día que se agregue una
            vista o se reordenen. */}
        <nav className="segmentado" style={{ marginLeft: "auto" }}>
          <Link data-vista="dia" href={href(agenda.fecha, { vista: "dia" })} aria-current={vista === "dia" ? "page" : undefined}>
            Día
          </Link>
          <Link data-vista="semana" href={href(agenda.fecha, { vista: "semana" })} aria-current={vista === "semana" ? "page" : undefined}>
            Semana
          </Link>
          <Link data-vista="mes" href={href(agenda.fecha, { vista: "mes" })} aria-current={vista === "mes" ? "page" : undefined}>
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
          {/* Acá vivía una franja con "Ocupación 50% (21 h de 42 h) · 8 turnos". Se sacó: encima de
              la grilla, donde se viene a mirar QUÉ hay agendado, era una línea de estadística que
              se lee una vez y después solo ocupa alto. El porcentaje de ocupación sigue estando en
              Negocio, que es la pantalla donde se va a buscar, y por consultorio en el lateral.
              La franja sobrevive SOLO para el error: eso sí hay que verlo, y acá arriba. */}
          {sp.error && !puedeCargar && (
            <p
              className="tenue"
              style={{ margin: 0, padding: "8px 16px", borderBottom: "1px solid var(--borde)", fontSize: 13 }}
            >
              <span className="error">{mensajeDeError(sp.error)}</span>
            </p>
          )}

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
            // Deslizar de costado pasa de mes, con las mismas URLs que las flechas de arriba: el
            // gesto es un atajo a la misma navegación, no un camino paralelo que pueda quedar
            // desincronizado. Solo envuelve la vista MES — en día y semana el gesto competiría
            // con el arrastre de turnos entre consultorios.
            <Deslizar
              anterior={hrefFecha(navegar(vista, agenda.fecha, -1))}
              siguiente={hrefFecha(navegar(vista, agenda.fecha, 1))}
            >
              <VistaMes dia={agenda} hoy={hoy} href={href} puedeCrear={puedeCargar || puedeCargarPropia} />
            </Deslizar>
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
        <details
          className="crear-flotante"
          data-burbuja
          // La `key` cambia con la celda tocada y REMONTA el <details>. Sin esto, el segundo
          // click sobre la grilla no hacía nada:
          //
          //   1. Se toca una celda → la URL trae `nuevo=1` y React abre el globo.
          //   2. Se toca OTRA celda → el listener de CerrarBurbujas ve un toque afuera y hace
          //      `d.open = false` directo sobre el DOM, que es la única forma de cerrar un
          //      <details> desde afuera de React.
          //   3. Llega la navegación y React vuelve a renderizar con `open` en true… que es el
          //      MISMO valor que la vez anterior. Para React no cambió nada, así que no vuelve a
          //      escribir el atributo, y el globo queda cerrado con el formulario adentro.
          //
          // Remontar lo arregla de raíz: cada celda es un <details> nuevo, que nace abierto. Es la
          // misma razón por la que el formulario de adentro ya tenía su propia key.
          key={`${sp.sala ?? ""}|${sp.hora ?? ""}|${sp.nuevo ?? ""}|${sp.error ?? ""}`}
          open={Boolean(sp.error) || sp.nuevo === "1"}
        >
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
              // Agendar sin consultorio es de la administración: el profesional que necesita esas
              // horas se las pide al dueño del centro. Mismo permiso que crear el turno de otro.
              permiteSinSala={puedeCargar}
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
