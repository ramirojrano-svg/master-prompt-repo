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
//  · Un toque no es un deslizamiento. El umbral es lo que separa "toqué el día 12 para agendar"
//    de "arrastré".
//
// La navegación es un `push` y no un `replace`: pasar tres meses adelante y querer volver con el
// botón de atrás es lo que cualquiera espera.
//
// ── El gesto se VE ─────────────────────────────────────────────────────────
// Antes el mes cambiaba de golpe, sin nada en el medio: uno arrastraba, la pantalla no se movía, y
// de pronto aparecía otro mes. Aunque fuera rápido se sentía tosco, porque no había relación entre
// lo que hacía el dedo y lo que hacía la pantalla.
//
// Ahora el calendario ACOMPAÑA al dedo y sale volando para el lado que corresponde. Dos decisiones
// hacen que eso no cueste fluidez:
//
//  · El arrastre mueve el nodo POR CSS, escribiendo `transform` sobre el elemento. No pasa por el
//    estado de React: un `setState` por cada `touchmove` son decenas de renders por segundo de
//    todo el calendario, que es justamente lo que se siente como tirones.
//  · `transform` y `opacity` son las dos cosas que el navegador anima sin rehacer el layout. Mover
//    `left` o `margin` obligaría a recalcular la grilla entera en cada cuadro.
//
// El arrastre se AMORTIGUA (`AMORTIGUA`): el dedo avanza más que el calendario. Sirve de aviso de
// que el gesto está vivo pero todavía no cuenta, y evita que un roce mueva media pantalla.
//
// Y los dos meses vecinos se PRECARGAN al entrar: sin eso el viaje al servidor arranca recién al
// soltar, y la animación termina antes de que el contenido exista.

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/** Cuánto hay que arrastrar para que cuente. Menos que esto son toques temblorosos. */
const UMBRAL_PX = 50;
/** Cuánto más horizontal que vertical tiene que ser el gesto. */
const PROPORCION = 2;
/** Cuánto del movimiento del dedo se traduce en movimiento de la pantalla, antes del umbral. */
const AMORTIGUA = 0.35;
/** Lo que dura la salida y la vuelta. Corto: es un acuse de recibo, no una película. */
const MS_SALIDA = 180;
const MS_VUELTA = 160;

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
  const caja = useRef<HTMLDivElement>(null);
  const origen = useRef<{ x: number; y: number } | null>(null);
  const disparado = useRef(false);

  // Los dos meses vecinos, listos antes de que el dedo toque la pantalla.
  useEffect(() => {
    router.prefetch(anterior);
    router.prefetch(siguiente);
  }, [router, anterior, siguiente]);

  // Al llegar el mes nuevo el nodo se reusa: si no se limpia, entra corrido y transparente.
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    el.style.transition = "none";
    el.style.transform = "";
    el.style.opacity = "";
  }, [anterior, siguiente]);

  function pintar(dx: number, ms: number, opacidad = 1) {
    const el = caja.current;
    if (!el) return;
    el.style.transition = ms ? `transform ${ms}ms ease-out, opacity ${ms}ms ease-out` : "none";
    el.style.transform = dx ? `translate3d(${dx}px, 0, 0)` : "";
    el.style.opacity = String(opacidad);
  }

  /** ¿Este arrastre ya es un deslizamiento hecho y derecho? Si sí, lo despide y navega. */
  function resolver(x: number, y: number): boolean {
    const desde = origen.current;
    if (!desde || disparado.current) return false;

    const dx = x - desde.x;
    const dy = y - desde.y;
    if (Math.abs(dx) < UMBRAL_PX) return false;
    if (Math.abs(dx) < Math.abs(dy) * PROPORCION) return false;

    disparado.current = true;
    // Sale para el mismo lado que venía yendo el dedo, y se desvanece.
    pintar(Math.sign(dx) * (caja.current?.offsetWidth ?? 300) * 0.35, MS_SALIDA, 0);
    // Arrastrar hacia la IZQUIERDA trae lo que está a la derecha, como pasar una hoja.
    router.push(dx < 0 ? siguiente : anterior);
    return true;
  }

  return (
    <div
      ref={caja}
      // `pan-y` le dice al navegador que el desplazamiento vertical sigue siendo suyo pero el
      // horizontal es nuestro. Sin esto Chrome espera a ver si el gesto va a scrollear antes de
      // entregar los eventos, y esa espera se siente como que el deslizamiento "engancha".
      style={{ touchAction: "pan-y", willChange: "transform" }}
      onTouchStart={(e) => {
        disparado.current = false;
        // Con dos dedos es un zoom o un scroll de la página, no un gesto de esta pantalla.
        if (e.touches.length !== 1) {
          origen.current = null;
          return;
        }
        origen.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
        pintar(0, 0);
      }}
      onTouchMove={(e) => {
        const t = e.touches[0];
        const desde = origen.current;
        if (!t || !desde || disparado.current) return;
        if (resolver(t.clientX, t.clientY)) return;

        // Todavía no alcanza para cambiar de mes: el calendario acompaña, amortiguado.
        const dx = t.clientX - desde.x;
        const dy = t.clientY - desde.y;
        if (Math.abs(dx) > Math.abs(dy)) pintar(dx * AMORTIGUA, 0);
      }}
      onTouchEnd={(e) => {
        // Red de seguridad: un gesto rápido y corto puede no llegar a emitir `touchmove`.
        const t = e.changedTouches[0];
        const disparo = t ? resolver(t.clientX, t.clientY) : false;
        origen.current = null;
        // No alcanzó: vuelve a su lugar en vez de quedar corrido.
        if (!disparo && !disparado.current) pintar(0, MS_VUELTA);
      }}
    >
      {children}
    </div>
  );
}
