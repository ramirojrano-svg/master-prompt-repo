// app/panel/[slug]/liquidaciones/[liquidacionId]/page.tsx — la cuenta del mes, para mandar.
//
// Es el documento que recibe el profesional. Hasta acá el cierre emitía un número y no había nada
// que enviarle: un total suelto no se paga, porque la primera pregunta siempre es "¿de dónde sale
// este importe?".
//
// Está pensada para imprimirse o guardarse como PDF —"Imprimir" del navegador y listo—, así que
// hay un bloque de estilos que al imprimir saca el menú, la barra y los botones: lo que queda en
// la hoja es el papel y nada más. Es la vía más corta a un PDF sin sumarle una librería al
// proyecto ni un servicio de terceros a la factura.

import { redirect } from "next/navigation";
import Link from "next/link";
import { Cabecera } from "../../Cabecera.tsx";
import { BotonImprimir } from "./BotonImprimir.tsx";
import { actorDeSesion } from "../../../../../src/lib/sesion.ts";
import { puede } from "../../../../../src/lib/permisos.ts";
import { detalleDeLiquidacion } from "../../../../../src/servicios/plata/detalle-liquidacion.ts";
import { formatearPesos } from "../../../../../src/dominio/tarifa.ts";
import { nombreDePeriodo } from "../../../../../src/dominio/reporte.ts";

const DIA_MES: Intl.DateTimeFormatOptions = { weekday: "short", day: "2-digit", month: "2-digit" };

export default async function LiquidacionPage({ params }: { params: Promise<{ slug: string; liquidacionId: string }> }) {
  const { slug, liquidacionId } = await params;

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);

  const d = await detalleDeLiquidacion({ operadorId: actor.operadorId, liquidacionId });
  // Inexistente y ajena dan lo mismo a propósito: distinguirlas le confirmaría a quien prueba ids
  // cuáles existen (§6.11).
  if (!d) redirect(`/panel/${slug}`);

  // El profesional ve LA SUYA. Es su cuenta y tiene derecho a mirarla; la del de al lado, no.
  const propia = actor.inquilinoId !== null && actor.inquilinoId === d.inquilinoId;
  if (!puede(actor.rol, "cuenta.ver.todas") && !(propia && puede(actor.rol, "cuenta.ver.propia"))) {
    redirect(`/panel/${slug}`);
  }

  const plata = (n: bigint) => formatearPesos(n, d.moneda);
  const dia = (x: Date) => x.toLocaleDateString("es-AR", DIA_MES);
  const fecha = (x: Date) => x.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });

  return (
    <>
      <Cabecera slug={slug} titulo={`Liquidación N° ${d.numero}`} />
      <main style={{ padding: 20, maxWidth: 860, margin: "0 auto" }}>
        {/* Al imprimir queda solo el papel: sin menú lateral, sin barra y sin botones. */}
        <style>{`
          @media print {
            .menu-lateral, .barra, .no-imprimir { display: none !important; }
            html, body { background: #fff !important; }
            .panel-contenido { padding-left: 0 !important; }
            main { max-width: none !important; padding: 0 !important; }
            .panel { border: 1px solid #ddd !important; box-shadow: none !important; }
            a { color: inherit !important; text-decoration: none !important; }
          }
        `}</style>

        <div className="no-imprimir" style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <Link className="pastilla" href={`/panel/${slug}/cobranza?periodo=${d.periodo}`}>‹ Cobranza</Link>
          <Link className="pastilla" href={`/panel/${slug}/inquilinos/${d.inquilinoId}?periodo=${d.periodo}`}>Ficha del profesional</Link>
          <BotonImprimir />
        </div>

        <article className="panel" style={{ padding: 26 }}>
          {/* ── Encabezado ─────────────────────────────────────────────── */}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{d.centro.nombre}</p>
              <p className="tenue" style={{ margin: "2px 0 0", fontSize: 13 }}>
                Liquidación de {nombreDePeriodo(d.periodo)}
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>N° {d.numero}</p>
              <p className="tenue" style={{ margin: "2px 0 0", fontSize: 13 }}>
                {d.emitidaAt ? `Emitida el ${fecha(d.emitidaAt)}` : "Sin emitir"}
              </p>
              <p className="tenue" style={{ margin: 0, fontSize: 13 }}>Vence el {fecha(d.venceEl)}</p>
            </div>
          </div>

          <hr style={{ border: 0, borderTop: "1px solid var(--borde)", margin: "18px 0" }} />

          <p style={{ margin: 0, fontSize: 13 }} className="tenue">Emitida a</p>
          <p style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 600 }}>{d.receptor}</p>
          {d.receptorCuit && <p className="tenue" style={{ margin: 0, fontSize: 13 }}>CUIT {d.receptorCuit}</p>}
          {d.facturaExterna && (
            <p className="tenue" style={{ margin: "2px 0 0", fontSize: 13 }}>
              Factura {d.facturaExterna.tipo} N° {d.facturaExterna.numero}
            </p>
          )}

          {/* ── El detalle ─────────────────────────────────────────────── */}
          <h2 style={{ fontSize: 15, marginTop: 24, marginBottom: 8 }}>Detalle</h2>
          {d.lineas.length === 0 ? (
            <p className="tenue">Esta liquidación no tiene renglones.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="lista-personas" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Fecha</th>
                    <th>Concepto</th>
                    <th className="num">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {d.lineas.map((l, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: "nowrap" }}>{dia(l.fecha)}</td>
                      <td>
                        {l.detalle}
                        {/* El nombre del concepto solo cuando el renglón no lo dice ya: repetir
                            "Uso de consultorio" en cuarenta filas idénticas es ruido. */}
                        {l.detalle !== l.concepto && (
                          <span className="tenue" style={{ fontSize: 12 }}> · {l.concepto}</span>
                        )}
                      </td>
                      <td className="num">{plata(l.montoCent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Los totales ────────────────────────────────────────────── */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
            <table style={{ minWidth: 280 }}>
              <tbody>
                {/* Sin IVA discriminado (alícuota 0) el subtotal ES el total: mostrar tres
                    renglones con el mismo número solo confunde. */}
                {d.alicuota > 0 && (
                  <>
                    <tr>
                      <td className="tenue" style={{ padding: "3px 12px 3px 0" }}>Subtotal</td>
                      <td className="num">{plata(d.subtotalCent)}</td>
                    </tr>
                    <tr>
                      <td className="tenue" style={{ padding: "3px 12px 3px 0" }}>IVA {d.alicuota / 10}%</td>
                      <td className="num">{plata(d.ivaCent)}</td>
                    </tr>
                  </>
                )}
                <tr>
                  <td style={{ padding: "6px 12px 6px 0", fontWeight: 600 }}>Total</td>
                  <td className="num" style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>{plata(d.totalCent)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ── Los pagos ──────────────────────────────────────────────── */}
          {d.pagos.length > 0 && (
            <>
              <h2 style={{ fontSize: 15, marginTop: 24, marginBottom: 8 }}>Pagos recibidos</h2>
              <table className="lista-personas" style={{ width: "100%" }}>
                <tbody>
                  {d.pagos.map((p, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: "nowrap" }}>{dia(p.fecha)}</td>
                      <td className="tenue" style={{ fontSize: 13 }}>
                        {p.medio ?? "sin medio registrado"}
                        {p.referencia && ` · comprobante ${p.referencia}`}
                      </td>
                      <td className="num">{plata(p.montoCent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <p style={{ margin: 0, fontSize: 15 }}>
              <span className="tenue">{d.saldoCent > 0n ? "Saldo a pagar" : d.saldoCent < 0n ? "A favor" : "Saldo"}</span>{" "}
              <b style={{ fontSize: 18, color: d.saldoCent > 0n ? "var(--error)" : undefined }}>
                {plata(d.saldoCent < 0n ? -d.saldoCent : d.saldoCent)}
              </b>
            </p>
          </div>

          <p className="tenue" style={{ marginTop: 22, fontSize: 12, lineHeight: 1.5 }}>
            Los importes de esta liquidación quedaron congelados al emitirla: no cambian si después
            se modifica el valor de la hora. Un cargo posterior al cierre entra en el mes siguiente,
            no en este papel.
          </p>
        </article>
      </main>
    </>
  );
}
