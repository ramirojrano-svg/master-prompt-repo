// app/panel/[slug]/reportes/page.tsx — el panel de datos del mes (§6.8).
//
// Todo número grande muestra su DENOMINADOR y su detalle: un "82% de ocupación" sin decir sobre
// qué, o un "facturado $3.200.000" que no se puede abrir por profesional, no sirve para decidir
// nada y menos para discutir con el contador.

import { redirect } from "next/navigation";
import Link from "next/link";
import { actorDeSesion } from "../../../../src/lib/sesion.ts";
import { puede } from "../../../../src/lib/permisos.ts";
import { reporteMensual } from "../../../../src/servicios/reportes/mensual.ts";
import { formatearPesos } from "../../../../src/dominio/tarifa.ts";
import { esPeriodoValido, horasYMinutos, periodoAnterior } from "../../../../src/dominio/reporte.ts";
import { fechaEnZona } from "../../../../src/dominio/motor/zona.ts";
import { prisma } from "../../../../src/db/prisma.ts";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function nombreDePeriodo(p: string): string {
  const mes = MESES[Number(p.slice(5, 7)) - 1] ?? p;
  return `${mes} de ${p.slice(0, 4)}`;
}

function siguiente(p: string): string {
  const anio = Number(p.slice(0, 4));
  const mes = Number(p.slice(5, 7));
  return mes === 12 ? `${anio + 1}-01` : `${anio}-${String(mes + 1).padStart(2, "0")}`;
}

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

  const plata = (c: bigint) => formatearPesos(c, r.moneda);
  const conActividad = r.profesionales.filter((p) => p.reservas > 0 || p.facturadoCent !== 0n || p.pagadoCent !== 0n || p.saldoCent !== 0n);
  const quietos = r.profesionales.length - conActividad.length;

  return (
    <main style={{ padding: 16, maxWidth: 1000 }}>
      <p><Link href={`/panel/${slug}`}>‹ Agenda</Link></p>

      <header style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Datos de {nombreDePeriodo(periodo)}</h1>
        <nav style={{ display: "flex", gap: 8 }}>
          <Link href={`?periodo=${periodoAnterior(periodo)}`}>‹ mes anterior</Link>
          {periodo < hoyPeriodo && <Link href={`?periodo=${siguiente(periodo)}`}>mes siguiente ›</Link>}
        </nav>
      </header>

      {/* ── Los cuatro números ──────────────────────────────────────────── */}
      <section style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", marginTop: 16 }}>
        <div className="panel">
          <p className="tenue" style={{ margin: 0 }}>Facturado en el mes</p>
          <p style={{ fontSize: 24, margin: "4px 0 0" }}><strong>{plata(r.totales.facturadoCent)}</strong></p>
          <p className="tenue" style={{ margin: 0, fontSize: 12 }}>
            {r.totales.reservas} reserva{r.totales.reservas === 1 ? "" : "s"} · {r.totales.profesionalesConActividad} profesional{r.totales.profesionalesConActividad === 1 ? "" : "es"}
          </p>
        </div>
        <div className="panel">
          <p className="tenue" style={{ margin: 0 }}>Cobrado en el mes</p>
          <p style={{ fontSize: 24, margin: "4px 0 0" }}><strong>{plata(r.totales.cobradoCent)}</strong></p>
          <p className="tenue" style={{ margin: 0, fontSize: 12 }}>pagos registrados con fecha de este mes</p>
        </div>
        <div className="panel">
          <p className="tenue" style={{ margin: 0 }}>Deuda al día de hoy</p>
          <p style={{ fontSize: 24, margin: "4px 0 0" }}><strong>{plata(r.totales.deudaCent)}</strong></p>
          {/* Netear con los que tienen saldo a favor esconde la deuda real (§5.6). */}
          <p className="tenue" style={{ margin: 0, fontSize: 12 }}>suma de los que deben, acumulada de todos los meses</p>
        </div>
        <div className="panel">
          <p className="tenue" style={{ margin: 0 }}>Ocupación</p>
          <p style={{ fontSize: 24, margin: "4px 0 0" }}><strong>{r.totales.ocupacionPct}%</strong></p>
          <p className="tenue" style={{ margin: 0, fontSize: 12 }}>
            {horasYMinutos(r.totales.minutos)} vendidas de {horasYMinutos(r.totales.aperturaMin)} abiertas
          </p>
        </div>
      </section>

      {r.sinDetallarCent !== 0n && (
        <p className="error" style={{ marginTop: 12 }}>
          Atención: {plata(r.sinDetallarCent)} facturados no se pudieron atribuir a ningún profesional del detalle.
        </p>
      )}

      {/* ── Por profesional ─────────────────────────────────────────────── */}
      <h2 style={{ fontSize: 16, marginTop: 24 }}>Por profesional</h2>
      {conActividad.length === 0 ? (
        <p className="tenue">Este mes no hubo movimiento.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--borde)" }}>
                <th style={{ padding: "6px 4px" }}>Profesional</th>
                <th style={{ padding: "6px 4px", textAlign: "right" }}>Reservas</th>
                <th style={{ padding: "6px 4px", textAlign: "right" }}>Horas</th>
                <th style={{ padding: "6px 4px", textAlign: "right" }}>Facturado</th>
                <th style={{ padding: "6px 4px", textAlign: "right" }}>Pagó</th>
                <th style={{ padding: "6px 4px", textAlign: "right" }}>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {conActividad.map((p) => (
                <tr key={p.id} style={{ borderBottom: "1px solid var(--borde)" }}>
                  <td style={{ padding: "8px 4px" }}>
                    {p.nombre} {!p.activo && <span className="tenue">(de baja)</span>}
                  </td>
                  <td style={{ padding: "8px 4px", textAlign: "right" }}>{p.reservas}</td>
                  <td style={{ padding: "8px 4px", textAlign: "right" }}>{horasYMinutos(p.minutos)}</td>
                  <td style={{ padding: "8px 4px", textAlign: "right" }}>{plata(p.facturadoCent)}</td>
                  <td style={{ padding: "8px 4px", textAlign: "right" }}>{plata(p.pagadoCent)}</td>
                  <td style={{ padding: "8px 4px", textAlign: "right", color: p.saldoCent > 0n ? "#b23b3b" : undefined }}>
                    <strong>{plata(p.saldoCent)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ padding: "8px 4px" }}><strong>Total</strong></td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}><strong>{r.totales.reservas}</strong></td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}><strong>{horasYMinutos(r.totales.minutos)}</strong></td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}><strong>{plata(r.totales.facturadoCent)}</strong></td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}><strong>{plata(r.totales.cobradoCent)}</strong></td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}><strong>{plata(r.totales.deudaCent)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {quietos > 0 && (
        <p className="tenue" style={{ fontSize: 12 }}>
          {quietos} profesional{quietos === 1 ? "" : "es"} sin movimiento este mes (no se listan, pero siguen en el centro).
        </p>
      )}

      {/* ── Por sala ────────────────────────────────────────────────────── */}
      <h2 style={{ fontSize: 16, marginTop: 24 }}>Por sala</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--borde)" }}>
              <th style={{ padding: "6px 4px" }}>Sala</th>
              <th style={{ padding: "6px 4px", textAlign: "right" }}>Reservas</th>
              <th style={{ padding: "6px 4px", textAlign: "right" }}>Horas vendidas</th>
              <th style={{ padding: "6px 4px", textAlign: "right" }}>Horas abiertas</th>
              <th style={{ padding: "6px 4px", textAlign: "right" }}>Ocupación</th>
              <th style={{ padding: "6px 4px", textAlign: "right" }}>Importe</th>
            </tr>
          </thead>
          <tbody>
            {r.salas.map((s) => (
              <tr key={s.id} style={{ borderBottom: "1px solid var(--borde)", opacity: s.activa ? 1 : 0.6 }}>
                <td style={{ padding: "8px 4px" }}>
                  {s.nombre} {!s.activa && <span className="tenue">(archivada)</span>}
                </td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}>{s.reservas}</td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}>{horasYMinutos(s.minutos)}</td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}>{s.aperturaMin > 0 ? horasYMinutos(s.aperturaMin) : "—"}</td>
                {/* Sin denominador se muestra un guion, no un porcentaje inventado. */}
                <td style={{ padding: "8px 4px", textAlign: "right" }}>{s.aperturaMin > 0 ? `${s.ocupacionPct}%` : "—"}</td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}>{plata(s.importeCent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="tenue" style={{ fontSize: 12, marginTop: 20 }}>
        Una reserva cuenta en el mes en que empieza, con la hora del centro ({r.tz}). Lo facturado
        sale del libro de cuenta corriente, no de multiplicar horas por precio: si hubo un ajuste o
        una nota de crédito, acá está. El mantenimiento no cuenta como hora vendida.
      </p>
    </main>
  );
}
