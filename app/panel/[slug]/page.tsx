// app/panel/[slug]/page.tsx — la pantalla del producto: vista día multi-sala (§6.4).
// El centro viaja en la URL, nunca en una cookie (§6.1). Sin membresía => 404, no 403: a un
// extraño no se le confirma la existencia del centro.

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { actorDeSesion } from "../../../src/lib/sesion.ts";
import { cargarDia } from "../../../src/servicios/agenda/dia.ts";
import { fechaEnZona, formatHora, sumarDiasLocal } from "../../../src/dominio/motor/zona.ts";
import { Grilla } from "./Grilla.tsx";

export default async function PanelPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ fecha?: string }>;
}) {
  // En Next 16 params y searchParams son Promise (§11.0).
  const { slug } = await params;
  const { fecha: fechaParam } = await searchParams;

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);

  const hoyServidor = new Date();
  const dia = await cargarDia({
    actor,
    // clamp de la fecha: un ?fecha= basura no puede romper la pantalla (§9)
    fecha: fechaParam && /^\d{4}-\d{2}-\d{2}$/.test(fechaParam) ? fechaParam : fechaEnZona(hoyServidor, "America/Argentina/Buenos_Aires"),
  });
  if (!dia) notFound();

  const ayer = sumarDiasLocal(dia.fecha, -1)!;
  const manana = sumarDiasLocal(dia.fecha, 1)!;
  const hoy = fechaEnZona(hoyServidor, dia.tz);
  const horas = (m: number) => `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60}'` : ""}`.trim();

  return (
    <main style={{ padding: 16 }}>
      <header style={{ display: "flex", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Agenda del día</h1>
        <nav style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href={`?fecha=${ayer}`}>‹</Link>
          <Link href={`?fecha=${hoy}`}>Hoy</Link>
          <Link href={`?fecha=${manana}`}>›</Link>
          <strong>{dia.fecha}</strong>
        </nav>
        {/* El reloj de la zona del centro: el único lugar donde un error de zona se ve (§4.3.3). */}
        <span className="tenue" style={{ fontSize: 12 }}>
          ahora: {formatHora(hoyServidor, dia.tz)} ({dia.tz})
        </span>
      </header>

      {/* KPIs con el DENOMINADOR visible: un porcentaje sin denominador no se puede auditar. */}
      <p className="tenue" style={{ marginTop: 8 }}>
        Ocupación <strong>{dia.kpis.ocupacionPct}%</strong> ({horas(dia.kpis.ocupadasMin)} de {horas(dia.kpis.disponiblesMin)}) ·{" "}
        {dia.salas.length} sala{dia.salas.length === 1 ? "" : "s"}
      </p>

      <Grilla dia={dia} />
    </main>
  );
}
