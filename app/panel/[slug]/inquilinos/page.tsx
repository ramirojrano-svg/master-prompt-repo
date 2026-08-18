// app/panel/[slug]/inquilinos/page.tsx — ABM de inquilinos (§6.12 paso 6).
// Dar de baja ARCHIVA: las reservas y la plata históricas siguen existiendo (§6.7).
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { Buscador } from "./Buscador.tsx";
import { Cabecera } from "../Cabecera.tsx";
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
  searchParams: Promise<{ error?: string; ok?: string; editar?: string; ver?: string; q?: string }>;
}) {
  const { slug } = await params;
  const { error, ok, editar, ver, q } = await searchParams;
  // El texto buscado, normalizado una vez: se usa para filtrar y para repintar el campo.
  const busca = (q ?? "").trim();

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);
  if (!puede(actor.rol, "inquilino.administrar")) redirect(`/panel/${slug}`);

  // Por default se listan los activos; los de baja se ven con ?ver=todos. Un filtro nunca puede
  // hacer desaparecer una fila sin que haya forma de alcanzarla (§6.4).
  const verTodos = ver === "todos";
  const inquilinos = await prisma.inquilino.findMany({
    where: {
      operadorId: actor.operadorId,
      ...(verTodos ? {} : { estado: { not: "baja" } }),
      // El filtro va en la CONSULTA, no en memoria: con 29 se notaría poco, pero traer todo para
      // descartar en el servidor es la forma de que una lista que crece deje de andar sin aviso.
      // `insensitive` porque nadie busca respetando mayúsculas, y también por pagador: "quién le
      // paga a quién" es justo lo que se busca al facturar.
      ...(busca
        ? { OR: [{ nombre: { contains: busca, mode: "insensitive" as const } }, { pagador: { contains: busca, mode: "insensitive" as const } }] }
        : {}),
    },
    orderBy: [{ estado: "asc" }, { nombre: "asc" }],
    select: { id: true, nombre: true, estado: true, pagador: true },
  });
  const deBaja = await prisma.inquilino.count({ where: { operadorId: actor.operadorId, estado: "baja" } });

  const enEdicion = editar ? inquilinos.find((i) => i.id === editar) : undefined;

  async function guardar(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);
    const inquilinoId = String(formData.get("inquilinoId") ?? "");
    const nombre = formData.get("nombre");
    const pagador = formData.get("pagador");
    const r = inquilinoId ? await editarInquilino(a, { nombre, pagador, inquilinoId }) : await crearInquilino(a, { nombre, pagador });
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
    <>
      <Cabecera slug={slug} rol={actor.rol} titulo="Profesionales" />
      <main style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
      <Buscador inicial={busca} verTodos={verTodos} />

      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <p className="tenue" style={{ margin: 0 }}>
          {busca
            ? `${inquilinos.length} ${inquilinos.length === 1 ? "resultado" : "resultados"} para "${busca}"`
            : `${inquilinos.length} listados`}
          {deBaja > 0 && (verTodos ? <> · <Link href="?">ocultar los de baja</Link></> : <> · {deBaja} de baja (<Link href="?ver=todos">ver</Link>)</>)}
        </p>
        {/* El formulario de alta vive al pie, y con treinta profesionales queda tan abajo que no
            se encuentra: la pantalla parecía no tener forma de agregar a nadie. Este botón lo trae
            a la vista de arriba, que es donde se lo busca — y sin `q` ni `editar`, así "Agregar"
            abre el formulario en blanco y no encima de una edición a medias. */}
        <Link href={`?${verTodos ? "ver=todos" : ""}#editor`} className="pastilla" style={{ marginLeft: "auto" }}>
          + Agregar profesional
        </Link>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
        <tbody>
          {inquilinos.map((i) => (
            <tr key={i.id} style={{ borderBottom: "1px solid var(--borde)", opacity: i.estado === "baja" ? 0.6 : 1 }}>
              <td style={{ padding: "8px 4px" }}>
                {/* El nombre ES el acceso a la ficha: es lo que uno toca cuando quiere ver a
                    alguien, y tenerlo como texto muerto obligaba a buscar el camino en otra
                    pantalla. */}
                <Link href={`/panel/${slug}/inquilinos/${i.id}`} style={{ fontWeight: 500 }}>
                  {i.nombre}
                </Link>
                {/* Quién abona se ve en la lista: es lo que hace falta saber al momento de
                    facturar, y buscarlo abriendo cada ficha no sirve para eso. */}
                {i.pagador && <span className="tenue" style={{ fontSize: 12 }}> · abona {i.pagador}</span>}
              </td>
              <td style={{ padding: "8px 4px" }} className="tenue">{ETIQUETA[i.estado]}</td>
              <td style={{ padding: "8px 4px", textAlign: "right", whiteSpace: "nowrap" }}>
                {/* "Editar" se fue de acá: los datos del profesional se cambian DENTRO de su ficha,
                    que es donde se está mirando a esa persona. En la lista quedan las dos acciones
                    que se hacen sin abrir a nadie: cobrarle y darlo de baja. */}
                <Link href={`/panel/${slug}/inquilinos/${i.id}#cobros`} className="pastilla" style={{ padding: "5px 12px", fontSize: 12 }}>
                  Gestionar pagos
                </Link>{" "}
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

      <form id="editor" className="panel" action={guardar} style={{ marginTop: 20, scrollMarginTop: 76 }}>
        {/* scrollMarginTop deja el panel por DEBAJO de la barra superior, que es fija: sin eso el
            salto lo pone justo atrás del encabezado y el título queda tapado. */}
        <h2 style={{ marginTop: 0 }}>{enEdicion ? `Editar: ${enEdicion.nombre}` : "Nuevo profesional"}</h2>
        {enEdicion && <input type="hidden" name="inquilinoId" value={enEdicion.id} />}
        <label htmlFor="nombre">Nombre y especialidad</label>
        <input id="nombre" name="nombre" required maxLength={120} defaultValue={enEdicion?.nombre ?? ""} placeholder="Marta Terrón (Alergista)" />

        <label htmlFor="pagador">Quién abona (si no es el mismo profesional)</label>
        <input id="pagador" name="pagador" maxLength={120} defaultValue={enEdicion?.pagador ?? ""} placeholder="Federico Terrón" />
        <p className="tenue" style={{ margin: "4px 0 0", fontSize: 12 }}>
          Solo para facturar y cobrar. La deuda sigue siendo de quien usó el consultorio: pasarla a
          otra cuenta descuadraría las dos.
        </p>

        {mensaje && <p className="error" style={{ marginTop: 12 }}>{mensaje}</p>}
        {ok && <p style={{ marginTop: 12, color: "#157f4a" }}>Guardado.</p>}

        <p style={{ marginTop: 14 }}>
          <button type="submit">{enEdicion ? "Guardar" : "Agregar"}</button>{" "}
          {enEdicion && <Link href="?">Cancelar</Link>}
        </p>
      </form>
      </main>
    </>
  );
}
