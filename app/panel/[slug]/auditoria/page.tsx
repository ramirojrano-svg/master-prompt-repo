// app/panel/[slug]/auditoria/page.tsx — quién hizo qué.
//
// El registro se venía escribiendo desde el principio y no había forma de leerlo. Un registro que
// nadie puede consultar no sirve el día que hace falta — y ese día es siempre uno en el que ya
// pasó algo.
//
// Abre filtrado por RECHAZOS, que es lo que se viene a buscar: los intentos sin permiso y los
// datos que la app rechazó. Los "ok" son miles y no dicen nada por sí solos.

import { redirect } from "next/navigation";
import Link from "next/link";
import { Cabecera } from "../Cabecera.tsx";
import { actorDeSesion } from "../../../../src/lib/sesion.ts";
import { ETIQUETA_PERMISO, puede, type Permiso } from "../../../../src/lib/permisos.ts";
import { prisma } from "../../../../src/db/prisma.ts";
import { MESES_RETENCION, ultimasEntradas } from "../../../../src/lib/auditoria.ts";

/** El código crudo no se le muestra a nadie: se traduce a lo que pasó. */
const RESULTADO: Record<string, string> = {
  ok: "Se hizo",
  SIN_PERMISO: "Rechazado: sin permiso",
  ENTRADA_INVALIDA: "Rechazado: datos inválidos",
};

export default async function AuditoriaPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ver?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);
  if (!puede(actor.rol, "auditoria.ver")) redirect(`/panel/${slug}`);

  const todo = sp.ver === "todo";
  const filas = await ultimasEntradas({ operadorId: actor.operadorId, soloRechazos: !todo });

  // El resumen se guarda con el id del profesional, que es lo correcto: un nombre cambia y el
  // registro dejaría de coincidir con lo que pasó. Pero "cierre de 2026-07 para
  // cmt2i42rp000y7dvvkjm7o9wv" no le dice nada a nadie, así que el id se cambia por el nombre AL
  // MOSTRARLO. Lo guardado sigue intacto.
  const fichas = await prisma.inquilino.findMany({
    where: { operadorId: actor.operadorId },
    select: { id: true, nombre: true },
  });
  const nombreDe = new Map(fichas.map((f) => [f.id, f.nombre]));
  const legible = (resumen: string | null) =>
    resumen?.replace(/\b[a-z0-9]{20,}\b/g, (id) => nombreDe.get(id) ?? id) ?? null;

  const cuando = (d: Date) =>
    d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <Cabecera slug={slug} titulo="Registro de actividad" />
      <main style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
        <p className="tenue" style={{ margin: "6px 0 14px", fontSize: 13, lineHeight: 1.6 }}>
          Cada acción que alguien intenta queda anotada acá, incluidas las que la app rechazó.
          Nunca se guarda lo que se escribió: varias acciones reciben contraseñas, y un registro
          que las guardara sería una filtración con fecha y hora. Se conserva {MESES_RETENCION} meses.
        </p>

        <nav style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <Link className="pastilla" href="?" aria-current={!todo ? "page" : undefined} style={!todo ? { borderColor: "var(--acento)" } : undefined}>
            Solo rechazos
          </Link>
          <Link className="pastilla" href="?ver=todo" aria-current={todo ? "page" : undefined} style={todo ? { borderColor: "var(--acento)" } : undefined}>
            Todo
          </Link>
        </nav>

        {filas.length === 0 ? (
          <p className="tenue">
            {todo ? "Todavía no hay actividad registrada." : "No hubo ningún intento rechazado. Es una buena noticia."}
          </p>
        ) : (
          <div className="panel" style={{ padding: 0 }}>
            <table className="lista-personas">
              <thead>
                <tr>
                  <th>Cuándo</th>
                  <th>Qué</th>
                  <th>Cómo salió</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const rechazo = f.resultado !== "ok";
                  return (
                    <tr key={f.id}>
                      <td className="tenue" style={{ whiteSpace: "nowrap", fontSize: 13 }} data-rotulo="Cuándo:">
                        {cuando(f.creadoEl)}
                      </td>
                      <td data-rotulo="Qué:">
                        {ETIQUETA_PERMISO[f.permiso as Permiso] ?? f.permiso}
                        <span className="tenue" style={{ fontSize: 12 }}> · {f.rol}</span>
                      </td>
                      <td data-rotulo="Cómo salió:" style={rechazo ? { color: "var(--error)" } : undefined}>
                        {RESULTADO[f.resultado] ?? f.resultado}
                      </td>
                      <td
                        className="tenue"
                        style={{ fontSize: 13 }}
                        data-rotulo="Detalle:"
                        data-vacio={f.resumen ? undefined : "1"}
                      >
                        {legible(f.resumen) ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
