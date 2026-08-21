"use client";

// El único motivo por el que esta pantalla tiene una pizca de cliente: `window.print()` no existe
// en el servidor.
//
// Ya no es la vía al PDF —para eso está "Descargar PDF", que baja el archivo de una— sino la vía
// al PAPEL. Se quedó porque son dos cosas distintas: una termina en la impresora de la recepción
// y la otra en la carpeta de descargas.

export function BotonImprimir() {
  return (
    <button type="button" className="pastilla" onClick={() => window.print()}>
      Imprimir
    </button>
  );
}
