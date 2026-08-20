"use client";

// El único motivo por el que esta pantalla tiene una pizca de cliente: `window.print()` no existe
// en el servidor.
//
// Imprimir ES la forma de mandar esto por mail — el diálogo del navegador ofrece "Guardar como
// PDF" en todos lados, escritorio y celular. Sumar una librería de PDF al proyecto para hacer lo
// mismo sería más código, más peso y un segundo diseño que mantener en paralelo con este.

export function BotonImprimir() {
  return (
    <button type="button" className="pastilla" onClick={() => window.print()}>
      Imprimir o guardar PDF
    </button>
  );
}
