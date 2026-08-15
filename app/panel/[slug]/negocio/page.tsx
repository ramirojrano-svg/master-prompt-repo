// app/panel/[slug]/negocio/page.tsx — ¿me queda algo? Solo administración.
//
// Métricas contesta "cuánto facturé y quién me debe". Esta contesta la que viene después. Muestra
// DOS resultados y no uno: devengado (facturado − gastos: si el modelo cierra) y caja (cobrado −
// gastos: si se puede pagar la luz este mes). Un centro con buen devengado y mala caja no tiene
// un problema de precios sino de cobranza — y con un solo número, uno de los dos queda invisible.

import { redirect } from "next/navigation";
import Link from "next/link";
import { Cabecera } from "../Cabecera.tsx";
import { actorDeSesion } from "../../../../src/lib/sesion.ts";
import { prisma } from "../../../../src/db/prisma.ts";
import { puede } from "../../../../src/lib/permisos.ts";
import { rentabilidad } from "../../../../src/servicios/reportes/rentabilidad.ts";
import { ETIQUETA_RUBRO, gastosDelMes } from "../../../../src/servicios/plata/gastos.ts";
import { formatearPesos } from "../../../../src/dominio/tarifa.ts";
import { esPeriodoValido, periodoAnterior } from "../../../../src/dominio/reporte.ts";
import { fechaEnZona } from "../../../../src/dominio/motor/zona.ts";
import { nombreDePeriodo, periodoSiguiente } from "../reportes/page.tsx";

/** Un porcentaje que viaja en décimas de punto. 703 ⇒ "70,3%". */
const pct = (d: number) => `${(d / 10).toFixed(1).replace(".", ",")}%`;

export default async function NegocioPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ periodo?: string }>;
}) {
  const { slug } = await params;
  const { periodo: periodoParam } = await searchParams;

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);
  if (!puede(actor.rol, "finanzas.ver.agregada")) redirect(`/panel/${slug}`);

  const sede = await prisma.sede.findFirst({ where: { operadorId: actor.operadorId, activa: true }, select: { zonaHoraria: true } });
  if (!sede) redirect(`/panel/${slug}`);
  const hoyPeriodo = fechaEnZona(new Date(), sede.zonaHoraria).slice(0, 7);
  const periodo = periodoParam && esPeriodoValido(periodoParam) ? periodoParam : hoyPeriodo;

  const r = await rentabilidad({ actor, periodo });
  if (!r) redirect(`/panel/${slug}`);
  const { porRubro } = await gastosDelMes({ operadorId: actor.operadorId, periodo });

  const plata = (c: bigint) => formatearPesos(c, r.moneda);
  const rojo = "var(--error)";
  const verde = "var(--ok)";
  const color = (c: bigint) => (c < 0n ? rojo : verde);

  // La escala de las barras: el mayor valor de la serie manda. Comparar contra un máximo fijo
  // aplastaría todos los meses de un centro chico contra el piso.
  const tope = r.historia.reduce((max, m) => {
    const alto = m.facturadoCent > m.gastosCent ? m.facturadoCent : m.gastosCent;
    return alto > max ? alto : max;
  }, 1n);
  // El mínimo de 2% es para que un mes chico se vea, no para inventar volumen: un CERO va en cero.
  // Una barra donde no hubo nada dice que hubo algo, y en un gráfico de plata eso no es un detalle.
  const altura = (c: bigint) => (c <= 0n ? "0%" : `${Math.max(2, Number((c * 100n) / tope))}%`);

  return (
    <>
      <Cabecera slug={slug} rol={actor.rol} actual="negocio" titulo="El negocio" />
      <main style={{ padding: 20, maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          <nav style={{ display: "flex", gap: 2 }}>
            <Link className="nav-circ" href={`?periodo=${periodoAnterior(periodo)}`} aria-label="Mes anterior">‹</Link>
            {periodo < hoyPeriodo && (
              <Link className="nav-circ" href={`?periodo=${periodoSiguiente(periodo)}`} aria-label="Mes siguiente">›</Link>
            )}
          </nav>
          <h2 style={{ margin: 0 }}>{nombreDePeriodo(periodo)}</h2>
        </div>

        {/* ── Los dos resultados ────────────────────────────────────────────── */}
        <section style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          <div className="panel">
            <p className="tenue" style={{ margin: 0, fontSize: 13 }}>Resultado del mes</p>
            <p style={{ fontSize: 30, margin: "6px 0 2px", fontWeight: 600, letterSpacing: "-0.02em", color: color(r.resultadoDevengadoCent) }}>
              {plata(r.resultadoDevengadoCent)}
            </p>
            <p className="tenue" style={{ margin: 0, fontSize: 12 }}>
              facturado − gastos · margen {pct(r.margenDevengadoDecimas)}
            </p>
            <p className="tenue" style={{ margin: "8px 0 0", fontSize: 12 }}>
              Lo que el mes generó, esté cobrado o no. Es el número que dice si el modelo cierra.
            </p>
          </div>

          <div className="panel">
            <p className="tenue" style={{ margin: 0, fontSize: 13 }}>Caja del mes</p>
            <p style={{ fontSize: 30, margin: "6px 0 2px", fontWeight: 600, letterSpacing: "-0.02em", color: color(r.resultadoCajaCent) }}>
              {plata(r.resultadoCajaCent)}
            </p>
            <p className="tenue" style={{ margin: 0, fontSize: 12 }}>
              cobrado − gastos · margen {pct(r.margenCajaDecimas)}
            </p>
            <p className="tenue" style={{ margin: "8px 0 0", fontSize: 12 }}>
              La plata que realmente pasó por la cuenta. Es la que paga la luz.
            </p>
          </div>
        </section>

        {/* ── De dónde salen esos dos números ───────────────────────────────── */}
        <section style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginTop: 14 }}>
          {[
            { t: "Facturado", v: plata(r.facturadoCent), p: "cargado a los profesionales" },
            { t: "Cobrado", v: plata(r.cobradoCent), p: `${pct(r.cobranzaDecimas)} de lo facturado` },
            { t: "Gastos", v: plata(r.gastosCent), p: <Link href={`/panel/${slug}/gastos?periodo=${periodo}`}>ver el detalle</Link> },
          ].map((c) => (
            <div key={c.t} className="panel" style={{ padding: 18 }}>
              <p className="tenue" style={{ margin: 0, fontSize: 13 }}>{c.t}</p>
              <p style={{ fontSize: 23, margin: "6px 0 2px", fontWeight: 600, letterSpacing: "-0.02em" }}>{c.v}</p>
              <p className="tenue" style={{ margin: 0, fontSize: 12 }}>{c.p}</p>
            </div>
          ))}
        </section>

        {/* Una diferencia grande entre los dos resultados no es un detalle: es el aviso de que el
            problema es de cobranza y no de precios. Se dice con palabras, no solo con números. */}
        {r.facturadoCent > 0n && r.cobranzaDecimas < 700 && (
          <p className="panel" style={{ padding: "12px 16px", marginTop: 14, fontSize: 14, borderLeft: `3px solid var(--alerta)` }}>
            Se cobró el <strong>{pct(r.cobranzaDecimas)}</strong> de lo facturado este mes. La
            diferencia entre el resultado y la caja es deuda de los profesionales, no un problema
            de precios: se corrige cobrando, no aumentando.
          </p>
        )}

        {/* ── La tendencia ──────────────────────────────────────────────────── */}
        <h2 style={{ marginTop: 26 }}>Los últimos seis meses</h2>
        <div className="panel">
          <div style={{ display: "flex", gap: 18, alignItems: "flex-end", height: 190, padding: "8px 0" }}>
            {r.historia.map((m) => (
              <div key={m.periodo} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%" }}>
                <div style={{ flex: 1, display: "flex", gap: 4, alignItems: "flex-end", width: "100%", justifyContent: "center" }}>
                  {/* Facturado y gastos, lado a lado: la distancia entre las dos barras ES el
                      resultado, y se lee de un vistazo sin hacer la resta. */}
                  <span title={`Facturado ${plata(m.facturadoCent)}`} style={{ width: "38%", height: altura(m.facturadoCent), background: "var(--marca-500)", borderRadius: "4px 4px 0 0" }} />
                  <span title={`Gastos ${plata(m.gastosCent)}`} style={{ width: "38%", height: altura(m.gastosCent), background: "var(--alerta)", borderRadius: "4px 4px 0 0", opacity: 0.75 }} />
                </div>
                <span className="tenue" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{m.periodo.slice(5)}/{m.periodo.slice(2, 4)}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: color(m.resultadoCent) }}>
                  {m.resultadoCent === 0n ? "—" : plata(m.resultadoCent)}
                </span>
              </div>
            ))}
          </div>
          <p className="tenue" style={{ margin: "10px 0 0", fontSize: 12, display: "flex", gap: 16 }}>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--marca-500)", borderRadius: 2, marginRight: 6 }} />Facturado</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: "var(--alerta)", opacity: 0.75, borderRadius: 2, marginRight: 6 }} />Gastos</span>
            <span>Debajo de cada mes, el resultado.</span>
          </p>
        </div>

        {/* ── En qué se fue ─────────────────────────────────────────────────── */}
        {porRubro.length > 0 && (
          <>
            <h2 style={{ marginTop: 26 }}>Los costos del mes, por rubro</h2>
            <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Rubro</th>
                    <th className="num">Importe</th>
                    <th className="num">De los gastos</th>
                    <th className="num">De lo facturado</th>
                  </tr>
                </thead>
                <tbody>
                  {porRubro.map((x) => (
                    <tr key={x.rubro}>
                      <td>{ETIQUETA_RUBRO[x.rubro]}</td>
                      <td className="num">{plata(x.montoCent)}</td>
                      <td className="num">{r.gastosCent > 0n ? pct(Number((x.montoCent * 1000n) / r.gastosCent)) : "—"}</td>
                      {/* Cuánto se lleva cada rubro de la facturación: es la lectura que dice si un
                          costo está fuera de escala para el tamaño del centro. */}
                      <td className="num">{r.facturadoCent > 0n ? pct(Number((x.montoCent * 1000n) / r.facturadoCent)) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className="num">{plata(r.gastosCent)}</td>
                    <td className="num">100,0%</td>
                    <td className="num">{r.facturadoCent > 0n ? pct(Number((r.gastosCent * 1000n) / r.facturadoCent)) : "—"}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </main>
    </>
  );
}
