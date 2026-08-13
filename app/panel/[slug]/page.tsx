// app/panel/[slug]/page.tsx — la pantalla del producto: vista día multi-sala (§6.4).
// El centro viaja en la URL, nunca en una cookie (§6.1). Sin membresía => 404, no 403: a un
// extraño no se le confirma la existencia del centro.

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { actorDeSesion } from "../../../src/lib/sesion.ts";
import { cargarDia } from "../../../src/servicios/agenda/dia.ts";
import { crearReservaAjena, mensajeDeError } from "../../../src/servicios/agenda/acciones.ts";
import { prisma } from "../../../src/db/prisma.ts";
import { puede } from "../../../src/lib/permisos.ts";
import { formatHora, sumarDiasLocal } from "../../../src/dominio/motor/zona.ts";
import { Grilla } from "./Grilla.tsx";
import { NuevaReserva } from "./NuevaReserva.tsx";

export default async function PanelPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ fecha?: string; error?: string; creada?: string }>;
}) {
  // En Next 16 params y searchParams son Promise (§11.0).
  const { slug } = await params;
  const { fecha: fechaParam, error: errorParam, creada } = await searchParams;

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);

  const hoyServidor = new Date();
  const dia = await cargarDia({
    actor,
    // `null` = HOY en la zona de la SEDE, resuelto adentro del servicio: la zona NUNCA se clava
    // acá (§14.4). Un `?fecha=` basura cae a null en vez de romper la pantalla (§9).
    fecha: fechaParam && /^\d{4}-\d{2}-\d{2}$/.test(fechaParam) ? fechaParam : null,
  });
  if (!dia) notFound();

  const ayer = sumarDiasLocal(dia.fecha, -1)!;
  const manana = sumarDiasLocal(dia.fecha, 1)!;
  const horas = (m: number) => `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60}'` : ""}`.trim();

  // Solo quien puede reservar a nombre de otro ve el formulario. Ocultarlo NO es el control: la
  // acción revalida el permiso igual (§6.2) — esto es solo para no mostrar lo que no se puede.
  const puedeCargar = puede(actor.rol, "reserva.crear.ajena");
  const inquilinos = puedeCargar
    ? await prisma.inquilino.findMany({
        where: { operadorId: actor.operadorId, estado: "activo" },
        select: { id: true, nombre: true },
        orderBy: { nombre: "asc" },
      })
    : [];

  // Server action delgada: resuelve la sesión y delega en la acción de dominio, que declara su
  // permiso. Nada de lógica de negocio acá.
  async function crear(formData: FormData) {
    "use server";
    const actorAccion = await actorDeSesion(slug);
    if (!actorAccion) redirect(`/login?centro=${encodeURIComponent(slug)}`);

    const fechaForm = String(formData.get("fecha") ?? "");
    const r = await crearReservaAjena(actorAccion, {
      salaId: formData.get("salaId"),
      fecha: fechaForm,
      hora: formData.get("hora"),
      duracionMin: formData.get("duracionMin"),
      inquilinoId: formData.get("inquilinoId"),
    });

    const qs = new URLSearchParams({ fecha: fechaForm });
    if (!r.ok) qs.set("error", r.error); // SIN_PERMISO / ENTRADA_INVALIDA (del envoltorio)
    else if (!r.data.ok) qs.set("error", r.data.error); // SLOT_OCUPADO, FUERA_DE_HORARIO, …
    else qs.set("creada", "1");

    revalidatePath(`/panel/${slug}`);
    redirect(`/panel/${slug}?${qs.toString()}`);
  }

  return (
    <main style={{ padding: 16 }}>
      <header style={{ display: "flex", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Agenda del día</h1>
        <nav style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href={`?fecha=${ayer}`}>‹</Link>
          <Link href=".">Hoy</Link>
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

      {puedeCargar && (
        <NuevaReserva
          salas={dia.salas.filter((s) => s.activa).map((s) => ({ id: s.id, nombre: s.nombre }))}
          inquilinos={inquilinos}
          fecha={dia.fecha}
          accion={crear}
          error={errorParam ? mensajeDeError(errorParam) : undefined}
          creada={creada === "1"}
        />
      )}
    </main>
  );
}
