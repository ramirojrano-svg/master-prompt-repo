// app/panel/[slug]/reportes/[inquilinoId]/page.tsx — el detalle de UN profesional en el mes.
//
// Responde las tres preguntas que aparecen cuando alguien discute su resumen: cuántas horas usó,
// qué días y a qué hora, y cuánto factura. Con las filas reales a la vista: un total sin el
// detalle que lo forma no se puede defender.

import { redirect } from "next/navigation";
import Link from "next/link";
import { BarraNav } from "../../BarraNav.tsx";
import { actorDeSesion } from "../../../../../src/lib/sesion.ts";
import { puede } from "../../../../../src/lib/permisos.ts";
import { detalleProfesional } from "../../../../../src/servicios/reportes/mensual.ts";
import { formatearPesos } from "../../../../../src/dominio/tarifa.ts";
import { esPeriodoValido, horasYMinutos, periodoAnterior, porcentaje } from "../../../../../src/dominio/reporte.ts";
import { fechaEnZona } from "../../../../../src/dominio/motor/zona.ts";
import { prisma } from "../../../../../src/db/prisma.ts";
import { Logo } from "../../../../Logo.tsx";
import { nombreDePeriodo, periodoSiguiente } from "../page.tsx";

const DIA_LARGO = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export default async function DetalleProfesionalPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; inquilinoId: string }>;
  searchParams: Promise<{ periodo?: string }>;
}) {
  const { slug, inquilinoId } = await params;
  const { periodo: periodoParam } = await searchParams;

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);
  if (!puede(actor.rol, "finanzas.ver.agregada")) redirect(`/panel/${slug}`);

  const sede = await prisma.sede.findFirst({
    where: { operadorId: actor.operadorId, activa: true },
    select: { zonaHoraria: true },
  });
  if (!sede) redirect(`/panel/${slug}`);
  const hoyPeriodo = fechaEnZona(new Date(), sede.zonaHoraria).slice(0, 7);
  const periodo = periodoParam && esPeriodoValido(periodoParam) ? periodoParam : hoyPeriodo;

  // Un id de otro centro no existe acá: se vuelve al reporte, sin confirmar que exista en otro lado.
  const d = await detalleProfesional({ actor, periodo, inquilinoId });
  if (!d) redirect(`/panel/${slug}/reportes?periodo=${periodo}`);

  const plata = (c: bigint) => formatearPesos(c, d.moneda);
  const maxDia = Math.max(1, ...d.porDiaSemana.map((x) => x.minutos));
  const conUso = d.porDiaSemana.filter((x) => x.minutos > 0);

  return (
    <>
      <header className="barra">
        <Link href={`/panel/${slug}`} style={{ display: "flex", alignItems: "center" }} aria-label="Volver a la agenda">
          <Logo alto={26} variante="compacto" />
        </Link>
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {d.inquilino.nombre}
          {!d.inquilino.activo && <span className="tenue" style={{ fontWeight: 400 }}> · de baja</span>}
        </h1>
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
        <span className="pildora">{nombreDePeriodo(periodo)}</span>
        <Link href={`/panel/${slug}/reportes?periodo=${periodo}`} style={{ marginLeft: "auto", color: "var(--tenue)", fontWeight: 500, fontSize: 14 }}>
          ‹ Todas las métricas
        </Link>
        <BarraNav slug={slug} rol={actor.rol} actual="reportes" />
      </header>

      <main style={{ padding: 20, maxWidth: 1000, margin: "0 auto" }}>
        {/* ── Los números del mes ────────────────────────────────────────── */}
        <section style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          {[
            { t: "Horas usadas", v: horasYMinutos(d.totales.minutos), p: `${d.totales.reservas} turnos en ${d.totales.diasDistintos} días` },
            { t: "Facturado", v: plata(d.totales.facturadoCent), p: "cargado a su cuenta este mes" },
            { t: "Pagó", v: plata(d.totales.pagadoCent), p: "pagos registrados este mes" },
            {
              t: "Saldo",
              v: plata(d.totales.saldoCent),
              p: d.totales.saldoCent > 0n ? "debe, acumulado de todos los meses" : "sin deuda",
            },
          ].map((c) => (
            <div key={c.t} className="panel" style={{ padding: 18 }}>
              <p className="tenue" style={{ margin: 0, fontSize: 13 }}>{c.t}</p>
              <p style={{ fontSize: 25, margin: "6px 0 2px", fontWeight: 600, letterSpacing: "-0.02em" }}>{c.v}</p>
              <p className="tenue" style={{ margin: 0, fontSize: 12 }}>{c.p}</p>
            </div>
          ))}
        </section>

        {d.totales.reservas === 0 ? (
          <p className="tenue" style={{ marginTop: 24 }}>
            No usó ningún consultorio en {nombreDePeriodo(periodo)}. El saldo de arriba sigue siendo
            el acumulado: una deuda vieja no desaparece porque este mes no haya venido.
          </p>
        ) : (
          <>
            {/* ── Qué días viene ─────────────────────────────────────────── */}
            <h2 style={{ marginTop: 26 }}>Qué días usa el consultorio</h2>
            <div className="panel" style={{ marginTop: 10 }}>
              {conUso.map((x) => (
                <div key={x.dia} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <span style={{ width: 84, fontSize: 13 }}>{DIA_LARGO[x.dia]}</span>
                  <span style={{ flex: 1, background: "var(--agua-clara)", borderRadius: 999, height: 12, overflow: "hidden" }}>
                    <span
                      style={{
                        display: "block",
                        height: "100%",
                        width: `${porcentaje(x.minutos, maxDia)}%`,
                        background: "linear-gradient(90deg, var(--turquesa), var(--marca-500))",
                      }}
                    />
                  </span>
                  <span className="tenue num" style={{ fontSize: 12, width: 130 }}>
                    {horasYMinutos(x.minutos)} · {x.reservas} turno{x.reservas === 1 ? "" : "s"}
                  </span>
                </div>
              ))}
              <p className="tenue" style={{ margin: "12px 0 0", fontSize: 12 }}>
                Franjas:{" "}
                {d.porFranja
                  .filter((f) => f.reservas > 0)
                  .map((f) => `${f.franja} ${horasYMinutos(f.minutos)}`)
                  .join(" · ")}
              </p>
            </div>

            {/* ── Turno por turno ────────────────────────────────────────── */}
            <h2 style={{ marginTop: 26 }}>Turno por turno</h2>
            <div className="panel" style={{ padding: 0, marginTop: 10, overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Día</th>
                    <th>Horario</th>
                    <th>Consultorio</th>
                    <th className="num">Duración</th>
                    <th className="num">Importe</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {d.turnos.map((t) => (
                    <tr key={t.id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {DIA_LARGO[t.diaSemana]} {Number(t.fecha.slice(8, 10))}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{t.horaTexto}</td>
                      <td>{t.salaNombre}</td>
                      <td className="num">{horasYMinutos(t.minutos)}</td>
                      {/* null ≠ $0: "se creó sin precio cargado" no es "salió gratis". */}
                      <td className="num">{t.importeCent === null ? <span className="tenue">sin precio</span> : plata(t.importeCent)}</td>
                      <td>
                        {t.estado === "no_show" ? (
                          <span className="pildora" style={{ background: "#fdeceb", color: "var(--error)" }}>no vino</span>
                        ) : (
                          <span className="tenue">{t.estado}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>
                      {d.totales.reservas} turnos en {d.totales.diasDistintos} días
                    </td>
                    <td className="num">{horasYMinutos(d.totales.minutos)}</td>
                    <td className="num">{plata(d.totales.importeCent)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* El detalle son los turnos; lo facturado es el libro. Si difieren, hay que decirlo. */}
            {d.totales.importeCent !== d.totales.facturadoCent && (
              <p className="tenue" style={{ marginTop: 10, fontSize: 12 }}>
                Los turnos suman {plata(d.totales.importeCent)} y su cuenta registra{" "}
                {plata(d.totales.facturadoCent)} facturados este mes. La diferencia son movimientos
                que no son horas de consultorio (ajustes, penalidades o notas de crédito).
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
}
