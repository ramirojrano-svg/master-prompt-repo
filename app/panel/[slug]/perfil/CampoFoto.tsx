"use client";
// app/panel/[slug]/perfil/CampoFoto.tsx — elegir la foto y dejarla chica ANTES de mandarla.
//
// Una foto de teléfono son 3 o 4 MB. Mandarla entera para mostrarla en un círculo de 40px sería
// guardar mil veces lo que se usa, y encima la subida fallaría por tamaño en la mayoría de las
// conexiones desde las que se va a usar esto.
//
// Así que el navegador la recorta a un cuadrado de 200×200 y la convierte a JPEG antes de que
// salga: quedan unos 15 KB. Se recorta al centro y no se deforma — una cara estirada es peor que
// una cara con los bordes cortados.
//
// El recorte es una COMODIDAD, no un control: el servidor verifica el tamaño y el formato igual,
// porque a la acción se le puede hacer POST directo sin pasar por esta pantalla.

import { useRef, useState } from "react";
import { FOTO_MAX_CHARS } from "../../../../src/dominio/perfil.ts";

const LADO = 200;

/** Recorta al cuadrado del centro y devuelve la data URL. */
async function aMiniatura(archivo: File): Promise<string> {
  const bitmap = await createImageBitmap(archivo);
  const lado = Math.min(bitmap.width, bitmap.height);
  const x = (bitmap.width - lado) / 2;
  const y = (bitmap.height - lado) / 2;

  const lienzo = document.createElement("canvas");
  lienzo.width = LADO;
  lienzo.height = LADO;
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("sin canvas");
  ctx.drawImage(bitmap, x, y, lado, lado, 0, 0, LADO, LADO);
  bitmap.close();
  return lienzo.toDataURL("image/jpeg", 0.82);
}

export function CampoFoto({ fotoActual }: { fotoActual: string | null }) {
  const [vista, setVista] = useState<string | null>(fotoActual);
  const [tocada, setTocada] = useState(false); // ¿se eligió una foto nueva en esta visita?
  const [borrar, setBorrar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archivoRef = useRef<HTMLInputElement>(null);

  async function alElegir(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setError(null);
    try {
      const mini = await aMiniatura(archivo);
      if (mini.length > FOTO_MAX_CHARS) {
        setError("Esa imagen quedó demasiado pesada. Probá con otra.");
        return;
      }
      setVista(mini);
      setTocada(true);
      setBorrar(false);
    } catch {
      setError("No se pudo leer esa imagen. Probá con un JPG o un PNG.");
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      {/* El círculo es del tamaño en que se va a ver, no una vista previa gigante: lo que hay que
          poder juzgar es si la cara se reconoce chica. */}
      {vista && !borrar ? (
        // eslint-disable-next-line @next/next/no-img-element -- es una data URL, no un archivo que Next pueda optimizar
        <img src={vista} alt="Tu foto" width={72} height={72} style={{ borderRadius: "50%", objectFit: "cover", border: "1px solid var(--borde)" }} />
      ) : (
        <div
          aria-hidden="true"
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            border: "1px dashed var(--borde-fuerte)",
            display: "grid",
            placeItems: "center",
            color: "var(--tenue)",
            fontSize: 12,
          }}
        >
          sin foto
        </div>
      )}

      <div style={{ display: "grid", gap: 6 }}>
        <input ref={archivoRef} id="archivoFoto" type="file" accept="image/*" onChange={alElegir} style={{ display: "none" }} />
        <button type="button" className="btn-suave" onClick={() => archivoRef.current?.click()}>
          {vista && !borrar ? "Cambiar foto" : "Elegir foto"}
        </button>
        {vista && !borrar && (
          <button
            type="button"
            className="btn-texto"
            onClick={() => {
              setBorrar(true);
              setTocada(false);
              setError(null);
            }}
          >
            Quitar foto
          </button>
        )}
        {error && <span style={{ color: "var(--error)", fontSize: 13 }}>{error}</span>}
      </div>

      {/* Lo que viaja. La foto solo se manda si se eligió una nueva: reenviar la que ya está
          guardada sería subir 15 KB en cada guardado para dejar todo igual. */}
      {tocada && vista && <input type="hidden" name="foto" value={vista} />}
      {borrar && <input type="hidden" name="borrarFoto" value="true" />}
    </div>
  );
}
