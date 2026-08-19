// app/panel/[slug]/inquilinos/page.tsx — ABM de inquilinos (§6.12 paso 6).
// Dar de baja ARCHIVA: las reservas y la plata históricas siguen existiendo (§6.7).
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { Buscador } from "./Buscador.tsx";
import { Avatar } from "../Avatar.tsx";
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
  searchParams: Promise<{ error?: string; ok?: string; editar?: string; ver?: string; q?: string; sin?: string }>;
}) {
  const { slug } = await params;
  const { error, ok, editar, ver, q, sin } = await searchParams;
  // El texto buscado, normalizado una vez: se usa para filtrar y para repintar el campo.
  const busca = (q ?? "").trim();

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);
  if (!puede(actor.rol, "inquilino.administrar")) redirect(`/panel/${slug}`);
  const administraUsuarios = puede(actor.rol, "usuarios.administrar");

  // Por default se listan los activos; los de baja se ven con ?ver=todos. Un filtro nunca puede
  // hacer desaparecer una fila sin que haya forma de alcanzarla (§6.4).
  const verTodos = ver === "todos";
  const soloSinAcceso = sin === "acceso";
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
      // "A quién le falta el acceso": es la pregunta al poner la app en marcha, y sin esto había
      // que recorrer la lista entera abriendo fichas.
      ...(soloSinAcceso ? { usuario: { is: null } } : {}),
    },
    orderBy: [{ estado: "asc" }, { nombre: "asc" }],
    select: {
      id: true, nombre: true, estado: true, pagador: true, foto: true, facturable: true,
      // Quién puede ENTRAR a la app. Sin esto había que abrir las 29 fichas de a una para saber a
      // quién le falta el acceso, que es exactamente lo que hay que saber al ponerla en marcha.
      //
      // Se pide SIEMPRE y se muestra solo a quien administra usuarios. Pedirlo condicionalmente
      // rompía la inferencia de tipos de Prisma, y no compra nada: a esta pantalla solo llega
      // quien administra profesionales, que en la matriz de permisos es la misma persona.
      usuario: { select: { activo: true, usuario: { select: { email: true } } } },
    },
  });
  const deBaja = await prisma.inquilino.count({ where: { operadorId: actor.operadorId, estado: "baja" } });

  // Cuántos pueden entrar a la app, sobre el total ACTIVO. Se cuenta en la base y no sobre lo que
  // quedó listado: con el buscador puesto, contar lo visible diría "1 de 3" y la pregunta que se
  // está haciendo es sobre todos.
  const [activos, conAcceso] = administraUsuarios
    ? await Promise.all([
        prisma.inquilino.count({ where: { operadorId: actor.operadorId, estado: "activo" } }),
        prisma.usuarioOperador.count({ where: { operadorId: actor.operadorId, activo: true, inquilinoId: { not: null } } }),
      ])
    : [0, 0];

  const enEdicion = editar ? inquilinos.find((i) => i.id === editar) : undefined;

  async function guardar(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);
    const inquilinoId = String(formData.get("inquilinoId") ?? "");
    const nombre = formData.get("nombre");
    const pagador = formData.get("pagador");
    // La casilla no viaja cuando está destildada: ausente = no se le factura.
    const facturable = formData.get("facturable") === "true";
    const r = inquilinoId
      ? await editarInquilino(a, { nombre, pagador, inquilinoId, facturable })
      : await crearInquilino(a, { nombre, pagador, facturable });
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
      <Cabecera slug={slug} titulo="Profesionales" />
      <main style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
      <Buscador inicial={busca} verTodos={verTodos} />

      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <p className="tenue" style={{ margin: 0 }}>
          {busca
            ? `${inquilinos.length} ${inquilinos.length === 1 ? "resultado" : "resultados"} para "${busca}"`
            : `${inquilinos.length} listados`}
          {deBaja > 0 && (verTodos ? <> · <Link href="?">ocultar los de baja</Link></> : <> · {deBaja} de baja (<Link href="?ver=todos">ver</Link>)</>)}
        </p>
        {/* Cuántos pueden usar la app. Es el número que hay que mirar al ponerla en marcha, y hasta
            ahora había que abrir las 29 fichas de a una para saberlo. */}
        {administraUsuarios && activos > 0 && (
          <p className="tenue" style={{ margin: 0, fontSize: 13 }}>
            {conAcceso === activos ? (
              <>· todos entran a la app</>
            ) : (
              <>
                · {conAcceso} de {activos} entran a la app{" "}
                <Link href={`?sin=acceso${verTodos ? "&ver=todos" : ""}`}>(ver a quién le falta)</Link>
              </>
            )}
          </p>
        )}
        {/* El formulario de alta vive al pie, y con treinta profesionales queda tan abajo que no
            se encuentra: la pantalla parecía no tener forma de agregar a nadie. Este botón lo trae
            a la vista de arriba, que es donde se lo busca — y sin `q` ni `editar`, así "Agregar"
            abre el formulario en blanco y no encima de una edición a medias. */}
        <Link href={`?${verTodos ? "ver=todos" : ""}#editor`} className="pastilla" style={{ marginLeft: "auto" }}>
          + Agregar profesional
        </Link>
      </div>

      {/* `lista-personas`: en el teléfono cada fila se apila (nombre arriba, acciones abajo). Sin
          eso las tres columnas no entran en 390px y los botones quedaban fuera de la pantalla,
          sin forma de llegar a ellos. */}
      {soloSinAcceso && (
        <p className="tenue" style={{ margin: "10px 0 0", fontSize: 13 }}>
          Mostrando solo a quienes todavía no pueden entrar a la app.{" "}
          <Link href={`?${verTodos ? "ver=todos" : ""}`}>Ver todos</Link>
        </p>
      )}
      {soloSinAcceso && inquilinos.length === 0 && (
        <p className="aviso-ok" style={{ marginTop: 12 }}>Todos tienen acceso a la app.</p>
      )}

      <table className="lista-personas" style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
        <tbody>
          {inquilinos.map((i) => (
            <tr key={i.id} style={{ borderBottom: "1px solid var(--borde)", opacity: i.estado === "baja" ? 0.6 : 1 }}>
              <td style={{ padding: "8px 4px" }}>
                {/* La foto adelante del nombre: en una lista de 35 renglones iguales, la cara se
                    reconoce sin leer. Quien no cargó ninguna muestra sus iniciales, así la columna
                    no se desalinea ni parece que falte un dato. */}
                <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                  <Avatar nombre={i.nombre} foto={i.foto} />
                  <span>
                    {/* El nombre ES el acceso a la ficha: es lo que uno toca cuando quiere ver a
                        alguien, y tenerlo como texto muerto obligaba a buscar el camino en otra
                        pantalla. */}
                    <Link href={`/panel/${slug}/inquilinos/${i.id}`} style={{ fontWeight: 500 }}>
                      {i.nombre}
                    </Link>
                    {/* Quién abona se ve en la lista: es lo que hace falta saber al momento de
                        facturar, y buscarlo abriendo cada ficha no sirve para eso. */}
                    {i.pagador && <span className="tenue" style={{ fontSize: 12 }}> · abona {i.pagador}</span>}
                  </span>
                </span>
              </td>
              <td style={{ padding: "8px 4px" }} className="tenue">
                {ETIQUETA[i.estado]}
                {/* Si entra a la app o no, y con qué mail. Es lo que hace falta para saber a quién
                    todavía hay que darle el acceso, y para contestar "¿con qué usuario entro?"
                    sin abrir la ficha. */}
                {administraUsuarios && (
                  <span style={{ display: "block", fontSize: 12, marginTop: 2 }}>
                    {i.usuario?.activo ? (
                      <span style={{ wordBreak: "break-all" }}>{i.usuario.usuario.email}</span>
                    ) : i.usuario ? (
                      <span style={{ color: "var(--error)" }}>acceso desactivado</span>
                    ) : (
                      <Link href={`/panel/${slug}/inquilinos/${i.id}#acceso`}>dar acceso a la app</Link>
                    )}
                  </span>
                )}
              </td>
              <td style={{ padding: "8px 4px", textAlign: "right", whiteSpace: "nowrap" }}>
                {/* "Editar" se fue de acá: los datos del profesional se cambian DENTRO de su ficha,
                    que es donde se está mirando a esa persona. En la lista quedan las dos acciones
                    que se hacen sin abrir a nadie: cobrarle y darlo de baja. */}
                <Link href={`/panel/${slug}/inquilinos/${i.id}#cobros`} className="pastilla" style={{ padding: "5px 12px", fontSize: 12 }}>
                  Gestionar pagos
                </Link>{" "}
                {/* Misma forma que "Gestionar pagos" —son dos acciones de la misma fila y como
                    texto suelto una parecía un comentario al lado de la otra—, pero en rojo: dar
                    de baja saca a alguien de la operación y no debería confundirse de un vistazo
                    con abrir sus pagos. Reactivar usa el color normal: no saca nada. */}
                <form action={cambiarEstado} style={{ display: "inline" }}>
                  <input type="hidden" name="inquilinoId" value={i.id} />
                  <input type="hidden" name="estado" value={i.estado === "activo" ? "baja" : "activo"} />
                  <button
                    type="submit"
                    className={i.estado === "activo" ? "pastilla pastilla-riesgo" : "pastilla"}
                    style={{ padding: "5px 12px", fontSize: 12 }}
                  >
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

        {/* Quien usa el consultorio pero no es cliente del centro. NO es lo mismo que ponerle una
            tarifa de $0: ese seguiría apareciendo en Negocio con una fila de ceros, ensuciando el
            ranking y los promedios. Destildado, queda afuera de la facturación y del tablero.
            Sus horas siguen en la agenda: el consultorio está ocupado igual. */}
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontWeight: 400 }}>
          <input
            type="checkbox"
            name="facturable"
            value="true"
            defaultChecked={enEdicion ? enEdicion.facturable : true}
            style={{ width: "auto", margin: 0 }}
          />
          Se le factura
        </label>
        <p className="tenue" style={{ margin: "4px 0 0", fontSize: 12 }}>
          Destildalo para quien usa los consultorios pero no paga —un socio, vos mismo—. No se le
          cobra, no suma a la facturación y no aparece en Negocio. Lo ya facturado no se toca.
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
