// app/panel/[slug]/accesos/page.tsx — quién puede entrar a la app.
//
// Estaba adentro de la ficha de cada profesional, y ahí la pregunta que uno se hace no se podía
// contestar: no es "¿este tiene acceso?" sino "¿a quiénes les falta?". Con treinta y cinco
// profesionales, eso significaba abrir treinta y cinco fichas.
//
// Acá está la lista entera, con los que faltan primero. Cada fila se abre sola y tiene el
// formulario que corresponde: crear el acceso si no lo tiene, o poner una contraseña nueva si sí.
//
// Nunca se muestra una contraseña guardada: está hasheada y no se puede recuperar. Lo que hay es
// "poner una nueva y pasársela", que es lo único honesto.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { Cabecera } from "../Cabecera.tsx";
import { Buscador } from "../Buscador.tsx";
import { actorDeSesion } from "../../../../src/lib/sesion.ts";
import { puede } from "../../../../src/lib/permisos.ts";
import { accesosDelCentro, crearAcceso, restablecerClave, LARGO_MIN_CLAVE } from "../../../../src/servicios/config/accesos.ts";

const FALLA: Record<string, string> = {
  YA_TIENE_ACCESO: "Ese profesional ya tiene acceso.",
  EMAIL_DE_OTRO: "Ese email ya lo usa otro profesional de este centro.",
  SIN_ACCESO: "Todavía no tiene acceso: creáselo primero.",
  INQUILINO_INEXISTENTE: "Ese profesional ya no existe.",
  SIN_PERMISO: "Tu rol no puede administrar accesos.",
  ENTRADA_INVALIDA: `Revisá el email y que la contraseña tenga al menos ${LARGO_MIN_CLAVE} caracteres.`,
  CUENTA_COMPARTIDA:
    "Esa persona usa el mismo email en otro centro, así que la contraseña es una sola para los dos.",
};

export default async function AccesosPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ok?: string; error?: string; n?: string; q?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);
  if (!puede(actor.rol, "usuarios.administrar")) redirect(`/panel/${slug}`);

  const todas = await accesosDelCentro(actor.operadorId);
  // El filtro es sobre el nombre Y sobre el email: con treinta y seis, buscar "gmail" para ver a
  // quiénes se les cargó una casilla de ese dominio es una pregunta tan válida como buscar a
  // alguien por su apellido.
  const busca = (sp.q ?? "").trim().toLocaleLowerCase("es");
  const filas = busca
    ? todas.filter((f) => `${f.nombre} ${f.email ?? ""}`.toLocaleLowerCase("es").includes(busca))
    : todas;

  const sinAcceso = filas.filter((f) => !f.email);
  const conAcceso = filas.filter((f) => f.email);
  // El contador de arriba habla SIEMPRE del centro entero, no de lo que quedó después de filtrar:
  // "2 de 3 no entran" mientras se busca una letra sería un número que no significa nada.
  const faltanEnTotal = todas.filter((f) => !f.email).length;
  const ruta = `/panel/${slug}/accesos`;

  async function crear(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);
    const r = await crearAcceso(a, {
      inquilinoId: formData.get("inquilinoId"),
      email: formData.get("email"),
      password: formData.get("password"),
    });
    revalidatePath(ruta);
    const codigo = !r.ok ? r.error : r.data.ok ? null : r.data.error;
    redirect(`${ruta}?${codigo ? `error=${codigo}` : `ok=creado&n=${encodeURIComponent(String(formData.get("email") ?? ""))}`}`);
  }

  async function resetear(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);
    const r = await restablecerClave(a, {
      inquilinoId: formData.get("inquilinoId"),
      password: formData.get("password"),
    });
    revalidatePath(ruta);
    const codigo = !r.ok ? r.error : r.data.ok ? null : r.data.error;
    redirect(`${ruta}?${codigo ? `error=${codigo}` : "ok=clave"}`);
  }

  return (
    <>
      <Cabecera slug={slug} titulo="Acceso a la app" />
      <main style={{ padding: 20, maxWidth: 760, margin: "0 auto" }}>
        {sp.ok === "creado" && <p className="aviso-ok">Acceso creado para {sp.n}. Pasale el email y la contraseña que cargaste.</p>}
        {sp.ok === "clave" && <p className="aviso-ok">Contraseña cambiada. Si tenía la app abierta en algún lado, quedó afuera.</p>}
        {sp.error && <p className="aviso-error">{FALLA[sp.error] ?? "No se pudo completar."}</p>}

        <p className="tenue" style={{ margin: "6px 0 14px", fontSize: 13, lineHeight: 1.6 }}>
          {faltanEnTotal === 0
            ? "Todos los profesionales activos pueden entrar a la app."
            : `${faltanEnTotal} de ${todas.length} profesionales todavía no pueden entrar.`}{" "}
          La contraseña se muestra mientras la escribís para que puedas pasársela; después no se
          puede volver a ver, solo cambiar.
        </p>

        <Buscador inicial={busca} placeholder="Buscar por nombre o email…" etiqueta="Buscar profesional" />

        {busca && filas.length === 0 && (
          <p className="tenue">Ningún profesional coincide con «{busca}».</p>
        )}

        {/* Los que faltan, primero: es la pregunta con la que uno abre esta pantalla. */}
        {sinAcceso.length > 0 && (
          <>
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>Todavía no entran</h2>
            <div style={{ display: "grid", gap: 8, marginBottom: 26 }}>
              {sinAcceso.map((f) => (
                <details key={f.inquilinoId} className="panel" data-burbuja style={{ padding: 0 }}>
                  <summary style={{ padding: "12px 16px", cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontWeight: 500 }}>{f.nombre}</span>
                    <span className="pastilla" style={{ marginLeft: "auto", padding: "4px 11px", fontSize: 12 }}>Crear acceso</span>
                  </summary>
                  <form action={crear} style={{ padding: "0 16px 16px" }}>
                    <input type="hidden" name="inquilinoId" value={f.inquilinoId} />
                    <label htmlFor={`em-${f.inquilinoId}`} style={{ marginTop: 0 }}>Email</label>
                    <input id={`em-${f.inquilinoId}`} name="email" type="email" required placeholder="profesional@email.com" />
                    <label htmlFor={`cl-${f.inquilinoId}`}>Contraseña</label>
                    <input id={`cl-${f.inquilinoId}`} name="password" type="text" required minLength={LARGO_MIN_CLAVE} maxLength={200} placeholder={`al menos ${LARGO_MIN_CLAVE} caracteres`} />
                    <p style={{ marginTop: 12, marginBottom: 0 }}>
                      <button type="submit">Crear acceso</button>
                    </p>
                  </form>
                </details>
              ))}
            </div>
          </>
        )}

        {conAcceso.length > 0 && (
          <>
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>Ya entran</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {conAcceso.map((f) => (
                <details key={f.inquilinoId} className="panel" data-burbuja style={{ padding: 0 }}>
                  <summary style={{ padding: "12px 16px", cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 500 }}>{f.nombre}</span>
                    <span className="tenue" style={{ fontSize: 13 }}>{f.email}</span>
                    {!f.activo && <span className="tenue" style={{ fontSize: 12 }}>· desactivado</span>}
                    <span className="pastilla" style={{ marginLeft: "auto", padding: "4px 11px", fontSize: 12 }}>Cambiar contraseña</span>
                  </summary>
                  {/* Restablecer, no "ver": una contraseña guardada está hasheada y poder verla
                      sería peor que no tenerla. Se pone una nueva y se la pasa; la anterior deja
                      de servir en el acto. */}
                  <form action={resetear} style={{ padding: "0 16px 16px" }}>
                    <input type="hidden" name="inquilinoId" value={f.inquilinoId} />
                    <label htmlFor={`nc-${f.inquilinoId}`} style={{ marginTop: 0 }}>Contraseña nueva</label>
                    <input id={`nc-${f.inquilinoId}`} name="password" type="text" required minLength={LARGO_MIN_CLAVE} maxLength={200} placeholder={`al menos ${LARGO_MIN_CLAVE} caracteres`} />
                    <p className="tenue" style={{ margin: "4px 0 0", fontSize: 12 }}>
                      Al guardar, si tenía la app abierta en otro lado queda afuera.
                    </p>
                    <p style={{ marginTop: 12, marginBottom: 0 }}>
                      <button type="submit" className="btn-suave">Restablecer contraseña</button>
                    </p>
                  </form>
                </details>
              ))}
            </div>
          </>
        )}

        <p className="tenue" style={{ marginTop: 22, fontSize: 12 }}>
          Los profesionales dados de baja no se listan. <Link href={`/panel/${slug}/inquilinos?ver=todos`}>Ver todos los profesionales</Link>
        </p>
      </main>
    </>
  );
}
