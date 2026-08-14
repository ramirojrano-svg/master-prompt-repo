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
import { crearReservaAjena, mensajeDeError } from "../../../src/servicios/agenda/acciones.ts";
import { prisma } from "../../../src/db/prisma.ts";
import { puede } from "../../../src/lib/permisos.ts";
import { fechaEnZona, formatHora } from "../../../src/dominio/motor/zona.ts";
import { formatearPesos } from "../../../src/dominio/tarifa.ts";
import { esVista, fechaDeParam, navegar, type Vista } from "../../../src/dominio/calendario.ts";
import { horasYMinutos } from "../../../src/dominio/reporte.ts";
import { Logo } from "../../Logo.tsx";
import { Grilla } from "./Grilla.tsx";
import { VistaMes } from "./VistaMes.tsx";
import { MiniCalendario } from "./MiniCalendario.tsx";
import { NuevaReserva } from "./NuevaReserva.tsx";

type Params = { slug: string };
type Query = { fecha?: string; vista?: string; mes?: string; salas?: string; error?: string; creada?: string };

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
    const r = await crearReservaAjena(actorAccion, {
      salaId: formData.get("salaId"),
      fecha: fechaForm,
      hora: formData.get("hora"),
      duracionMin: formData.get("duracionMin"),
      inquilinoId: formData.get("inquilinoId"),
    });

    const q = new URLSearchParams({ fecha: fechaForm, vista });
    if (!r.ok) q.set("error", r.error); // SIN_PERMISO / ENTRADA_INVALIDA (del envoltorio)
    else if (!r.data.ok) q.set("error", r.data.error); // SLOT_OCUPADO, FUERA_DE_HORARIO, …
    else q.set("creada", "1");

    revalidatePath(`/panel/${slug}`);
    redirect(`/panel/${slug}?${q.toString()}`);
  }

  const links: { href: string; texto: string }[] = [];
  if (puede(actor.rol, "sala.administrar")) links.push({ href: `/panel/${slug}/salas`, texto: "Consultorios" });
  if (puede(actor.rol, "inquilino.administrar")) links.push({ href: `/panel/${slug}/inquilinos`, texto: "Profesionales" });
  if (puede(actor.rol, "tarifa.administrar")) links.push({ href: `/panel/${slug}/tarifas`, texto: "Precios" });
  if (puede(actor.rol, "finanzas.ver.agregada")) links.push({ href: `/panel/${slug}/reportes`, texto: "Métricas" });

  return (
    <>
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

        <nav className="oculta-mobile" style={{ display: "flex", gap: 14, fontSize: 14 }}>
          {links.map((l) => (
            <Link key={l.href} href={l.href} style={{ color: "var(--tenue)", fontWeight: 500 }}>
              {l.texto}
            </Link>
          ))}
        </nav>
      </header>

      <div className="marco">
        {/* ── Lateral ───────────────────────────────────────────────────── */}
        <aside className="lateral">
          {puedeCargar && (
            <details className="panel" style={{ padding: 0, border: "none", boxShadow: "none", marginBottom: 14 }} open={Boolean(sp.error)}>
              <summary
                style={{
                  listStyle: "none",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "12px 20px",
                  borderRadius: 999,
                  background: "#fff",
                  boxShadow: "var(--sombra)",
                  border: "1px solid var(--borde)",
                  fontWeight: 600,
                  color: "var(--marca-900)",
                }}
              >
                <span style={{ fontSize: 20, lineHeight: 1, color: "var(--turquesa)" }}>+</span> Crear
              </summary>
              <div style={{ marginTop: 12 }}>
                <NuevaReserva
                  salas={agenda.salas.filter((s) => s.activa).map((s) => ({ id: s.id, nombre: s.nombre }))}
                  inquilinos={inquilinos}
                  fecha={agenda.fecha}
                  accion={crear}
                  error={sp.error ? mensajeDeError(sp.error) : undefined}
                  creada={sp.creada === "1"}
                  precios={precios}
                />
              </div>
            </details>
          )}

          <MiniCalendario mes={mesLateral} elegida={agenda.fecha} hoy={hoy} vista={vista} href={href} />

          {/* Filtro de salas: las "casillas de calendarios". Prender y apagar es solo un link. */}
          <h2 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--tenue)", margin: "18px 0 6px" }}>
            Consultorios
          </h2>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
            {agenda.salas.map((s) => {
              const prendida = agenda.salasVisibles.includes(s.id);
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
                    <span style={{ opacity: prendida ? 1 : 0.55, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.nombre}
                      {!s.activa && <span className="tenue"> (archivado)</span>}
                    </span>
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
            <span>
              Ocupación <strong style={{ color: "var(--texto)" }}>{agenda.kpis.ocupacionPct}%</strong> ({horasYMinutos(agenda.kpis.ocupadasMin)} de{" "}
              {horasYMinutos(agenda.kpis.disponiblesMin)})
            </span>
            <span>
              {agenda.reservas.filter((r) => !r.esBloqueo).length} turno
              {agenda.reservas.filter((r) => !r.esBloqueo).length === 1 ? "" : "s"}
            </span>
            {sp.creada === "1" && <span className="exito">Reserva creada.</span>}
            {sp.error && !puedeCargar && <span className="error">{mensajeDeError(sp.error)}</span>}
          </p>

          {vista === "mes" ? <VistaMes dia={agenda} hoy={hoy} href={href} /> : <Grilla dia={agenda} hoy={hoy} />}
        </section>
      </div>
    </>
  );
}
