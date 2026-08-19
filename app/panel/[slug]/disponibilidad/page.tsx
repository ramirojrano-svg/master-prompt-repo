// app/panel/[slug]/disponibilidad/page.tsx — "Disponibilidad": qué horas quedan para ofrecer.
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
import { huecosLibres, HUECO_MIN_MIN } from "../../../../src/servicios/agenda/huecos.ts";
import { diasDelPeriodo, esPeriodoValido, horasYMinutos, nombreDePeriodo, periodoAnterior, periodoSiguiente } from "../../../../src/dominio/reporte.ts";
import { nombrarFecha } from "../../../../src/dominio/conflictos.ts";
import { fechaEnZona } from "../../../../src/dominio/motor/zona.ts";
import { prisma } from "../../../../src/db/prisma.ts";

const DIA_LARGO = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export default async function DisponibilidadPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ mes?: string; sala?: string; dow?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);
  // Mismo permiso que administrar consultorios: quien decide qué se alquila es quien puede ver qué
  // queda sin alquilar.
  if (!puede(actor.rol, "sala.administrar")) redirect(`/panel/${slug}`);

  const dow = sp.dow != null && /^[0-6]$/.test(sp.dow) ? Number(sp.dow) : null;

  // La ventana es un MES de calendario y no "los próximos N días": quien va a ofrecer un lugar
  // piensa en meses ("¿tenés algo en septiembre?"), y una ventana móvil hace que la misma pantalla
  // muestre algo distinto cada día sin que nadie haya cambiado nada.
  const sede = await prisma.sede.findFirst({ where: { operadorId: actor.operadorId, activa: true }, select: { zonaHoraria: true } });
  if (!sede) redirect(`/panel/${slug}`);
  const hoy = fechaEnZona(new Date(), sede.zonaHoraria);
  const mesActual = hoy.slice(0, 7);
  const mes = sp.mes && esPeriodoValido(sp.mes) && sp.mes >= mesActual ? sp.mes : mesActual;

  const delMes = diasDelPeriodo(mes);
  // En el mes corriente se arranca HOY: los huecos de ayer no se le ofrecen a nadie. En los
  // meses siguientes, desde el día 1.
  const arranque = mes === mesActual ? hoy : delMes[0]!;
  const ultimo = delMes.at(-1)!;

  const d = await huecosLibres({ actor, desdeFecha: arranque, hastaFecha: ultimo, dias: 62, salaId: sp.sala ?? null, diaSemana: dow });
  if (!d) redirect(`/panel/${slug}`);

  /** Un link de esta pantalla conservando los filtros que no cambian. */
  function href(extra: Record<string, string | null>): string {
    const q = new URLSearchParams();
    const base: Record<string, string | null> = { mes, sala: sp.sala ?? null, dow: dow == null ? null : String(dow), ...extra };
    for (const [k, v] of Object.entries(base)) if (v) q.set(k, v);
    return `/panel/${slug}/disponibilidad${q.size ? `?${q.toString()}` : ""}`;
  }

  const conAlgo = d.dias.filter((x) => x.huecos.length > 0);

  return (
    <>
      <Cabecera slug={slug} titulo="Disponibilidad" />

      <main style={{ padding: 20, maxWidth: 960, margin: "0 auto" }}>
        {/* El total arriba: es la respuesta corta a "cuánto me sobra". El detalle de abajo la explica. */}
        <section className="panel" style={{ padding: 22 }}>
          <p className="tenue" style={{ margin: 0, fontSize: 13 }}>
            Libre en {nombreDePeriodo(mes)}
            {mes === mesActual ? " (de hoy en adelante)" : ""}
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
          {/* Una flecha de cada lado del mes. Hacia atrás solo hasta el mes corriente: los huecos
              de un mes que ya pasó no se le pueden ofrecer a nadie, y dejar la flecha llevaría a
              una pantalla siempre vacía. */}
          <nav style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {mes > mesActual ? (
              <Link className="nav-circ" href={href({ mes: periodoAnterior(mes) })} aria-label="Mes anterior">‹</Link>
            ) : (
              <span className="nav-circ" aria-hidden style={{ opacity: 0.25 }}>‹</span>
            )}
            <strong style={{ minWidth: 150, textAlign: "center", fontSize: 15 }}>{nombreDePeriodo(mes)}</strong>
            <Link className="nav-circ" href={href({ mes: periodoSiguiente(mes) })} aria-label="Mes siguiente">›</Link>
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
            otro mes, otro consultorio, o sacando el filtro de día.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            {conAlgo.map((x) => (
              <section key={x.fecha} className="panel" style={{ padding: 16 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                  {/* `nombrarFecha` YA devuelve "lunes 24/8": anteponerle DIA_LARGO daba
                      "Lunes lunes 24/8". */}
                  <h2 style={{ margin: 0, fontSize: 15, textTransform: "capitalize" }}>{nombrarFecha(x.fecha)}</h2>
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
