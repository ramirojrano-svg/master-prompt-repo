// app/panel/[slug]/disponibilidad/page.tsx — "qué tengo para ofrecer".
//
// Es la pantalla del otro lado del mostrador. La agenda contesta "qué hay el martes"; acá la
// pregunta es la de quien llega preguntando si queda lugar, y hay que poder contestarla sin
// recorrer la agenda día por día mirando los agujeros entre bloques. A ojo se pierde una hora
// suelta del jueves que después nadie vuelve a mirar, y esa hora es plata que no se cobró.
//
// Solo para la administración: es información comercial del centro. Un profesional que ve la
// agenda ve libre/ocupado, que es lo que necesita para agendarse; el mapa de todo lo que sobra
// —y cuánto vale— es del que alquila.

import { redirect } from "next/navigation";
import Link from "next/link";
import { Cabecera } from "../Cabecera.tsx";
import { actorDeSesion } from "../../../../src/lib/sesion.ts";
import { puede } from "../../../../src/lib/permisos.ts";
import { huecosLibres, DIAS_VENTANA, HUECO_MIN_MIN } from "../../../../src/servicios/agenda/huecos.ts";
import { horasYMinutos } from "../../../../src/dominio/reporte.ts";
import { nombrarFecha } from "../../../../src/dominio/conflictos.ts";

const DIA_LARGO = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export default async function DisponibilidadPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ dias?: string; sala?: string; dow?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);
  // Mismo permiso que administrar consultorios: quien decide qué se alquila es quien puede ver qué
  // queda sin alquilar.
  if (!puede(actor.rol, "sala.administrar")) redirect(`/panel/${slug}`);

  const dias = sp.dias === "30" ? 30 : sp.dias === "7" ? 7 : DIAS_VENTANA;
  const dow = sp.dow != null && /^[0-6]$/.test(sp.dow) ? Number(sp.dow) : null;

  const d = await huecosLibres({ actor, dias, salaId: sp.sala ?? null, diaSemana: dow });
  if (!d) redirect(`/panel/${slug}`);

  /** Un link de esta pantalla conservando los filtros que no cambian. */
  function href(extra: Record<string, string | null>): string {
    const q = new URLSearchParams();
    const base: Record<string, string | null> = { dias: String(dias), sala: sp.sala ?? null, dow: dow == null ? null : String(dow), ...extra };
    for (const [k, v] of Object.entries(base)) if (v) q.set(k, v);
    return `/panel/${slug}/disponibilidad${q.size ? `?${q.toString()}` : ""}`;
  }

  const conAlgo = d.dias.filter((x) => x.huecos.length > 0);

  return (
    <>
      <Cabecera slug={slug} titulo="Qué tengo para ofrecer" />

      <main style={{ padding: 20, maxWidth: 960, margin: "0 auto" }}>
        {/* El total arriba: es la respuesta corta a "cuánto me sobra". El detalle de abajo la explica. */}
        <section className="panel" style={{ padding: 22 }}>
          <p className="tenue" style={{ margin: 0, fontSize: 13 }}>
            Libre {dias === 7 ? "esta semana" : dias === 30 ? "en 30 días" : "en 14 días"}
            {sp.sala && d.salas[0] ? ` · ${d.salas[0].nombre}` : ""}
            {dow != null ? ` · solo ${DIA_LARGO[dow]?.toLowerCase()}s` : ""}
          </p>
          <p style={{ fontSize: 42, margin: "4px 0 2px", fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.1 }}>
            {horasYMinutos(d.minutosLibres)}
          </p>
          <p className="tenue" style={{ margin: 0, fontSize: 13 }}>
            En {conAlgo.length} {conAlgo.length === 1 ? "día" : "días"} con algo disponible. Se listan
            los bloques de {HUECO_MIN_MIN / 60} hora o más: los ratos sueltos entre dos turnos no se
            pueden alquilar.
          </p>
        </section>

        {/* ── Filtros ─────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", margin: "18px 0 6px", alignItems: "center" }}>
          <nav className="segmentado">
            {[7, 14, 30].map((n) => (
              <Link key={n} href={href({ dias: String(n) })} aria-current={dias === n ? "page" : undefined}>
                {n} días
              </Link>
            ))}
          </nav>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span className="tenue" style={{ fontSize: 13 }}>Consultorio:</span>
            <Link href={href({ sala: null })} className="pastilla" style={{ padding: "5px 12px", fontSize: 12 }} aria-current={!sp.sala ? "page" : undefined}>
              Todos
            </Link>
            {d.salas.length > 1 &&
              d.salas.map((s) => (
                <Link key={s.id} href={href({ sala: s.id })} className="pastilla" style={{ padding: "5px 12px", fontSize: 12 }} aria-current={sp.sala === s.id ? "page" : undefined}>
                  {s.nombre}
                </Link>
              ))}
          </div>

          {/* Filtrar por día de la semana es lo que hace falta cuando alguien pide "los miércoles":
              sin esto habría que leer catorce bloques buscando los tres que son miércoles. */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span className="tenue" style={{ fontSize: 13 }}>Día:</span>
            <Link href={href({ dow: null })} className="pastilla" style={{ padding: "5px 12px", fontSize: 12 }} aria-current={dow == null ? "page" : undefined}>
              Todos
            </Link>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <Link key={n} href={href({ dow: String(n) })} className="pastilla" style={{ padding: "5px 10px", fontSize: 12 }} aria-current={dow === n ? "page" : undefined}>
                {DIA_LARGO[n]!.slice(0, 3)}
              </Link>
            ))}
          </div>
        </div>

        {/* ── Día por día ─────────────────────────────────────────────────── */}
        {conAlgo.length === 0 ? (
          <p className="tenue" style={{ marginTop: 20 }}>
            No queda ningún bloque de {HUECO_MIN_MIN / 60} hora o más con estos filtros. Probá con
            más días, otro consultorio, o sacando el filtro de día.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            {conAlgo.map((x) => (
              <section key={x.fecha} className="panel" style={{ padding: 16 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                  <h2 style={{ margin: 0, fontSize: 15 }}>
                    {DIA_LARGO[x.diaSemana]} {nombrarFecha(x.fecha)}
                  </h2>
                  <span className="tenue" style={{ fontSize: 13 }}>{horasYMinutos(x.minutosLibres)} libres</span>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  {x.huecos.map((h, n) => (
                    <div
                      key={`${h.salaId}-${n}`}
                      style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, flexWrap: "wrap" }}
                    >
                      <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: h.color, flexShrink: 0 }} />
                      <strong style={{ minWidth: 120 }}>{h.horaTexto}</strong>
                      <span className="tenue">{h.salaNombre}</span>
                      <span className="tenue">· {horasYMinutos(h.minutos)}</span>
                      {/* Se puede agendar de una: el que pregunta suele estar del otro lado del
                          teléfono, y volver a la agenda a buscar el mismo día es perder el hueco. */}
                      <Link
                        href={`/panel/${slug}?fecha=${x.fecha}&vista=dia&nuevo=1&sala=${h.salaId}&hora=${h.horaTexto.slice(0, 5)}`}
                        className="pastilla"
                        style={{ padding: "3px 10px", fontSize: 12, marginLeft: "auto" }}
                      >
                        Agendar acá
                      </Link>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
