// app/panel/[slug]/perfil/page.tsx — "Mi perfil": cómo quiere que lo nombren, y su foto.
//
// Es la única pantalla del panel donde el profesional escribe sobre SU ficha. El nombre que carga
// acá es el que ve todo el centro en la agenda: no es un perfil decorativo aparte, es el mismo
// campo que hasta ahora solo tocaba la administración.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Cabecera } from "../Cabecera.tsx";
import { actorDeSesion } from "../../../../src/lib/sesion.ts";
import { TITULOS } from "../../../../src/dominio/perfil.ts";
import { guardarPerfil, miPerfil } from "../../../../src/servicios/config/perfil.ts";
import { CampoFoto } from "./CampoFoto.tsx";

export default async function PerfilPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { slug } = await params;
  const { ok: okParam, error: errorParam } = await searchParams;

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);

  // Sin ficha de profesional no hay perfil que editar. Le pasa al administrador, que no alquila:
  // se lo manda a la agenda en vez de mostrarle un formulario que no puede guardar.
  const perfil = await miPerfil(actor);
  if (!perfil) redirect(`/panel/${slug}`);

  const ruta = `/panel/${slug}/perfil`;

  async function guardar(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);

    const r = await guardarPerfil(a, {
      nombre: formData.get("nombre"),
      titulo: formData.get("titulo") ?? "",
      foto: formData.get("foto") ?? undefined,
      borrarFoto: formData.get("borrarFoto") ?? false,
    });

    // La agenda muestra el nombre, así que su caché queda vieja si no se invalida acá.
    revalidatePath(ruta);
    revalidatePath(`/panel/${slug}`);
    const codigo = !r.ok ? r.error : r.data.ok ? null : r.data.error;
    redirect(`${ruta}${codigo ? `?error=${codigo}` : "?ok=1"}`);
  }

  const FALLA: Record<string, string> = {
    ENTRADA_INVALIDA: "Revisá el nombre: no puede quedar vacío.",
    FOTO_INVALIDA: "Esa imagen no se pudo guardar. Probá con un JPG o un PNG.",
    SIN_FICHA: "Tu usuario no está vinculado a una ficha de profesional.",
    SIN_PERMISO: "No tenés permiso para editar este perfil.",
  };

  return (
    <>
      <Cabecera slug={slug} titulo="Mi perfil" />

      <main style={{ padding: 20, maxWidth: 560, margin: "0 auto" }}>
        {okParam && <p className="aviso-ok">Perfil guardado. Así te va a ver el resto del centro.</p>}
        {errorParam && <p className="aviso-error">{FALLA[errorParam] ?? "No se pudo guardar."}</p>}

        <form action={guardar} className="panel" style={{ padding: 22, display: "grid", gap: 18 }}>
          <div>
            <label htmlFor="foto-campo" style={{ marginTop: 0 }}>
              Foto
            </label>
            <p className="tenue" style={{ margin: "0 0 10px", fontSize: 13 }}>
              Se recorta al cuadrado del centro y se guarda chica. Se ve en el menú y al lado de tus reservas.
            </p>
            <div id="foto-campo">
              <CampoFoto fotoActual={perfil.foto} />
            </div>
          </div>

          <div>
            <label htmlFor="titulo">Título</label>
            <select id="titulo" name="titulo" defaultValue={perfil.titulo ?? ""}>
              <option value="">Sin título</option>
              {TITULOS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="nombre">Nombre completo</label>
            <input id="nombre" name="nombre" type="text" required maxLength={120} defaultValue={perfil.nombre} />
            <p className="tenue" style={{ margin: "6px 0 0", fontSize: 13 }}>
              Es el nombre con el que aparecés en la agenda del centro.
            </p>
          </div>

          <p style={{ margin: 0 }}>
            <button type="submit">Guardar</button>
          </p>
        </form>
      </main>
    </>
  );
}
