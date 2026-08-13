// app/panel/[slug]/salas/page.tsx — ABM de salas (§6.12 paso 3: sin sala no hay agenda).
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { actorDeSesion } from "../../../../src/lib/sesion.ts";
import { prisma } from "../../../../src/db/prisma.ts";
import { puede } from "../../../../src/lib/permisos.ts";
import { archivarSala, crearSala, diasDeHorario, editarSala } from "../../../../src/servicios/config/salas.ts";
import { parseHorarios, resumenHorarios } from "../../../../src/dominio/motor/horarios.ts";

const NOMBRE_DIA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export default async function SalasPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string; ok?: string; editar?: string }>;
}) {
  const { slug } = await params;
  const { error, ok, editar } = await searchParams;

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);
  // Ocultar el formulario no es el control: cada acción revalida el permiso igual (§6.2).
  if (!puede(actor.rol, "sala.administrar")) redirect(`/panel/${slug}`);

  const salas = await prisma.sala.findMany({
    where: { operadorId: actor.operadorId },
    orderBy: [{ activa: "desc" }, { orden: "asc" }],
    select: { id: true, nombre: true, color: true, activa: true, bufferMin: true, horarioJson: true },
  });

  const enEdicion = editar ? salas.find((s) => s.id === editar) : undefined;
  const horarioEd = enEdicion ? parseHorarios(enEdicion.horarioJson) : null;
  const diasEd = horarioEd ? diasDeHorario(horarioEd) : [1, 2, 3, 4, 5];
  const franjaEd = horarioEd ? Object.values(horarioEd).flat()[0] : undefined;

  async function guardar(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);

    const salaId = String(formData.get("salaId") ?? "");
    const input = {
      nombre: formData.get("nombre"),
      color: formData.get("color"),
      dias: formData.getAll("dias"),
      desde: formData.get("desde"),
      hasta: formData.get("hasta"),
      bufferMin: formData.get("bufferMin"),
    };
    const r = salaId ? await editarSala(a, { ...input, salaId }) : await crearSala(a, input);

    revalidatePath(`/panel/${slug}/salas`);
    revalidatePath(`/panel/${slug}`);
    const qs = !r.ok ? `?error=${r.error}` : !r.data.ok ? `?error=${r.data.error}` : "?ok=1";
    redirect(`/panel/${slug}/salas${qs}`);
  }

  async function cambiarArchivo(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);
    await archivarSala(a, { salaId: formData.get("salaId"), activa: formData.get("activa") === "1" });
    revalidatePath(`/panel/${slug}/salas`);
    revalidatePath(`/panel/${slug}`);
    redirect(`/panel/${slug}/salas?ok=1`);
  }

  const mensaje =
    error === "HORARIO_INVALIDO"
      ? "El horario no es válido: la hora de apertura tiene que ser anterior a la de cierre."
      : error === "SIN_PERMISO"
        ? "Tu rol no puede administrar salas."
        : error === "ENTRADA_INVALIDA"
          ? "Revisá los datos: falta el nombre o algún día."
          : error
            ? "No se pudo guardar la sala."
            : null;

  return (
    <main style={{ padding: 16, maxWidth: 900 }}>
      <p><Link href={`/panel/${slug}`}>‹ Agenda</Link></p>
      <h1 style={{ fontSize: 20 }}>Salas</h1>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid var(--borde)" }}>
            <th style={{ padding: "6px 4px" }}>Sala</th>
            <th style={{ padding: "6px 4px" }}>Horario</th>
            <th style={{ padding: "6px 4px" }}>Limpieza</th>
            <th style={{ padding: "6px 4px" }} />
          </tr>
        </thead>
        <tbody>
          {salas.map((s) => (
            <tr key={s.id} style={{ borderBottom: "1px solid var(--borde)", opacity: s.activa ? 1 : 0.6 }}>
              <td style={{ padding: "8px 4px" }}>
                <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: s.color, marginRight: 8 }} />
                {s.nombre} {!s.activa && <span className="tenue">(archivada)</span>}
              </td>
              <td style={{ padding: "8px 4px" }} className="tenue">{resumenHorarios(parseHorarios(s.horarioJson)) || "sin horario"}</td>
              <td style={{ padding: "8px 4px" }} className="tenue">{s.bufferMin}′</td>
              <td style={{ padding: "8px 4px", textAlign: "right", whiteSpace: "nowrap" }}>
                <Link href={`?editar=${s.id}`}>Editar</Link>{" "}
                <form action={cambiarArchivo} style={{ display: "inline" }}>
                  <input type="hidden" name="salaId" value={s.id} />
                  <input type="hidden" name="activa" value={s.activa ? "0" : "1"} />
                  {/* Archivar, NUNCA borrar: hay reservas y plata colgando (§3.6). */}
                  <button type="submit" style={{ background: "none", border: "none", color: "var(--acento)", cursor: "pointer", padding: 0, font: "inherit" }}>
                    {s.activa ? "Archivar" : "Reactivar"}
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form className="panel" action={guardar} style={{ marginTop: 20 }}>
        <h2 style={{ marginTop: 0 }}>{enEdicion ? `Editar ${enEdicion.nombre}` : "Nueva sala"}</h2>
        {enEdicion && <input type="hidden" name="salaId" value={enEdicion.id} />}

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <div>
            <label htmlFor="nombre">Nombre</label>
            <input id="nombre" name="nombre" required maxLength={60} defaultValue={enEdicion?.nombre ?? ""} placeholder="Consultorio 1" />
          </div>
          <div>
            <label htmlFor="color">Color</label>
            <input id="color" name="color" type="color" defaultValue={enEdicion?.color ?? "#2f6fe0"} />
          </div>
          <div>
            <label htmlFor="desde">Abre</label>
            <input id="desde" name="desde" type="time" step={1800} required defaultValue={franjaEd?.desde ?? "08:00"} />
          </div>
          <div>
            <label htmlFor="hasta">Cierra</label>
            <input id="hasta" name="hasta" type="time" step={1800} required defaultValue={franjaEd?.hasta ?? "22:00"} />
          </div>
          <div>
            <label htmlFor="bufferMin">Limpieza entre turnos</label>
            <select id="bufferMin" name="bufferMin" defaultValue={String(enEdicion?.bufferMin ?? 15)}>
              <option value="0">Sin buffer</option>
              <option value="10">10 minutos</option>
              <option value="15">15 minutos</option>
              <option value="30">30 minutos</option>
            </select>
          </div>
        </div>

        <fieldset style={{ marginTop: 14, border: "1px solid var(--borde)", borderRadius: 8, padding: 12 }}>
          <legend className="tenue">Días que abre</legend>
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <label key={d} style={{ display: "inline-flex", alignItems: "center", gap: 4, marginRight: 14, fontWeight: 400 }}>
              <input type="checkbox" name="dias" value={d} defaultChecked={diasEd.includes(d as 0 | 1 | 2 | 3 | 4 | 5 | 6)} />
              {NOMBRE_DIA[d]}
            </label>
          ))}
        </fieldset>

        {mensaje && <p className="error" style={{ marginTop: 12 }}>{mensaje}</p>}
        {ok && <p style={{ marginTop: 12, color: "#157f4a" }}>Guardado.</p>}

        <p style={{ marginTop: 14 }}>
          <button type="submit">{enEdicion ? "Guardar cambios" : "Crear sala"}</button>{" "}
          {enEdicion && <Link href="?">Cancelar</Link>}
        </p>
      </form>
    </main>
  );
}
