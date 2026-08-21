// app/panel/[slug]/cierre/page.tsx — cerrar el mes y emitir la liquidación de cada profesional.
//
// El motor de esto existía desde hace tiempo y no tenía pantalla: era la pieza que faltaba entre
// "sé cuánto me deben" y "les emití la cuenta del mes".
//
// Lo que se ve ANTES de apretar es exactamente lo que se va a cerrar: la suma de los cargos del
// mes que todavía no entraron en ninguna liquidación. No es "lo que facturó" ni "lo que debe" —es
// lo que este cierre va a reclamar—, y por eso sale de la misma consulta que después reclama.
//
// Un mes cerrado NO se recalcula: los importes quedan congelados en la fila. Si después aparece un
// cargo nuevo de ese mes, se lo lleva un cierre posterior; el papel emitido no cambia.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { Cabecera } from "../Cabecera.tsx";
import { actorDeSesion } from "../../../../src/lib/sesion.ts";
import { prisma } from "../../../../src/db/prisma.ts";
import { puede } from "../../../../src/lib/permisos.ts";
import { pendientesDeCierre, liquidacionesDeNoFacturables, cerrarMesDe, cerrarMesTodos } from "../../../../src/servicios/plata/cierre.ts";
import { formatearPesos } from "../../../../src/dominio/tarifa.ts";
import { nombreDePeriodo, periodoAnterior, periodoSiguiente, venceElDelPeriodo } from "../../../../src/dominio/reporte.ts";
import { periodoDeTrabajo } from "../../../../src/servicios/plata/periodo-trabajo.ts";
import { datosDeCobro } from "../../../../src/servicios/config/cobro.ts";
import { fechaEnZona } from "../../../../src/dominio/motor/zona.ts";
import { BotonEnviar } from "../BotonEnviar.tsx";
import { IconoDocumento } from "../../../Iconos.tsx";

export default async function CierrePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ periodo?: string; ok?: string; error?: string; n?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);
  if (!puede(actor.rol, "periodo.cerrar")) redirect(`/panel/${slug}`);

  const [operador, sede] = await Promise.all([
    prisma.operador.findUniqueOrThrow({ where: { id: actor.operadorId }, select: { moneda: true } }),
    prisma.sede.findFirst({ where: { operadorId: actor.operadorId, activa: true }, select: { zonaHoraria: true } }),
  ]);
  if (!sede) redirect(`/panel/${slug}`);

  const hoy = fechaEnZona(new Date(), sede.zonaHoraria);
  // Por default se trabaja el mes ANTERIOR —el mes en curso todavía está sumando horas—, salvo que
  // ese mes esté vacío: ahí se abre el mes en curso, que es el único que tiene algo para mostrar.
  const periodo = await periodoDeTrabajo({ operadorId: actor.operadorId, hoy: hoy.slice(0, 7), pedido: sp.periodo });
  const [filas, huerfanas, cobro] = await Promise.all([
    pendientesDeCierre({ operadorId: actor.operadorId, periodo }),
    liquidacionesDeNoFacturables({ operadorId: actor.operadorId, periodo }),
    datosDeCobro(actor.operadorId),
  ]);

  const plata = (c: bigint) => formatearPesos(c, operador.moneda);
  // Los que tienen pendiente y NO están cerrados: son los que el botón puede resolver.
  const conPendiente = filas.filter((f) => f.pendientes > 0 && !f.liquidacion);
  // Y los que quedaron a mitad de camino: se les cerró el mes y DESPUÉS aparecieron cargos de ese
  // mismo mes. No pueden entrar en ninguna liquidación —solo hay una por mes y ya se emitió— así
  // que es plata que nadie va a cobrar si no se la ve. Por eso se avisa fuerte.
  const tardios = filas.filter((f) => f.pendientes > 0 && f.liquidacion);
  const tardioCent = tardios.reduce((acc, f) => acc + f.pendienteCent, 0n);
  const yaCerradas = filas.filter((f) => f.liquidacion);
  const totalPendiente = conPendiente.reduce((acc, f) => acc + f.pendienteCent, 0n);
  // El día que el centro tenga configurado, del mes SIGUIENTE al facturado: se cierra agosto y se
  // cobra en septiembre. Antes eran "diez días desde hoy", lo que corría el vencimiento según el
  // día en que uno se acordaba de cerrar — dos meses seguidos vencían en fechas distintas. Sigue
  // siendo un default: el campo se puede cambiar antes de emitir.
  const venceDefault = venceElDelPeriodo(periodo, cobro.diaVencimiento);
  const volverA = `/panel/${slug}/cierre?periodo=${periodo}`;

  async function cerrarUno(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);
    const r = await cerrarMesDe(a, {
      periodo: formData.get("periodo"),
      inquilinoId: formData.get("inquilinoId"),
      venceEl: formData.get("venceEl"),
    });
    revalidatePath(`/panel/${slug}/cierre`);
    const qs = !r.ok ? `&error=${r.error}` : r.data.ok ? `&ok=uno&n=${r.data.numero}` : `&error=${r.data.error}`;
    redirect(`${volverA}${qs}`);
  }

  async function cerrarTodos(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);
    const r = await cerrarMesTodos(a, { periodo: formData.get("periodo"), venceEl: formData.get("venceEl") });
    revalidatePath(`/panel/${slug}/cierre`);
    const qs = !r.ok ? `&error=${r.error}` : `&ok=todos&n=${r.data.cerradas}`;
    redirect(`${volverA}${qs}`);
  }

  return (
    <>
      <Cabecera slug={slug} titulo="Cierre de mes" />
      <main style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <nav style={{ display: "flex", gap: 6 }}>
            <Link className="nav-circ" href={`?periodo=${periodoAnterior(periodo)}`} aria-label="Mes anterior">‹</Link>
            <Link className="nav-circ" href={`?periodo=${periodoSiguiente(periodo)}`} aria-label="Mes siguiente">›</Link>
          </nav>
          <h2 style={{ margin: 0 }}>{nombreDePeriodo(periodo)}</h2>

          {/* Los datos del mes, afuera. Son enlaces comunes y no botones porque lo que devuelven
              es un archivo: el navegador lo baja solo y se abre en Excel. Van pegados al mes,
              porque lo que se baja es SIEMPRE el mes que se está mirando. */}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a className="pastilla" style={{ padding: "6px 12px", fontSize: 12 }} href={`/panel/${slug}/exportar?que=movimientos&periodo=${periodo}`}>
              ↓ Movimientos (CSV)
            </a>
            <a className="pastilla" style={{ padding: "6px 12px", fontSize: 12 }} href={`/panel/${slug}/exportar?que=turnos&periodo=${periodo}`}>
              ↓ Turnos (CSV)
            </a>
          </div>
        </div>

        {sp.ok === "uno" && <p className="aviso-ok">Liquidación N° {sp.n} emitida.</p>}
        {sp.ok === "todos" && (
          <p className="aviso-ok">
            {sp.n === "0" ? "No había nada para cerrar." : `${sp.n} ${Number(sp.n) === 1 ? "liquidación emitida" : "liquidaciones emitidas"}.`}
          </p>
        )}
        {sp.error === "NADA_QUE_LIQUIDAR" && <p className="aviso-error">Ese profesional no tiene cargos sin liquidar en {nombreDePeriodo(periodo)}.</p>}
        {sp.error === "YA_LIQUIDADO" && <p className="aviso-error">Ese mes ya estaba cerrado para ese profesional. No se emitió nada nuevo.</p>}
        {sp.error === "SIN_PERMISO" && <p className="aviso-error">Tu rol no puede cerrar meses.</p>}

        {/* Un papel numerado no puede desaparecer sin que nadie se entere. */}
        {huerfanas.length > 0 && (
          <div className="panel" style={{ padding: 18, marginBottom: 16, borderLeft: "4px solid var(--alerta)" }}>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>
              {huerfanas.length === 1 ? "Hay una liquidación emitida" : `Hay ${huerfanas.length} liquidaciones emitidas`} a nombre de quien no factura
            </h2>
            <p className="tenue" style={{ margin: "6px 0 10px", fontSize: 13, lineHeight: 1.5 }}>
              Se emitieron antes de destildarle <b>factura</b> en la ficha. Ya no se reclaman —por
              eso no están en Cobranza— pero el número existe, así que se muestran acá para que no
              desaparezcan sin dejar rastro. Casi siempre es una ficha duplicada que se cerró por
              error.
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.7 }}>
              {huerfanas.map((h) => (
                <li key={h.id}>
                  <Link href={`/panel/${slug}/liquidaciones/${h.id}`}>N° {h.numero}</Link> · {h.nombre} · {plata(h.totalCent)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {tardios.length > 0 && (
          <div className="panel" style={{ padding: 18, marginBottom: 16, borderLeft: "4px solid var(--alerta)" }}>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>
              {plata(tardioCent)} quedaron fuera del cierre de {nombreDePeriodo(periodo)}
            </h2>
            <p className="tenue" style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5 }}>
              A {tardios.length === 1 ? "un profesional" : `${tardios.length} profesionales`} se les cerró el
              mes y <b>después</b> aparecieron cargos de ese mismo mes —una reserva cargada tarde, o un
              precio puesto después—. No pueden entrar en la liquidación ya emitida: hay una sola por
              mes y sus importes están congelados.
            </p>
            <p className="tenue" style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.5 }}>
              Se cobran aparte, o se los suma al mes siguiente. Lo importante es que no desaparezcan:
              por eso están acá abajo marcados en rojo.
            </p>
          </div>
        )}

        {/* ── Lo que falta cerrar ─────────────────────────────────────────── */}
        <section className="panel" style={{ padding: 22 }}>
          <p className="tenue" style={{ margin: 0, fontSize: 13 }}>Pendiente de cerrar</p>
          <p style={{ fontSize: 34, margin: "4px 0 2px", fontWeight: 600, letterSpacing: "-0.02em" }}>{plata(totalPendiente)}</p>
          <p className="tenue" style={{ margin: 0, fontSize: 13 }}>
            {/* Cero pendiente tiene DOS causas que no significan lo mismo: que se cerró todo, o
                que nunca hubo nada. Decir "ya están en una liquidación" cuando el mes está vacío
                es afirmar un trabajo que nadie hizo. */}
            {conPendiente.length > 0
              ? `en ${conPendiente.length} ${conPendiente.length === 1 ? "profesional" : "profesionales"}`
              : filas.length === 0
                ? `No hubo movimientos en ${nombreDePeriodo(periodo)}: no hay nada para cerrar.`
                : "Nada: todos los cargos de este mes ya están en una liquidación."}
          </p>

          {conPendiente.length > 0 && (
            <form action={cerrarTodos} style={{ marginTop: 18, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <input type="hidden" name="periodo" value={periodo} />
              <div>
                <label htmlFor="venceEl" style={{ marginTop: 0 }}>Vence el</label>
                <input id="venceEl" name="venceEl" type="date" required defaultValue={venceDefault} style={{ width: "auto" }} />
              </div>
              <BotonEnviar enviando="Cerrando…">Cerrar el mes de todos</BotonEnviar>
            </form>
          )}

          <p className="tenue" style={{ margin: "14px 0 0", fontSize: 12, lineHeight: 1.5 }}>
            Cerrar emite la liquidación de cada profesional con su número, y <b>congela</b> los
            importes: un mes cerrado da siempre el mismo total. Los pagos no entran —esto es lo que
            se cobra, no lo que se cobró—. Y no se puede cerrar dos veces el mismo mes.
          </p>
        </section>

        {/* ── Profesional por profesional ─────────────────────────────────── */}
        <h2 style={{ marginTop: 26 }}>Profesional por profesional</h2>
        {filas.length === 0 ? (
          <p className="tenue">
            No hay movimientos en {nombreDePeriodo(periodo)}. <Link href={`/panel/${slug}/reportes?periodo=${periodo}`}>Ver el mes en Negocio</Link>
          </p>
        ) : (
          <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
            <table className="lista-personas">
              <thead>
                <tr>
                  <th>Profesional</th>
                  <th className="num">Cargos</th>
                  <th className="num">Pendiente</th>
                  <th>Liquidación</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.inquilinoId}>
                    <td>
                      <Link href={`/panel/${slug}/inquilinos/${f.inquilinoId}?periodo=${periodo}`}>{f.nombre}</Link>
                      {/* A nombre de quién sale el papel: es el dato que se mira al momento de cobrar. */}
                      {f.pagador && <span className="tenue" style={{ fontSize: 12 }}> · abona {f.pagador}</span>}
                    </td>
                    <td className="num">{f.pendientes || "—"}</td>
                    <td className="num" style={f.pendientes > 0 && f.liquidacion ? { color: "var(--error)", fontWeight: 600 } : undefined}>
                      {f.pendientes ? plata(f.pendienteCent) : "—"}
                    </td>
                    <td>
                      {f.liquidacion ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 9, whiteSpace: "nowrap" }}>
                          {/* Dos cosas distintas, dos destinos. El ícono BAJA el archivo —es un
                              <a> y no un <Link> porque es una descarga, no una navegación: con
                              Link, Next precargaría la ruta y trataría la respuesta como una
                              página—. El número ABRE el papel, que es desde donde se manda por
                              mail. Antes el ícono hacía las dos veces lo mismo. */}
                          <a
                            href={`/panel/${slug}/liquidaciones/${f.liquidacion.id}/pdf`}
                            title={`Descargar la liquidación de ${f.nombre}`}
                            aria-label={`Descargar la liquidación de ${f.nombre}`}
                            style={{ display: "flex", flexShrink: 0 }}
                          >
                            <IconoDocumento tam={20} />
                          </a>
                          <Link
                            href={`/panel/${slug}/liquidaciones/${f.liquidacion.id}`}
                            title={`Ver la liquidación N° ${f.liquidacion.numero}`}
                          >
                            <b>N° {f.liquidacion.numero}</b> · {plata(f.liquidacion.totalCent)}
                          </Link>
                        </span>
                      ) : (
                        <span className="tenue">sin cerrar</span>
                      )}
                    </td>
                    <td className="num">
                      {/* Con el mes ya cerrado el botón no se ofrece: apretarlo solo daría un error.
                          En su lugar se dice qué pasó, que es lo que hace falta saber. */}
                      {f.pendientes > 0 && f.liquidacion ? (
                        <span className="tenue" style={{ fontSize: 12 }}>fuera del cierre</span>
                      ) : f.pendientes > 0 ? (
                        <form action={cerrarUno}>
                          <input type="hidden" name="periodo" value={periodo} />
                          <input type="hidden" name="inquilinoId" value={f.inquilinoId} />
                          <input type="hidden" name="venceEl" value={venceDefault} />
                          <BotonEnviar enviando="…">Cerrar</BotonEnviar>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {yaCerradas.length > 0 && (
          <p className="tenue" style={{ marginTop: 14, fontSize: 13 }}>
            {yaCerradas.length} {yaCerradas.length === 1 ? "liquidación emitida" : "liquidaciones emitidas"} en{" "}
            {nombreDePeriodo(periodo)}, por {plata(yaCerradas.reduce((acc, f) => acc + (f.liquidacion?.totalCent ?? 0n), 0n))}.
          </p>
        )}
      </main>
    </>
  );
}
