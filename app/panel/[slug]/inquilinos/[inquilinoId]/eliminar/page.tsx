// app/panel/[slug]/inquilinos/[inquilinoId]/eliminar/page.tsx — la última pregunta.
//
// Borrar una ficha es lo único de la app que no tiene vuelta atrás, así que no puede ser un botón
// más en una fila. Es una pantalla propia, con una sola cosa adentro: la lista de lo que se va a
// destruir, en números y en pesos, y un campo donde hay que escribir el nombre.
//
// El campo de confirmación no está para hacerlo difícil. Está para que la mano se detenga el
// tiempo suficiente como para leer lo de arriba.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { Cabecera } from "../../../Cabecera.tsx";
import { BotonEnviar } from "../../../BotonEnviar.tsx";
import { actorDeSesion } from "../../../../../../src/lib/sesion.ts";
import { prisma } from "../../../../../../src/db/prisma.ts";
import { puede } from "../../../../../../src/lib/permisos.ts";
import { eliminarInquilino, queArrastra } from "../../../../../../src/servicios/config/eliminar-inquilino.ts";
import { formatearPesos } from "../../../../../../src/dominio/tarifa.ts";

const FALLA: Record<string, string> = {
  NOMBRE_NO_COINCIDE: "El nombre no coincide. No se borró nada.",
  SIGUE_ACTIVO: "Primero hay que darlo de baja. Son dos pasos a propósito.",
  NO_ENCONTRADO: "Esa ficha ya no existe.",
  SIN_PERMISO: "Tu rol no puede eliminar fichas.",
  ENTRADA_INVALIDA: "Falta escribir el nombre para confirmar.",
};

export default async function EliminarPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; inquilinoId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug, inquilinoId } = await params;
  const sp = await searchParams;

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);
  if (!puede(actor.rol, "inquilino.administrar")) redirect(`/panel/${slug}`);

  const [operador, arrastre] = await Promise.all([
    prisma.operador.findUniqueOrThrow({ where: { id: actor.operadorId }, select: { moneda: true } }),
    queArrastra({ operadorId: actor.operadorId, inquilinoId }),
  ]);
  if (!arrastre) redirect(`/panel/${slug}/inquilinos?ver=todos`);

  const plata = (c: bigint) => formatearPesos(c, operador.moneda);
  const deBaja = arrastre.estado === "baja";

  async function borrar(formData: FormData) {
    "use server";
    const a = await actorDeSesion(slug);
    if (!a) redirect(`/login?centro=${encodeURIComponent(slug)}`);

    const r = await eliminarInquilino(a, {
      inquilinoId,
      confirmacion: formData.get("confirmacion"),
    });
    if (!r.ok) redirect(`/panel/${slug}/inquilinos/${inquilinoId}/eliminar?error=${r.error}`);
    if (!r.data.ok) redirect(`/panel/${slug}/inquilinos/${inquilinoId}/eliminar?error=${r.data.error}`);

    revalidatePath(`/panel/${slug}/inquilinos`);
    redirect(`/panel/${slug}/inquilinos?ver=todos&ok=eliminado&n=${encodeURIComponent(r.data.nombre)}`);
  }

  return (
    <>
      <Cabecera slug={slug} titulo="Eliminar ficha" />
      <main style={{ padding: 20, maxWidth: 640, margin: "0 auto" }}>
        <Link className="pastilla" href={`/panel/${slug}/inquilinos?ver=todos`}>‹ Profesionales</Link>

        {sp.error && <p className="aviso-error" style={{ marginTop: 16 }}>{FALLA[sp.error] ?? "No se pudo eliminar."}</p>}

        <h2 style={{ marginTop: 22, marginBottom: 4 }}>{arrastre.nombre}</h2>
        <p className="tenue" style={{ margin: 0, fontSize: 13 }}>Estado: {arrastre.estado}</p>

        {!deBaja ? (
          // El orden no es negociable: dar de baja es lo que separa un error de dedo de una
          // decisión tomada en dos momentos distintos.
          <p className="aviso-error" style={{ marginTop: 18 }}>
            Esta ficha todavía está activa. Para poder eliminarla hay que <b>darla de baja</b> primero,
            desde la lista de profesionales. Son dos pasos a propósito.
          </p>
        ) : (
          <>
            <div className="panel" style={{ padding: 20, marginTop: 18, borderLeft: "4px solid var(--error)" }}>
              <h3 style={{ marginTop: 0, fontSize: 15 }}>Se va a borrar, y no se puede deshacer</h3>
              <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 14, lineHeight: 1.8 }}>
                <li><b>{arrastre.reservas}</b> {arrastre.reservas === 1 ? "reserva" : "reservas"} de la agenda</li>
                <li>
                  <b>{arrastre.movimientos}</b> {arrastre.movimientos === 1 ? "movimiento" : "movimientos"} de cuenta
                  {arrastre.cargadoCent > 0n && <> · {plata(arrastre.cargadoCent)} en cargos</>}
                </li>
                {arrastre.liquidaciones.length > 0 && (
                  <li>
                    <b>{arrastre.liquidaciones.length}</b>{" "}
                    {arrastre.liquidaciones.length === 1 ? "liquidación emitida" : "liquidaciones emitidas"}:{" "}
                    {arrastre.liquidaciones.map((l) => `N° ${l.numero} (${plata(l.totalCent)})`).join(", ")}
                  </li>
                )}
                {arrastre.tarifas > 0 && <li><b>{arrastre.tarifas}</b> {arrastre.tarifas === 1 ? "precio propio" : "precios propios"}</li>}
                {arrastre.tieneAcceso && <li>Su <b>acceso a la app</b></li>}
              </ul>

              {/* Plata que efectivamente entró es de otra categoría: borrarla no es limpiar, es
                  cambiar lo que dicen los libros. Se dice fuerte y se sigue: la decisión es de
                  quien administra el centro, no de la app. */}
              {arrastre.cobradoCent > 0n && (
                <p className="aviso-error" style={{ marginTop: 14 }}>
                  Ojo: esta ficha tiene <b>{plata(arrastre.cobradoCent)}</b> registrados como cobrados.
                  Si esa plata entró de verdad, borrarla no la hace desaparecer del banco — solo la
                  saca de los libros.
                </p>
              )}
            </div>

            <form action={borrar} style={{ marginTop: 20 }}>
              <label htmlFor="confirmacion">
                Escribí <b>{arrastre.nombre}</b> para confirmar
              </label>
              <input id="confirmacion" name="confirmacion" required autoComplete="off" placeholder={arrastre.nombre} />
              <BotonEnviar enviando="Eliminando…" className="pastilla pastilla-riesgo">
                Eliminar definitivamente
              </BotonEnviar>
            </form>

            <p className="tenue" style={{ marginTop: 16, fontSize: 12, lineHeight: 1.5 }}>
              Si lo que querés es solo sacarlo de la operación, <b>no hace falta borrar</b>: de baja ya no
              aparece en la agenda ni en la lista. Borrar es para las fichas <b>duplicadas</b>, las que se
              crearon por error y nunca debieron existir.
            </p>
          </>
        )}
      </main>
    </>
  );
}
