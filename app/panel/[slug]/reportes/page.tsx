// app/panel/[slug]/reportes/page.tsx — el panel de métricas del mes (§6.8).
//
// Todo número grande muestra su DENOMINADOR y su detalle: un "82% de ocupación" sin decir sobre
// qué, o un "facturado $3.200.000" que no se puede abrir por profesional, no sirve para decidir
// nada y menos para discutir con el contador. Cada profesional es un link a su detalle.

import { redirect } from "next/navigation";
import Link from "next/link";
import { BarraNav } from "../BarraNav.tsx";
import { MenuConfig } from "../MenuConfig.tsx";
import { AnilloVolumen, BarrasVolumen } from "./Graficos.tsx";
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

  // Los conjuntos que alimentan los gráficos. Se filtra lo que no tiene nada que mostrar: una
  // barra en cero no informa, solo empuja la escala y achica a las demás.
  const conFacturacion = r.salas.filter((s) => s.importeCent > 0n);
  const conApertura = r.salas.filter((s) => s.aperturaMin > 0);
  const topHoras = [...conActividad].filter((p) => p.minutos > 0).sort((a, b) => b.minutos - a.minutos).slice(0, 6);

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
        <span style={{ marginLeft: "auto" }} />
        <BarraNav slug={slug} rol={actor.rol} actual="reportes" />
        <MenuConfig rol={actor.rol} />
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
                  { etiqueta: "Deuda", valor: Number(r.totales.deudaCent), texto: plata(r.totales.deudaCent) },
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
