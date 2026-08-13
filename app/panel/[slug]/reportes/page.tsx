// app/panel/[slug]/reportes/page.tsx — el panel de métricas del mes (§6.8).
//
// Todo número grande muestra su DENOMINADOR y su detalle: un "82% de ocupación" sin decir sobre
// qué, o un "facturado $3.200.000" que no se puede abrir por profesional, no sirve para decidir
// nada y menos para discutir con el contador. Cada profesional es un link a su detalle.

import { redirect } from "next/navigation";
import Link from "next/link";
import { actorDeSesion } from "../../../../src/lib/sesion.ts";
import { puede } from "../../../../src/lib/permisos.ts";
import { reporteMensual } from "../../../../src/servicios/reportes/mensual.ts";
import { formatearPesos } from "../../../../src/dominio/tarifa.ts";
import { esPeriodoValido, horasYMinutos, periodoAnterior } from "../../../../src/dominio/reporte.ts";
import { fechaEnZona } from "../../../../src/dominio/motor/zona.ts";
import { prisma } from "../../../../src/db/prisma.ts";
import { Logo } from "../../../Logo.tsx";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function nombreDePeriodo(p: string): string {
  const mes = MESES[Number(p.slice(5, 7)) - 1] ?? p;
  return `${mes} de ${p.slice(0, 4)}`;
}

export function periodoSiguiente(p: string): string {
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

  const tarjetas = [
    { titulo: "Facturado en el mes", valor: plata(r.totales.facturadoCent), pie: `${r.totales.reservas} turnos · ${r.totales.profesionalesConActividad} profesionales` },
    { titulo: "Cobrado en el mes", valor: plata(r.totales.cobradoCent), pie: "pagos con fecha de este mes" },
    { titulo: "Deuda al día de hoy", valor: plata(r.totales.deudaCent), pie: "suma de los que deben, de todos los meses" },
    { titulo: "Ocupación", valor: `${r.totales.ocupacionPct}%`, pie: `${horasYMinutos(r.totales.minutos)} vendidas de ${horasYMinutos(r.totales.aperturaMin)} abiertas` },
  ];

  return (
    <>
      <header className="barra">
        <Link href={`/panel/${slug}`} style={{ display: "flex", alignItems: "center" }} aria-label="Volver a la agenda">
          <Logo alto={26} variante="compacto" />
        </Link>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>Métricas de {nombreDePeriodo(periodo)}</h1>
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
        <Link href={`/panel/${slug}`} style={{ marginLeft: "auto", color: "var(--tenue)", fontWeight: 500, fontSize: 14 }}>
          ‹ Agenda
        </Link>
      </header>

      <main style={{ padding: 20, maxWidth: 1120, margin: "0 auto" }}>
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

        {/* ── Por profesional ───────────────────────────────────────────── */}
        <h2 style={{ marginTop: 26 }}>Por profesional</h2>
        <p className="tenue" style={{ marginTop: 2, fontSize: 13 }}>
          Tocá un nombre para ver qué días y a qué hora usó los consultorios.
        </p>
        {conActividad.length === 0 ? (
          <p className="tenue">Este mes no hubo movimiento.</p>
        ) : (
          <div className="panel" style={{ padding: 0, marginTop: 10, overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Profesional</th>
                  <th className="num">Turnos</th>
                  <th className="num">Horas</th>
                  <th className="num">Facturado</th>
                  <th className="num">Pagó</th>
                  <th className="num">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {conActividad.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/panel/${slug}/reportes/${p.id}?periodo=${periodo}`}>{p.nombre}</Link>{" "}
                      {!p.activo && <span className="tenue">(de baja)</span>}
                    </td>
                    <td className="num">{p.reservas}</td>
                    <td className="num">{horasYMinutos(p.minutos)}</td>
                    <td className="num">{plata(p.facturadoCent)}</td>
                    <td className="num">{plata(p.pagadoCent)}</td>
                    <td className="num" style={{ color: p.saldoCent > 0n ? "var(--error)" : undefined, fontWeight: 600 }}>
                      {plata(p.saldoCent)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="num">{r.totales.reservas}</td>
                  <td className="num">{horasYMinutos(r.totales.minutos)}</td>
                  <td className="num">{plata(r.totales.facturadoCent)}</td>
                  <td className="num">{plata(r.totales.cobradoCent)}</td>
                  <td className="num">{plata(r.totales.deudaCent)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {quietos > 0 && (
          <p className="tenue" style={{ fontSize: 12, marginTop: 8 }}>
            {quietos} profesional{quietos === 1 ? "" : "es"} sin movimiento este mes (no se listan, pero siguen en el centro).
          </p>
        )}

        {/* ── Por consultorio ───────────────────────────────────────────── */}
        <h2 style={{ marginTop: 26 }}>Por consultorio</h2>
        <div className="panel" style={{ padding: 0, marginTop: 10, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Consultorio</th>
                <th className="num">Turnos</th>
                <th className="num">Horas vendidas</th>
                <th className="num">Horas abiertas</th>
                <th className="num">Ocupación</th>
                <th className="num">Importe</th>
              </tr>
            </thead>
            <tbody>
              {r.salas.map((s) => (
                <tr key={s.id} style={{ opacity: s.activa ? 1 : 0.65 }}>
                  <td>
                    {s.nombre} {!s.activa && <span className="tenue">(archivado)</span>}
                  </td>
                  <td className="num">{s.reservas}</td>
                  <td className="num">{horasYMinutos(s.minutos)}</td>
                  <td className="num">{s.aperturaMin > 0 ? horasYMinutos(s.aperturaMin) : "—"}</td>
                  {/* Sin denominador se muestra un guion, no un porcentaje inventado. */}
                  <td className="num">{s.aperturaMin > 0 ? `${s.ocupacionPct}%` : "—"}</td>
                  <td className="num">{plata(s.importeCent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="tenue" style={{ fontSize: 12, marginTop: 22 }}>
          Un turno cuenta en el mes en que empieza, con la hora del centro ({r.tz}). Lo facturado
          sale del libro de cuenta corriente, no de multiplicar horas por precio: si hubo un ajuste
          o una nota de crédito, acá está.
        </p>
      </main>
    </>
  );
}
