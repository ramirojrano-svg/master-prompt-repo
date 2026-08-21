"use client";

// app/panel/[slug]/Deslizar.tsx — pasar de mes con el dedo.
//
// En un teléfono, las flechas de la barra son dos objetivos chicos arriba de todo; el gesto que
// uno hace sin pensarlo es arrastrar el calendario de costado. Esto lo escucha.
//
// Tres reglas para que el gesto no le pise el trabajo a los otros:
//
//  · Solo TÁCTIL. Con mouse hay flechas y teclado, y escuchar el arrastre ahí rompería seleccionar
//    texto.
//  · Tiene que ser CLARAMENTE horizontal: más de 60 px de costado y al menos el doble que en
//    vertical. Sin eso, bajar por la lista de turnos con el pulgar en diagonal cambiaría de mes.
//  · Un toque no es un deslizamiento. Los 60 px de umbral son justamente lo que separa "toqué el
//    día 12 para agendar" de "arrastré".
//
// La navegación es un `push` y no un `replace`: pasar tres meses adelante y querer volver con el
// botón de atrás es lo que cualquiera espera.

import { useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/** Cuánto hay que arrastrar para que cuente. Menos que esto son toques temblorosos. */
const UMBRAL_PX = 60;
/** Cuánto más horizontal que vertical tiene que ser el gesto. */
const PROPORCION = 2;

export function Deslizar({
  anterior,
  siguiente,
  children,
}: {
  anterior: string;
  siguiente: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const origen = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      onTouchStart={(e) => {
        // Con dos dedos es un zoom o un scroll de la página, no un gesto de esta pantalla.
        if (e.touches.length !== 1) {
          origen.current = null;
          return;
        }
        origen.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
      }}
      onTouchEnd={(e) => {
        const desde = origen.current;
        origen.current = null;
        if (!desde) return;

        const t = e.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - desde.x;
        const dy = t.clientY - desde.y;

        if (Math.abs(dx) < UMBRAL_PX) return;
        if (Math.abs(dx) < Math.abs(dy) * PROPORCION) return;

        // Arrastrar hacia la IZQUIERDA trae lo que está a la derecha, como pasar una hoja.
        router.push(dx < 0 ? siguiente : anterior);
      }}
      style={{ display: "contents" }}
    >
      {children}
    </div>
  );
}
