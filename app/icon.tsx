// app/icon.tsx — el favicon (el ícono chico de la pestaña del navegador).
//
// Next lo toma por convención de nombre y lo sirve como <link rel="icon">. Se dibuja EN EL BUILD
// —no se pide en cada visita— así que leer el PNG con `fs` sale gratis en runtime.
//
// Cómo se hace el ícono. El logo del centro es cuadrado (montaña arriba, texto abajo). A 32 px la
// mitad de abajo se convierte en una mancha. Se recorta al pedazo superior con `object-position`
// sobre un lienzo cuadrado del alto del pedazo, para que quede solo la montaña — es la misma
// decisión que toma `Logo` cuando la variante no es "completo".

import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Se genera BAJO DEMANDA, no en el build: el PNG del logo puede no estar presente el día que
// alguien más arme el proyecto, y sin esto el build entero se cae por un favicon. En runtime,
// cuando el ícono se pide, ahí sí lee el archivo de /public.
export const dynamic = "force-dynamic";

// Un ícono chico: Chrome pide 32×32, iOS y Android piden más grandes pero escalan sin problemas.
// 64 da nitidez sin generar un archivo pesado en el build.
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default async function Icon() {
  // Se lee EL PNG que ya vive en /public y se embebe como data URL: ImageResponse no puede
  // pedirle a un fetch relativo, y hardcodear un dominio absoluto ataría el ícono al deploy.
  const bytes = await readFile(join(process.cwd(), "public", "logo.png"));
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#ffffff",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {/* La imagen renderizada al DOBLE del alto del lienzo: la mitad de arriba (la montaña)
            entra completa y la de abajo (el texto) queda recortada por el `overflow: hidden`. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dataUrl} alt="" width={size.width} height={size.height * 2} style={{ objectFit: "contain" }} />
      </div>
    ),
    size,
  );
}
