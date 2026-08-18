// app/panel/[slug]/Cabecera.tsx — la barra superior de las pantallas de administración.
//
// Misma forma que la barra de la agenda (logo a la izquierda, la tuerca a la derecha) para que
// cambiar de pantalla no se sienta como cambiar de aplicación. El logo vuelve a la agenda, así
// que el "‹ Agenda" suelto al pie de cada página dejó de hacer falta.
//
// Los accesos a las secciones ya no están acá: viven en el menú lateral, que lo pone el layout del
// panel una sola vez para todas las pantallas.

import Link from "next/link";
import type { Rol } from "../../../src/lib/permisos.ts";
import { Logo } from "../../Logo.tsx";
import { MenuConfig } from "./MenuConfig.tsx";

export function Cabecera({ slug, rol, titulo }: { slug: string; rol: Rol; titulo: string }) {
  return (
    <header className="barra">
      <Link href={`/panel/${slug}`} style={{ display: "flex", alignItems: "center" }} aria-label="Volver a la agenda">
        <Logo alto={26} variante="compacto" />
      </Link>
      <h1 style={{ margin: 0, fontSize: 19, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {titulo}
      </h1>
      <span style={{ marginLeft: "auto" }} />
      <MenuConfig rol={rol} />
    </header>
  );
}
