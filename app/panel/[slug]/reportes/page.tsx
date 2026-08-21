// app/panel/[slug]/reportes/page.tsx — el panel de métricas del mes (§6.8).
//
// Todo número grande muestra su DENOMINADOR y su detalle: un "82% de ocupación" sin decir sobre
// qué, o un "facturado $3.200.000" que no se puede abrir por profesional, no sirve para decidir
// nada y menos para discutir con el contador. Cada profesional es un link a su detalle.

import { redirect } from "next/navigation";
import Link from "next/link";
import { AnilloVolumen, BarrasVolumen, BarrasVolumenAgrupadas, SERIES } from "./Graficos.tsx";
import { actorDeSesion } from "../../../../src/lib/sesion.ts";
import { puede } from "../../../../src/lib/permisos.ts";
import { reporteMensual } from "../../../../src/servicios/reportes/mensual.ts";
import { rentabilidad } from "../../../../src/servicios/reportes/rentabilidad.ts";
import { ETIQUETA_RUBRO, gastosDelMes } from "../../../../src/servicios/plata/gastos.ts";
import { formatearPesos } from "../../../../src/dominio/tarifa.ts";
import { esPeriodoValido, horasYMinutos, nombreDePeriodo, periodoAnterior, periodoSiguiente } from "../../../../src/dominio/reporte.ts";
import { fechaEnZona } from "../../../../src/dominio/motor/zona.ts";
import { prisma } from "../../../../src/db/prisma.ts";
import { Logo } from "../../../Logo.tsx";

export default async function ReportesPage({
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

  // El mes por defecto es el corriente EN LA ZONA DE LA SEDE, resuelto server-side: clavar una
  // zona acá es el bug de §14.4 otra vez.
  const sede = await prisma.sede.findFirst({
    where: { operadorId: actor.operadorId, activa: true },
    select: { zonaHoraria: true },
  });
  if (!sede) redirect(`/panel/${slug}`);
  const hoyPeriodo = fechaEnZona(new Date(), sede.zonaHoraria).slice(0, 7);
  const periodo = periodoParam && esPeriodoValido(periodoParam) ? periodoParam : hoyPeriodo;

  const r = await reporteMensual({ actor, periodo });
  if (!r) redirect(`/panel/${slug}`);

  // Métricas y Negocio eran dos pantallas y son una sola pregunta hecha en dos mitades: "cuánto
  // facturé y quién me debe" no se puede leer sin "cuánto me costó". Separadas, la del resultado
  // se miraba poco y la de facturación se leía como si fuera la ganancia.
  const neg = await rentabilidad({ actor, periodo });
  const { porRubro } = await gastosDelMes({ operadorId: actor.operadorId, periodo });

  const plata = (c: bigint) => formatearPesos(c, r.moneda);
  const conActividad = r.profesionales.filter((p) => p.reservas > 0 || p.facturadoCent !== 0n || p.pagadoCent !== 0n);
  const quietos = r.profesionales.length - conActividad.length;

  // Los conjuntos que alimentan los gráficos. Se filtra lo que no tiene nada que mostrar: una
  // barra en cero no informa, solo empuja la escala y achica a las demás.
  const conFacturacion = r.salas.filter((s) => s.importeCent > 0n);
  const conApertura = r.salas.filter((s) => s.aperturaMin > 0);
  const topHoras = [...conActividad].filter((p) => p.minutos > 0).sort((a, b) => b.minutos - a.minutos).slice(0, 6);

  /** Un porcentaje que viaja en décimas de punto. 703 ⇒ "70,3%". */
  const pct = (d: number) => `${(d / 10).toFixed(1).replace(".", ",")}%`;
  const color = (c: bigint) => (c < 0n ? "var(--error)" : "var(--ok)");

  const tarjetas = [
    { titulo: "Facturado en el mes", valor: plata(r.totales.facturadoCent), pie: `${r.totales.reservas} turnos · ${r.totales.profesionalesConActividad} profesionales` },
    { titulo: "Cobrado en el mes", valor: plata(r.totales.cobradoCent), pie: "pagos con fecha de este mes" },
    { titulo: "Ocupación", valor: `${r.totales.ocupacionPct}%`, pie: `${horasYMinutos(r.totales.minutos)} vendidas de ${horasYMinutos(r.totales.aperturaMin)} abiertas` },
  ];

  return (
    <>
      <header className="barra">
        <Link href={`/panel/${slug}`} style={{ display: "flex", alignItems: "center" }} aria-label="Volver a la agenda">
          <Logo alto={26} variante="compacto" />
        </Link>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>Negocio · {nombreDePeriodo(periodo)}</h1>
        <nav style={{ display: "flex", gap: 2 }}>
          <Link className="nav-circ" href={`?periodo=${periodoAnterior(periodo)}`} aria-label="Mes anterior">
            ‹
          </Link>
          {periodo < hoyPeriodo && (
            <Link className="nav-circ" href={`?periodo=${periodoSiguiente(periodo)}`} aria-label="Mes siguiente">
              ›
            </Link>
          )}
        </nav>
        <span style={{ marginLeft: "auto" }} />
      </header>

      <main style={{ padding: 20, maxWidth: 1120, margin: "0 auto" }}>
        {neg && (
          <>
          {/* ── Los dos resultados ────────────────────────────────────────────── */}
          <section style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <div className="panel">
              <p className="tenue" style={{ margin: 0, fontSize: 13 }}>Resultado del mes</p>
              <p style={{ fontSize: 30, margin: "6px 0 2px", fontWeight: 600, letterSpacing: "-0.02em", color: color(neg.resultadoDevengadoCent) }}>
                {plata(neg.resultadoDevengadoCent)}
              </p>
              <p className="tenue" style={{ margin: 0, fontSize: 12 }}>
                facturado − gastos · margen {pct(neg.margenDevengadoDecimas)}
              </p>
              <p className="tenue" style={{ margin: "8px 0 0", fontSize: 12 }}>
                Lo que el mes generó, esté cobrado o no. Es el número que dice si el modelo cierra.
              </p>
            </div>

            <div className="panel">
              <p className="tenue" style={{ margin: 0, fontSize: 13 }}>Caja del mes</p>
              <p style={{ fontSize: 30, margin: "6px 0 2px", fontWeight: 600, letterSpacing: "-0.02em", color: color(neg.resultadoCajaCent) }}>
                {plata(neg.resultadoCajaCent)}
              </p>
              <p className="tenue" style={{ margin: 0, fontSize: 12 }}>
                cobrado − gastos · margen {pct(neg.margenCajaDecimas)}
              </p>
              <p className="tenue" style={{ margin: "8px 0 0", fontSize: 12 }}>
                La plata que realmente pasó por la cuenta. Es la que paga la luz.
              </p>
            </div>
          </section>

          {/* ── De dónde salen esos dos números ───────────────────────────────── */}
          <section style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginTop: 14 }}>
            {[
              { t: "Facturado", v: plata(neg.facturadoCent), p: "cargado a los profesionales" },
              { t: "Cobrado", v: plata(neg.cobradoCent), p: `${pct(neg.cobranzaDecimas)} de lo facturado` },
              { t: "Gastos", v: plata(neg.gastosCent), p: <Link href={`/panel/${slug}/gastos?periodo=${periodo}`}>ver el detalle</Link> },
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
          {neg.facturadoCent > 0n && neg.cobranzaDecimas < 700 && (
            <p className="panel" style={{ padding: "12px 16px", marginTop: 14, fontSize: 14, borderLeft: `3px solid var(--alerta)` }}>
              Se cobró el <strong>{pct(neg.cobranzaDecimas)}</strong> de lo facturado este mes. La
              diferencia entre el resultado y la caja es deuda de los profesionales, no un problema
              de precios: se corrige cobrando, no aumentando.
            </p>
          )}

          {/* ── La tendencia ──────────────────────────────────────────────────── */}
          <h2 style={{ marginTop: 26 }}>Los últimos seis meses</h2>
          {/* Antes esto se dibujaba con divs y altos en porcentaje, y en la misma pantalla
              convivían dos lenguajes visuales para decir lo mismo. Ahora usa el mismo gráfico
              isométrico que el resto: la altura de la cara frontal codifica el valor y las barras
              se comparan a ojo sin que el dibujo mienta. */}
          <div className="panel">
            <BarrasVolumenAgrupadas
              series={[
                { nombre: "Facturado", color: SERIES[0]! },
                { nombre: "Gastos", color: SERIES[5]! },
              ]}
              grupos={neg.historia.map((m) => ({
                etiqueta: `${m.periodo.slice(5)}/${m.periodo.slice(2, 4)}`,
                valores: [Number(m.facturadoCent), Number(m.gastosCent)],
                textos: [plata(m.facturadoCent), plata(m.gastosCent)],
                // Debajo de cada mes, el resultado: es la resta que si no hay que hacer a ojo.
                pie: m.resultadoCent === 0n ? "—" : plata(m.resultadoCent),
                pieColor: color(m.resultadoCent),
              }))}
            />
            <p className="tenue" style={{ margin: "10px 0 0", fontSize: 12, display: "flex", gap: 16, flexWrap: "wrap" }}>
              <span><span style={{ display: "inline-block", width: 10, height: 10, background: SERIES[0], borderRadius: 2, marginRight: 6 }} />Facturado</span>
              <span><span style={{ display: "inline-block", width: 10, height: 10, background: SERIES[5], borderRadius: 2, marginRight: 6 }} />Gastos</span>
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
                        <td className="num">{neg.gastosCent > 0n ? pct(Number((x.montoCent * 1000n) / neg.gastosCent)) : "—"}</td>
                        {/* Cuánto se lleva cada rubro de la facturación: es la lectura que dice si un
                            costo está fuera de escala para el tamaño del centro. */}
                        <td className="num">{neg.facturadoCent > 0n ? pct(Number((x.montoCent * 1000n) / neg.facturadoCent)) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="num">{plata(neg.gastosCent)}</td>
                      <td className="num">100,0%</td>
                      <td className="num">{neg.facturadoCent > 0n ? pct(Number((neg.gastosCent * 1000n) / neg.facturadoCent)) : "—"}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
          </>
        )}

        <h2 style={{ marginTop: 26 }}>El mes en números</h2>
        <section style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
          {tarjetas.map((t) => (
            <div key={t.titulo} className="panel" style={{ padding: 18 }}>
              <p className="tenue" style={{ margin: 0, fontSize: 13 }}>{t.titulo}</p>
              <p style={{ fontSize: 26, margin: "6px 0 2px", fontWeight: 600, letterSpacing: "-0.02em" }}>{t.valor}</p>
              <p className="tenue" style={{ margin: 0, fontSize: 12 }}>{t.pie}</p>
            </div>
          ))}
        </section>

        {r.sinDetallarCent !== 0n && (
          <p className="error" style={{ marginTop: 14 }}>
            Atención: {plata(r.sinDetallarCent)} facturados no se pudieron atribuir a ningún profesional del detalle.
          </p>
        )}

        {/* ── Gráficos ──────────────────────────────────────────────────── */}
        {conFacturacion.length > 0 && (
          <section style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", marginTop: 22 }}>
            {/* Facturado / cobrado / deuda y no "facturado por consultorio": eso último ya lo
                cuenta el anillo de al lado, y con tres consultorios parecidos daban tres barras
                casi iguales, que no dicen nada. Estas tres SÍ se separan, y la distancia entre
                lo facturado y lo cobrado es la pregunta que el dueño mira primero. */}
            <div className="panel">
              <h2 style={{ marginTop: 0, fontSize: 15 }}>Facturado, cobrado y deuda</h2>
              <BarrasVolumen
                datos={[
                  { etiqueta: "Facturado", valor: Number(r.totales.facturadoCent), texto: plata(r.totales.facturadoCent) },
                  { etiqueta: "Cobrado", valor: Number(r.totales.cobradoCent), texto: plata(r.totales.cobradoCent) },
                ]}
              />
              <p className="tenue" style={{ margin: "6px 0 0", fontSize: 12 }}>
                La deuda es acumulada de todos los meses; lo facturado y lo cobrado son de este mes.
              </p>
            </div>

            <div className="panel">
              <h2 style={{ marginTop: 0, fontSize: 15 }}>Participación en la facturación</h2>
              <AnilloVolumen
                datos={conFacturacion.map((s) => ({
                  etiqueta: s.nombre,
                  valor: Number(s.importeCent),
                  texto: formatearPesos(s.importeCent, r.moneda),
                }))}
              />
            </div>

            <div className="panel">
              <h2 style={{ marginTop: 0, fontSize: 15 }}>Ocupación por consultorio</h2>
              <BarrasVolumen datos={conApertura.map((s) => ({ etiqueta: s.nombre, valor: s.ocupacionPct, texto: `${s.ocupacionPct}%` }))} />
              <p className="tenue" style={{ margin: "6px 0 0", fontSize: 12 }}>
                Sobre las horas que ese consultorio ABRIÓ en el mes, no sobre un mes teórico.
              </p>
            </div>

            {/* A lo ancho: seis barras en una tarjeta de un tercio dejan los nombres ilegibles. */}
            <div className="panel" style={{ gridColumn: "1 / -1" }}>
              <h2 style={{ marginTop: 0, fontSize: 15 }}>Horas usadas · los 6 que más</h2>
              <BarrasVolumen
                // Sin la especialidad entre paréntesis: al pie de una barra entra el nombre o
                // entra el paréntesis, y cortado a la mitad no se entiende ninguno de los dos.
                datos={topHoras.map((x) => ({ etiqueta: x.nombre.replace(/\s*\(.*\)$/, ""), valor: x.minutos, texto: horasYMinutos(x.minutos) }))}
              />
            </div>
          </section>
        )}

        <p className="tenue" style={{ fontSize: 12, marginTop: 22 }}>
          Un turno cuenta en el mes en que empieza, con la hora del centro ({r.tz}). Lo facturado
          sale del libro de cuenta corriente, no de multiplicar horas por precio: si hubo un ajuste
          o una nota de crédito, acá está.
        </p>
      </main>
    </>
  );
}
