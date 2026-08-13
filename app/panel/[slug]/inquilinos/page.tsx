// app/panel/[slug]/inquilinos/page.tsx — ABM de inquilinos (§6.12 paso 6).
// Dar de baja ARCHIVA: las reservas y la plata históricas siguen existiendo (§6.7).
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { actorDeSesion } from "../../../../src/lib/sesion.ts";
import { prisma } from "../../../../src/db/prisma.ts";
import { puede } from "../../../../src/lib/permisos.ts";
import { cambiarEstadoInquilino, crearInquilino, editarInquilino } from "../../../../src/servicios/config/inquilinos.ts";

const ETIQUETA: Record<string, string> = { activo: "Activo", suspendido: "Suspendido", baja: "De baja" };

export default async function InquilinosPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; ok?: string; editar?: string; ver?: string }>;
}) {
  const { slug } = await params;
  const { error, ok, editar, ver } = await searchParams;

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);
  if (!puede(actor.rol, "inquilino.administrar")) redirect(`/panel/${slug}`);

  // Por default se listan los activos; los de baja se ven con ?ver=todos. Un filtro nunca puede
  // hacer desaparecer una fila sin que haya forma de alcanzarla (§6.4).
  const verTodos = ver === "todos";
  const inquilinos = await prisma.inquilino.findMany({
    where: { operadorId: actor.operadorId, ...(verTodos ? {} : { estado: { not: "baja" } }) },
    orderBy: [{ estado: "asc" }, { nombre: "asc" }],
    select: { id: true, nombre: true, estado: true },
  });
  const deBaja = await prisma.inquilino.count({ where: { operadorId: actor.operadorId, estado: "baja" } });

  const enEdicion = editar ? inquilinos.find((i) => i.id === editar) : undefined;

  async function guardar(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);
    const inquilinoId = String(formData.get("inquilinoId") ?? "");
    const nombre = formData.get("nombre");
    const r = inquilinoId ? await editarInquilino(a, { nombre, inquilinoId }) : await crearInquilino(a, { nombre });
    revalidatePath(`/panel/${slug}/inquilinos`);
    const qs = !r.ok ? `?error=${r.error}` : !r.data.ok ? `?error=${r.data.error}` : "?ok=1";
    redirect(`/panel/${slug}/inquilinos${qs}`);
  }

  async function cambiarEstado(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);
    await cambiarEstadoInquilino(a, { inquilinoId: formData.get("inquilinoId"), estado: formData.get("estado") });
    revalidatePath(`/panel/${slug}/inquilinos`);
    redirect(`/panel/${slug}/inquilinos?ok=1`);
  }

  const mensaje =
    error === "SIN_PERMISO" ? "Tu rol no puede administrar profesionales."
    : error === "ENTRADA_INVALIDA" ? "Falta el nombre."
    : error ? "No se pudo guardar." : null;

  return (
    <main style={{ padding: 16, maxWidth: 900 }}>
      <p><Link href={`/panel/${slug}`}>‹ Agenda</Link></p>
      <h1 style={{ fontSize: 20 }}>Profesionales</h1>
      <p className="tenue">
        {inquilinos.length} listados
        {deBaja > 0 && (verTodos ? <> · <Link href="?">ocultar los de baja</Link></> : <> · {deBaja} de baja (<Link href="?ver=todos">ver</Link>)</>)}
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
        <tbody>
          {inquilinos.map((i) => (
            <tr key={i.id} style={{ borderBottom: "1px solid var(--borde)", opacity: i.estado === "baja" ? 0.6 : 1 }}>
              <td style={{ padding: "8px 4px" }}>{i.nombre}</td>
              <td style={{ padding: "8px 4px" }} className="tenue">{ETIQUETA[i.estado]}</td>
              <td style={{ padding: "8px 4px", textAlign: "right", whiteSpace: "nowrap" }}>
                <Link href={`?editar=${i.id}${verTodos ? "&ver=todos" : ""}`}>Editar</Link>{" "}
                <form action={cambiarEstado} style={{ display: "inline" }}>
                  <input type="hidden" name="inquilinoId" value={i.id} />
                  <input type="hidden" name="estado" value={i.estado === "activo" ? "baja" : "activo"} />
                  <button type="submit" style={{ background: "none", border: "none", color: "var(--acento)", cursor: "pointer", padding: 0, font: "inherit" }}>
                    {i.estado === "activo" ? "Dar de baja" : "Reactivar"}
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form className="panel" action={guardar} style={{ marginTop: 20 }}>
        <h2 style={{ marginTop: 0 }}>{enEdicion ? "Editar profesional" : "Nuevo profesional"}</h2>
        {enEdicion && <input type="hidden" name="inquilinoId" value={enEdicion.id} />}
        <label htmlFor="nombre">Nombre y especialidad</label>
        <input id="nombre" name="nombre" required maxLength={120} defaultValue={enEdicion?.nombre ?? ""} placeholder="María Gómez (Psicología)" />

        {mensaje && <p className="error" style={{ marginTop: 12 }}>{mensaje}</p>}
        {ok && <p style={{ marginTop: 12, color: "#157f4a" }}>Guardado.</p>}

        <p style={{ marginTop: 14 }}>
          <button type="submit">{enEdicion ? "Guardar" : "Agregar"}</button>{" "}
          {enEdicion && <Link href="?">Cancelar</Link>}
        </p>
      </form>
    </main>
  );
}
