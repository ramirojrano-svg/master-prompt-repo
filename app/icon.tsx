// app/icon.tsx — el favicon (el ícono chico de la pestaña del navegador).
//
// Next lo toma por convención de nombre y lo sirve como <link rel="icon">. Se dibuja EN EL BUILD
// —no se pide en cada visita— así que leer el PNG con `fs` sale gratis en runtime.
//
// Se pinta el logo ENTERO centrado sobre un lienzo cuadrado transparente. No se recorta la parte
// de abajo: el intento anterior asumía que el PNG dividía mitad y mitad entre montaña y texto, y
// como el archivo real no está en esa proporción salía cortado por la mitad. A 32 px el texto no
// se lee, pero eso siempre es así en un favicon y no es peor que el ícono anterior.
//
// Fondo transparente y no blanco: el navegador dibuja la pestaña sobre su propio color, que en
// modo oscuro NO es blanco — un cuadrado blanco ahí se ve como un parche.

import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Se genera BAJO DEMANDA, no en el build: el PNG del logo puede no estar presente el día que
// alguien más arme el proyecto, y sin esto el build entero se cae por un favicon. En runtime,
// cuando el ícono se pide, ahí sí lee el archivo de /public.
export const dynamic = "force-dynamic";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default async function Icon() {
  // Se lee EL PNG que ya vive en /public y se embebe como data URL: ImageResponse no puede
  // hacer un fetch relativo, y hardcodear un dominio absoluto ataría el ícono al deploy.
  const bytes = await readFile(join(process.cwd(), "public", "logo.png"));
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dataUrl} alt="" width={size.width} height={size.height} style={{ objectFit: "contain" }} />
      </div>
    ),
    size,
  );
}
