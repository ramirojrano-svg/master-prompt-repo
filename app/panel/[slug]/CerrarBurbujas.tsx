"use client";

// app/panel/[slug]/CerrarBurbujas.tsx — cerrar los globos tocando afuera.
//
// Los desplegables de la app son <details>/<summary>: se abren sin una línea de JavaScript, que es
// lo que los hace funcionar aunque la hidratación falle. Lo que <details> NO hace es cerrarse al
// tocar afuera, y sin eso el globo de crear turno queda tapando la agenda hasta que uno se acuerda
// de apretar el mismo botón por el que entró.
//
// Es UN listener en el documento para todas las burbujas, no un componente por cada una: menos
// piezas, y ninguna burbuja nueva se olvida de cerrarse — alcanza con marcarla `data-burbuja`.
//
// El <details> sigue funcionando solo si esto no carga: abre y cierra por el summary como siempre.
// Esto agrega comodidad, no la única forma de cerrarlo.

import { useEffect } from "react";

export function CerrarBurbujas() {
  useEffect(() => {
    const abiertas = () => document.querySelectorAll<HTMLDetailsElement>("details[data-burbuja][open]");

    // `pointerdown` y no `click`: cierra apenas se toca afuera, sin esperar a que se suelte. Con
    // `click`, arrastrar un turno empezando adentro del globo y soltando afuera lo cerraría.
    const alTocar = (e: PointerEvent) => {
      for (const d of abiertas()) if (!d.contains(e.target as Node)) d.open = false;
    };

    // Escape cierra la de más adentro. Es lo que espera cualquiera que use el teclado, y no cuesta.
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const todas = [...abiertas()];
      const ultima = todas.at(-1);
      if (ultima) {
        ultima.open = false;
        // El foco vuelve al botón que la abrió: si se queda en un campo que se acaba de esconder,
        // el teclado deja de tener dónde estar parado.
        ultima.querySelector<HTMLElement>("summary")?.focus();
      }
    };

    document.addEventListener("pointerdown", alTocar);
    document.addEventListener("keydown", alTeclado);
    return () => {
      document.removeEventListener("pointerdown", alTocar);
      document.removeEventListener("keydown", alTeclado);
    };
  }, []);

  return null;
}
