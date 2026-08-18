// app/panel/[slug]/gastos/page.tsx — en qué se va la plata del espacio. Solo administración.
//
// Es la otra mitad de Métricas: esa pantalla dice cuánto entra, esta cuánto sale. Sin las dos, la
// única cuenta posible es "facturé tanto", que no es lo que queda.
//
// El permiso es `finanzas.ver.agregada` — el mismo que Métricas, que ya distingue a quien ve los
// números del centro de quien solo ve lo suyo. Un profesional no tiene por qué saber cuánto sale
// la luz.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { Cabecera } from "../Cabecera.tsx";
import { actorDeSesion } from "../../../../src/lib/sesion.ts";
import { prisma } from "../../../../src/db/prisma.ts";
import { puede } from "../../../../src/lib/permisos.ts";
import { anularGasto, cargarGasto, ETIQUETA_RUBRO, gastosDelMes, RUBROS } from "../../../../src/servicios/plata/gastos.ts";
import { formatearPesos } from "../../../../src/dominio/tarifa.ts";
import { esPeriodoValido, nombreDePeriodo, periodoAnterior, periodoSiguiente } from "../../../../src/dominio/reporte.ts";
import { fechaEnZona } from "../../../../src/dominio/motor/zona.ts";

export default async function GastosPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ periodo?: string; ok?: string; error?: string }>;
}) {
  const { slug } = await params;
  const { periodo: periodoParam, ok: okParam, error: errorParam } = await searchParams;

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);
  // Esconder el formulario no es el control: la acción revalida el permiso igual (§6.2).
  if (!puede(actor.rol, "finanzas.ver.agregada")) redirect(`/panel/${slug}`);

  const sede = await prisma.sede.findFirst({ where: { operadorId: actor.operadorId, activa: true }, select: { zonaHoraria: true } });
  if (!sede) redirect(`/panel/${slug}`);

  const hoy = fechaEnZona(new Date(), sede.zonaHoraria);
  const hoyPeriodo = hoy.slice(0, 7);
  const periodo = periodoParam && esPeriodoValido(periodoParam) ? periodoParam : hoyPeriodo;

  const [{ gastos, porRubro, totalCent }, operador] = await Promise.all([
    gastosDelMes({ operadorId: actor.operadorId, periodo }),
    prisma.operador.findUniqueOrThrow({ where: { id: actor.operadorId }, select: { moneda: true } }),
  ]);
  const plata = (c: bigint) => formatearPesos(c, operador.moneda);
  const volverA = `/panel/${slug}/gastos?periodo=${periodo}`;
  // Para revalidar va la RUTA SOLA, sin query. `revalidatePath` toma un path: pasándole
  // "...?periodo=2026-08" no invalida nada y Next sigue sirviendo la versión cacheada — se carga
  // un gasto, la acción contesta "ok", y la tabla sigue mostrando el mes vacío.
  const rutaGastos = `/panel/${slug}/gastos`;

  async function guardar(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);
    const r = await cargarGasto(a, {
      rubro: formData.get("rubro"),
      detalle: formData.get("detalle"),
      monto: formData.get("monto"),
      fecha: formData.get("fecha"),
      proveedor: formData.get("proveedor") ?? undefined,
    });
    revalidatePath(rutaGastos);
    // Se vuelve al mes DEL GASTO cargado, no al que se estaba mirando: si se carga una factura de
    // agosto estando en septiembre, quedarse en septiembre parece que no se guardó nada.
    const destino = r.ok ? `/panel/${slug}/gastos?periodo=${String(formData.get("fecha") ?? "").slice(0, 7)}` : volverA;
    redirect(`${destino}${r.ok ? "&ok=1" : `&error=${r.error}`}`);
  }

  async function anular(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);
    const r = await anularGasto(a, { gastoId: formData.get("gastoId"), motivo: formData.get("motivo") });
    revalidatePath(rutaGastos);
    const q = !r.ok ? `&error=${r.error}` : !r.data.ok ? `&error=${r.data.error}` : "&ok=anulado";
    redirect(`${volverA}${q}`);
  }

  const AVISO: Record<string, string> = {
    "1": "Gasto cargado.",
    anulado: "Gasto anulado. Queda listado con el motivo y deja de sumar al total.",
  };
  const FALLA: Record<string, string> = {
    GASTO_INEXISTENTE: "No se encontró ese gasto.",
    YA_ANULADO: "Ese gasto ya estaba anulado.",
    SIN_PERMISO: "Tu rol no puede administrar los gastos del centro.",
    ENTRADA_INVALIDA: "Faltan datos: revisá el detalle, el importe y la fecha.",
  };

  const mayor = porRubro[0]?.montoCent ?? 0n;

  return (
    <>
      <Cabecera slug={slug} titulo="Gastos del espacio" />
      <main style={{ padding: 20, maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          <nav style={{ display: "flex", gap: 2 }}>
            <Link className="nav-circ" href={`?periodo=${periodoAnterior(periodo)}`} aria-label="Mes anterior">‹</Link>
            {periodo < hoyPeriodo && (
              <Link className="nav-circ" href={`?periodo=${periodoSiguiente(periodo)}`} aria-label="Mes siguiente">›</Link>
            )}
          </nav>
          <h2 style={{ margin: 0 }}>{nombreDePeriodo(periodo)}</h2>
          <span className="pildora" style={{ marginLeft: "auto", fontSize: 14 }}>
            Total del mes: <strong>{plata(totalCent)}</strong>
          </span>
        </div>

        {okParam && AVISO[okParam] && <p className="panel" style={{ padding: "10px 14px", margin: "0 0 12px", fontSize: 14 }}>{AVISO[okParam]}</p>}
        {errorParam && (
          <p className="panel" style={{ padding: "10px 14px", margin: "0 0 12px", fontSize: 14, color: "var(--error)" }}>
            {FALLA[errorParam] ?? "No se pudo completar la operación."}
          </p>
        )}

        {/* ── Cargar ────────────────────────────────────────────────────────── */}
        <form action={guardar} className="panel" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginBottom: 20 }}>
          <label style={{ display: "grid", gap: 4, margin: 0, fontSize: 13 }}>
            <span className="tenue">Rubro</span>
            <select name="rubro" required defaultValue="servicios" style={{ minWidth: 210 }}>
              {RUBROS.map((r) => (
                <option key={r} value={r}>{ETIQUETA_RUBRO[r]}</option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4, margin: 0, fontSize: 13, flex: "1 1 200px" }}>
            <span className="tenue">Detalle</span>
            <input name="detalle" required minLength={2} maxLength={200} placeholder="Factura de luz — agosto" />
          </label>
          <label style={{ display: "grid", gap: 4, margin: 0, fontSize: 13 }}>
            <span className="tenue">Proveedor</span>
            <input name="proveedor" maxLength={120} placeholder="opcional" style={{ width: 150 }} />
          </label>
          <label style={{ display: "grid", gap: 4, margin: 0, fontSize: 13 }}>
            <span className="tenue">Importe</span>
            <input name="monto" type="number" min="1" step="1" required placeholder="85000" style={{ width: 130 }} />
          </label>
          <label style={{ display: "grid", gap: 4, margin: 0, fontSize: 13 }}>
            <span className="tenue">Fecha</span>
            <input name="fecha" type="date" required defaultValue={hoy} max={hoy} />
          </label>
          <button type="submit">Cargar gasto</button>
          <p className="tenue" style={{ margin: 0, fontSize: 12, flexBasis: "100%" }}>
            La fecha manda sobre el mes: una factura del 30 de agosto cargada en septiembre es un
            costo de agosto.
          </p>
        </form>

        {/* ── Discriminado por rubro ────────────────────────────────────────── */}
        {porRubro.length > 0 && (
          <section style={{ marginBottom: 22 }}>
            <h2 style={{ marginTop: 0 }}>En qué se fue</h2>
            <div className="panel">
              {porRubro.map((r) => {
                // La barra es proporcional al rubro MÁS GRANDE, no al total: comparar contra el
                // total deja todas las barras cortas y no se ve cuál pesa. Acá lo que importa es
                // el orden entre rubros.
                const ancho = mayor > 0n ? Number((r.montoCent * 100n) / mayor) : 0;
                const parte = totalCent > 0n ? Number((r.montoCent * 1000n) / totalCent) / 10 : 0;
                return (
                  <div key={r.rubro} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 220px) 1fr auto", gap: 12, alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: 14 }}>{ETIQUETA_RUBRO[r.rubro]}</span>
                    <span style={{ background: "var(--panel-2)", borderRadius: 999, height: 10, overflow: "hidden" }}>
                      <span style={{ display: "block", width: `${ancho}%`, height: "100%", background: "var(--marca-500)", borderRadius: 999 }} />
                    </span>
                    <span className="num" style={{ fontSize: 14, whiteSpace: "nowrap" }}>
                      {plata(r.montoCent)} <span className="tenue" style={{ fontSize: 12 }}>{parte.toFixed(1)}%</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── El detalle ────────────────────────────────────────────────────── */}
        <h2>Los gastos del mes</h2>
        {gastos.length === 0 ? (
          <p className="tenue">No hay gastos cargados en {nombreDePeriodo(periodo)}.</p>
        ) : (
          <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Rubro</th>
                  <th>Detalle</th>
                  <th className="num">Importe</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {gastos.map((g) => (
                  <tr key={g.id} style={g.anulado ? { opacity: 0.55 } : undefined}>
                    <td style={{ whiteSpace: "nowrap" }}>{fechaEnZona(g.fecha, sede.zonaHoraria)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{ETIQUETA_RUBRO[g.rubro]}</td>
                    <td style={g.anulado ? { textDecoration: "line-through" } : undefined}>
                      {g.detalle}
                      {g.proveedor && <span className="tenue" style={{ fontSize: 12 }}> · {g.proveedor}</span>}
                      {g.anulado && g.motivoAnulado && (
                        <span className="tenue" style={{ fontSize: 12, textDecoration: "none", display: "block" }}>
                          anulado: {g.motivoAnulado}
                        </span>
                      )}
                    </td>
                    <td className="num" style={g.anulado ? { textDecoration: "line-through" } : undefined}>{plata(g.montoCent)}</td>
                    <td className="num">
                      {g.anulado ? (
                        <span className="tenue" style={{ fontSize: 12 }}>anulado</span>
                      ) : (
                        <form action={anular} style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <input type="hidden" name="gastoId" value={g.id} />
                          <input name="motivo" type="text" required minLength={3} maxLength={200} placeholder="motivo" style={{ width: 140 }} />
                          <button type="submit" className="btn-texto">Anular</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Total del mes (sin los anulados)</td>
                  <td className="num">{plata(totalCent)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
