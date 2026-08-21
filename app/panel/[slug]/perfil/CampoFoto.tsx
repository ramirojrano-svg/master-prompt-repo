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
/** El lado de la versión chica. Es el tamaño al que se dibuja el avatar en las listas. */
const LADO_CHICA = 48;

/** Recorta al cuadrado del centro y dibuja al tamaño pedido. */
function recortar(bitmap: ImageBitmap, lado: number, calidad: number): string {
  const corte = Math.min(bitmap.width, bitmap.height);
  const x = (bitmap.width - corte) / 2;
  const y = (bitmap.height - corte) / 2;

  const lienzo = document.createElement("canvas");
  lienzo.width = lado;
  lienzo.height = lado;
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("sin canvas");
  ctx.drawImage(bitmap, x, y, corte, corte, 0, 0, lado, lado);
  return lienzo.toDataURL("image/jpeg", calidad);
}

/**
 * Las DOS versiones, de una sola pasada.
 *
 * La grande se muestra en la ficha; la chica es la que viaja en las listas, y esa es la que
 * importa: con treinta y seis profesionales, mandar la grande en cada carga de Profesionales son
 * megabytes que además no se pueden cachear, porque van incrustados en el HTML.
 *
 * Se hacen ACÁ y no en el servidor porque el navegador ya tiene la imagen decodificada. Hacerlo
 * después obligaría a decodificar un JPEG en cada alta, del lado que se paga por milisegundo.
 */
async function aMiniaturas(archivo: File): Promise<{ grande: string; chica: string }> {
  const bitmap = await createImageBitmap(archivo);
  try {
    // Calidad más baja en la chica: a 48 px nadie ve la diferencia y pesa la mitad.
    return { grande: recortar(bitmap, LADO, 0.82), chica: recortar(bitmap, LADO_CHICA, 0.7) };
  } finally {
    bitmap.close();
  }
}

export function CampoFoto({ fotoActual }: { fotoActual: string | null }) {
  const [vista, setVista] = useState<string | null>(fotoActual);
  // La versión chica solo existe cuando se elige una foto nueva: para la que ya estaba guardada
  // no se puede recalcular sin volver a decodificarla, y no hace falta — se genera la próxima vez
  // que la persona cambie su foto. Mientras tanto, la lista cae a la grande.
  const [chica, setChica] = useState<string | null>(null);
  const [tocada, setTocada] = useState(false); // ¿se eligió una foto nueva en esta visita?
  const [borrar, setBorrar] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archivoRef = useRef<HTMLInputElement>(null);

  async function alElegir(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setError(null);
    try {
      const { grande, chica: mini } = await aMiniaturas(archivo);
      if (grande.length > FOTO_MAX_CHARS) {
        setError("Esa imagen quedó demasiado pesada. Probá con otra.");
        return;
      }
      setVista(grande);
      setChica(mini);
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
      {tocada && chica && <input type="hidden" name="fotoChica" value={chica} />}
      {borrar && <input type="hidden" name="borrarFoto" value="true" />}
    </div>
  );
}
