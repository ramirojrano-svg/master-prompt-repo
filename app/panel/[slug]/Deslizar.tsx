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
//  · Tiene que ser CLARAMENTE horizontal: más que el umbral de costado y al menos el doble que en
//    vertical. Sin eso, bajar por la lista de turnos con el pulgar en diagonal cambiaría de mes.
//  · Un toque no es un deslizamiento. El umbral es justamente lo que separa "toqué el día 12 para
//    agendar" de "arrastré".
//
// La navegación es un `push` y no un `replace`: pasar tres meses adelante y querer volver con el
// botón de atrás es lo que cualquiera espera.
//
// ── Por qué se sentía lento ────────────────────────────────────────────────
// El gesto andaba, pero con un retraso muy notable (medido: 270-420 ms, y a veces se perdía). Eran
// dos esperas sumadas, y ninguna de las dos era la red:
//
//  1. Se decidía en `touchend`. Había que LEVANTAR el dedo para que pasara algo, así que todo el
//     tiempo que duraba el arrastre era tiempo muerto. Ahora se resuelve en `touchmove`, apenas el
//     gesto pasa el umbral: el mes cambia con el dedo todavía apoyado, que es como se comporta
//     cualquier carrusel del teléfono.
//  2. El mes vecino se pedía al servidor recién al soltar. Ahora los dos vecinos se PRECARGAN al
//     entrar, así que cuando el gesto se dispara la pantalla ya está en el navegador y el cambio
//     es inmediato.
//
// Una vez que el gesto se disparó, el resto del arrastre se ignora (`disparado`): sin eso un
// arrastre largo mandaría dos o tres meses de una.

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/** Cuánto hay que arrastrar para que cuente. Menos que esto son toques temblorosos. */
const UMBRAL_PX = 50;
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
  const disparado = useRef(false);

  // Los dos meses vecinos, listos antes de que el dedo toque la pantalla. Es la mitad de lo que
  // hacía sentir lento el gesto: sin esto, recién al soltar empezaba el viaje al servidor.
  useEffect(() => {
    router.prefetch(anterior);
    router.prefetch(siguiente);
  }, [router, anterior, siguiente]);

  /** ¿Este arrastre ya es un deslizamiento hecho y derecho? Si sí, navega y devuelve true. */
  function resolver(x: number, y: number): boolean {
    const desde = origen.current;
    if (!desde || disparado.current) return false;

    const dx = x - desde.x;
    const dy = y - desde.y;
    if (Math.abs(dx) < UMBRAL_PX) return false;
    if (Math.abs(dx) < Math.abs(dy) * PROPORCION) return false;

    disparado.current = true;
    // Arrastrar hacia la IZQUIERDA trae lo que está a la derecha, como pasar una hoja.
    router.push(dx < 0 ? siguiente : anterior);
    return true;
  }

  return (
    <div
      onTouchStart={(e) => {
        disparado.current = false;
        // Con dos dedos es un zoom o un scroll de la página, no un gesto de esta pantalla.
        if (e.touches.length !== 1) {
          origen.current = null;
          return;
        }
        origen.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
      }}
      onTouchMove={(e) => {
        const t = e.touches[0];
        if (t) resolver(t.clientX, t.clientY);
      }}
      onTouchEnd={(e) => {
        // Red de seguridad: un gesto rápido y corto puede no llegar a emitir `touchmove` suficientes
        // —o ninguno— antes de soltar. Acá se evalúa por última vez con el punto final.
        const t = e.changedTouches[0];
        if (t) resolver(t.clientX, t.clientY);
        origen.current = null;
      }}
      style={{ display: "contents" }}
    >
      {children}
    </div>
  );
}
