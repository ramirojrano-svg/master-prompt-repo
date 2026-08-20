// app/panel/[slug]/cobranza/page.tsx — a quién hay que reclamarle.
//
// Es la pantalla del trabajo de todos los días una vez cerrado el mes: quién pagó, quién debe, y
// a quién ya se le venció. Antes, para saberlo, había que abrir las 29 fichas de a una.
//
// El orden de las filas ES la respuesta: primero lo vencido, después lo que más falta cobrar. Una
// lista alfabética obliga a leerla entera para encontrar por dónde empezar.

import { redirect } from "next/navigation";
import Link from "next/link";
import { Cabecera } from "../Cabecera.tsx";
import { actorDeSesion } from "../../../../src/lib/sesion.ts";
import { prisma } from "../../../../src/db/prisma.ts";
import { puede } from "../../../../src/lib/permisos.ts";
import { cobranzaDelMes } from "../../../../src/servicios/plata/cobranza.ts";
import { formatearPesos } from "../../../../src/dominio/tarifa.ts";
import { esPeriodoValido, nombreDePeriodo, periodoAnterior, periodoSiguiente } from "../../../../src/dominio/reporte.ts";
import { fechaEnZona } from "../../../../src/dominio/motor/zona.ts";

export default async function CobranzaPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ periodo?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);
  // Ver quién debe es finanzas del centro entero: el mismo permiso que Negocio.
  if (!puede(actor.rol, "finanzas.ver.agregada")) redirect(`/panel/${slug}`);

  const sede = await prisma.sede.findFirst({ where: { operadorId: actor.operadorId, activa: true }, select: { zonaHoraria: true } });
  if (!sede) redirect(`/panel/${slug}`);

  const hoy = fechaEnZona(new Date(), sede.zonaHoraria);
  // El mes ANTERIOR por default, igual que el cierre: es el que ya se emitió y el que se está
  // cobrando. El mes en curso todavía se está armando.
  const periodo = sp.periodo && esPeriodoValido(sp.periodo) ? sp.periodo : periodoAnterior(hoy.slice(0, 7));
  const c = await cobranzaDelMes({ operadorId: actor.operadorId, periodo });
  if (!c) redirect(`/panel/${slug}/cobranza`);

  const plata = (n: bigint) => formatearPesos(n, c.moneda);
  const conDeuda = c.filas.filter((f) => f.pendienteCent > 0n);
  const fecha = (d: Date) => d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });

  return (
    <>
      <Cabecera slug={slug} titulo="Cobranza" />
      <main style={{ padding: 20, maxWidth: 980, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <nav style={{ display: "flex", gap: 6 }}>
            <Link className="nav-circ" href={`?periodo=${periodoAnterior(periodo)}`} aria-label="Mes anterior">‹</Link>
            <Link className="nav-circ" href={`?periodo=${periodoSiguiente(periodo)}`} aria-label="Mes siguiente">›</Link>
          </nav>
          <h2 style={{ margin: 0 }}>{nombreDePeriodo(periodo)}</h2>

          {/* Los datos del mes, afuera. Son enlaces comunes y no botones porque lo que devuelven es
              un archivo: el navegador lo baja solo y se abre en Excel. Van acá arriba, pegados al
              mes, porque lo que se baja es SIEMPRE el mes que se está mirando. */}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a className="pastilla" style={{ padding: "6px 12px", fontSize: 12 }} href={`/panel/${slug}/exportar?que=movimientos&periodo=${periodo}`}>
              ↓ Movimientos (CSV)
            </a>
            <a className="pastilla" style={{ padding: "6px 12px", fontSize: 12 }} href={`/panel/${slug}/exportar?que=turnos&periodo=${periodo}`}>
              ↓ Turnos (CSV)
            </a>
          </div>
        </div>

        {/* ── Los tres números ────────────────────────────────────────────── */}
        <section style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          {[
            { t: "Emitido", v: plata(c.totales.emitidoCent), p: "lo que se les cobró este mes" },
            { t: "Cobrado", v: plata(c.totales.pagadoCent), p: "lo que efectivamente entró" },
            {
              t: "Falta cobrar",
              v: plata(c.totales.pendienteCent),
              p: c.totales.vencidas > 0 ? `${c.totales.vencidas} ya vencidas` : "ninguna vencida",
              alerta: c.totales.pendienteCent > 0n,
            },
          ].map((x) => (
            <div key={x.t} className="panel" style={{ padding: 18 }}>
              <p className="tenue" style={{ margin: 0, fontSize: 13 }}>{x.t}</p>
              <p style={{ fontSize: 26, margin: "6px 0 2px", fontWeight: 600, letterSpacing: "-0.02em", color: x.alerta ? "var(--error)" : undefined }}>
                {x.v}
              </p>
              <p className="tenue" style={{ margin: 0, fontSize: 12 }}>{x.p}</p>
            </div>
          ))}
        </section>

        {/* Reclamar algo que nunca se emitió es cómo se pierde un cliente: si falta cerrar, se
            dice acá arriba y se ofrece el camino. */}
        {c.sinCerrar > 0 && (
          <p className="aviso-error" style={{ marginTop: 16 }}>
            {c.sinCerrar === 1 ? "Un profesional tiene" : `${c.sinCerrar} profesionales tienen`} movimientos de{" "}
            {nombreDePeriodo(periodo)} sin liquidación emitida. Lo que figura como pendiente es lo que se
            les <b>va a</b> cobrar, no lo que se les cobró.{" "}
            <Link href={`/panel/${slug}/cierre?periodo=${periodo}`}>Ir a cerrar el mes</Link>
          </p>
        )}

        <h2 style={{ marginTop: 26 }}>Quién debe</h2>
        {c.filas.length === 0 ? (
          <p className="tenue">No hay movimientos en {nombreDePeriodo(periodo)}.</p>
        ) : conDeuda.length === 0 ? (
          <p className="aviso-ok">Está todo cobrado.</p>
        ) : null}

        {c.filas.length > 0 && (
          <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
            <table className="lista-personas">
              <thead>
                <tr>
                  <th>Profesional</th>
                  <th>Cuenta</th>
                  <th className="num">Emitido</th>
                  <th className="num">Pagó</th>
                  <th className="num">Falta</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {c.filas.map((f) => (
                  <tr key={f.inquilinoId} style={f.pendienteCent <= 0n ? { opacity: 0.6 } : undefined}>
                    <td>
                      <Link href={`/panel/${slug}/inquilinos/${f.inquilinoId}?periodo=${periodo}`}>{f.nombre}</Link>
                      {f.pagador && <span className="tenue" style={{ fontSize: 12 }}> · abona {f.pagador}</span>}
                    </td>
                    <td className="tenue" style={{ fontSize: 13 }} data-rotulo="Cuenta:">
                      {f.liquidacion ? (
                        <>
                          {/* El número es el enlace al papel: es lo que se abre para contestar
                              "¿de dónde sale este importe?" sin salir de la pantalla. */}
                          <Link href={`/panel/${slug}/liquidaciones/${f.liquidacion.id}`}>N° {f.liquidacion.numero}</Link>
                          {" · vence "}
                          {fecha(f.liquidacion.venceEl)}
                        </>
                      ) : (
                        "sin emitir"
                      )}
                    </td>
                    <td className="num" data-rotulo="Emitido:">{plata(f.emitidoCent)}</td>
                    <td className="num" data-rotulo="Pagó:">{plata(f.pagadoCent)}</td>
                    <td className="num" data-rotulo="Falta:" style={{ fontWeight: 600, color: f.vencida ? "var(--error)" : undefined }}>
                      {f.pendienteCent > 0n ? plata(f.pendienteCent) : "—"}
                    </td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>
                      {f.vencida && <span className="pildora" style={{ background: "#fdeceb", color: "var(--error)", fontSize: 12 }}>vencida</span>}{" "}
                      {f.pendienteCent > 0n && puede(actor.rol, "cobro.registrar") && (
                        <Link href={`/panel/${slug}/inquilinos/${f.inquilinoId}?periodo=${periodo}#cobros`} className="pastilla" style={{ padding: "5px 12px", fontSize: 12 }}>
                          Registrar pago
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="tenue" style={{ marginTop: 14, fontSize: 12, lineHeight: 1.5 }}>
          <b>Emitido</b> es el total de la liquidación del mes, congelado al cerrarla: si después
          apareció un cargo tardío, lo que se reclama es lo que dice el papel que recibió.{" "}
          <b>Falta</b> no se netea con quien pagó de más — sumar los saldos a favor escondería a
          quien debe detrás de quien no.
        </p>
        <p className="tenue" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5 }}>
          Los dos <b>CSV</b> de arriba bajan el mes entero: <b>Movimientos</b> son los cargos y los
          cobros —lo que va al contador—, y <b>Turnos</b> es la agenda con horarios e importes. Se
          abren en Excel y sirven para tener los datos afuera de la app.
        </p>
      </main>
    </>
  );
}
