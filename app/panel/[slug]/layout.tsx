// app/panel/[slug]/layout.tsx — el marco de TODAS las pantallas del panel: el menú a la izquierda
// y la pantalla a la derecha.
//
// Existe para que el menú se escriba una vez. Antes cada pantalla insertaba la barra de accesos en
// su propio encabezado —cuatro copias, y tres pantallas que se armaban el encabezado a mano—, así
// que agregar una sección era acordarse de tocar todos esos archivos.
//
// El layout NO hace de guardia: si no hay actor, no dibuja el menú y deja pasar. Quien manda a
// login es la pantalla, que ya lo hacía. Duplicar el redirect acá escondería el caso en el que una
// pantalla se olvidó de hacerlo, y ese olvido es el que hay que poder ver.

import { actorDeSesion } from "../../../src/lib/sesion.ts";
import { MenuLateral } from "./MenuLateral.tsx";

export default async function PanelLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const actor = await actorDeSesion(slug);

  return (
    <div className="panel-marco">
      {actor && <MenuLateral slug={slug} rol={actor.rol} />}
      <div className="panel-contenido">{children}</div>
    </div>
  );
}
