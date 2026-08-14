// app/panel/[slug]/Cabecera.tsx — la barra superior de las pantallas de administración.
//
// Misma forma que la barra de la agenda (logo a la izquierda, accesos a la derecha) para que
// cambiar de pantalla no se sienta como cambiar de aplicación. El logo vuelve a la agenda, así
// que el "‹ Agenda" suelto al pie de cada página dejó de hacer falta.

import Link from "next/link";
import type { Rol } from "../../../src/lib/permisos.ts";
import { Logo } from "../../Logo.tsx";
import { BarraNav, type Seccion } from "./BarraNav.tsx";

export function Cabecera({ slug, rol, actual, titulo }: { slug: string; rol: Rol; actual: Seccion; titulo: string }) {
  return (
    <header className="barra">
      <Link href={`/panel/${slug}`} style={{ display: "flex", alignItems: "center" }} aria-label="Volver a la agenda">
        <Logo alto={26} variante="compacto" />
      </Link>
      <h1 style={{ margin: 0, fontSize: 19, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {titulo}
      </h1>
      <span style={{ marginLeft: "auto" }} />
      <BarraNav slug={slug} rol={rol} actual={actual} />
    </header>
  );
}
