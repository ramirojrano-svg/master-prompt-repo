"use client";

// app/panel/[slug]/liquidaciones/[liquidacionId]/Compartir.tsx — mandar el PDF desde el teléfono.
//
// En un celular "Imprimir" casi no sirve: no hay impresora cerca y el diálogo del navegador es
// incómodo en una pantalla chica. Lo que se hace de verdad ahí es mandárselo al profesional.
//
// Usa `navigator.share` con el ARCHIVO adjunto, no un enlace de wa.me. La diferencia es la que
// importa: wa.me solo puede mandar texto, así que el profesional recibiría un mensaje con el
// total pero sin el papel. Con el archivo, el selector nativo del teléfono ofrece WhatsApp —y
// también mail, Telegram o guardar en Drive— y lo que viaja es el PDF.
//
// El botón se dibuja SIEMPRE y decide al tocarlo, no antes. `navigator.canShare` con archivos no
// se puede consultar en el servidor, y dibujarlo o no según el ancho de pantalla sería adivinar:
// hay tablets con share y notebooks táctiles sin él. Si el teléfono no puede compartir archivos,
// cae a bajarlo, que es lo más parecido a lo que se pidió.

import { useState } from "react";

type Estado = "listo" | "preparando" | "sin-soporte";

export function Compartir({ url, nombre, titulo }: { url: string; nombre: string; titulo: string }) {
  const [estado, setEstado] = useState<Estado>("listo");

  async function compartir() {
    setEstado("preparando");
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error("no se pudo bajar el PDF");
      const archivo = new File([await r.blob()], nombre, { type: "application/pdf" });

      // `canShare` con `files` es la única forma honesta de saber si este teléfono puede: hay
      // navegadores que tienen `share` pero no aceptan archivos, y ahí `share` falla en silencio.
      if (navigator.canShare?.({ files: [archivo] })) {
        await navigator.share({ files: [archivo], title: titulo });
        setEstado("listo");
        return;
      }

      // Sin soporte: se baja. Desde la carpeta de descargas se adjunta a mano en WhatsApp, que es
      // un paso más pero llega al mismo lugar.
      const enlace = document.createElement("a");
      enlace.href = URL.createObjectURL(archivo);
      enlace.download = nombre;
      enlace.click();
      URL.revokeObjectURL(enlace.href);
      setEstado("sin-soporte");
    } catch (e) {
      // `AbortError` es el usuario cerrando el selector: no es un fallo y no se avisa nada.
      if ((e as Error)?.name !== "AbortError") setEstado("sin-soporte");
      else setEstado("listo");
    }
  }

  return (
    <button type="button" className="pastilla" onClick={compartir} disabled={estado === "preparando"}>
      {estado === "preparando" ? "Preparando…" : estado === "sin-soporte" ? "Descargado" : "Compartir PDF"}
    </button>
  );
}
