// app/Iconos.tsx — los íconos de la barra, en SVG inline.
//
// Inline y no una fuente de íconos ni un paquete: son cuatro dibujos de veinte líneas, y una
// familia de íconos remota es un pedido bloqueante más y un tercero que no controlamos (la misma
// razón por la que no hay @font-face en globals.css).
//
// Todos heredan `currentColor` y miden 1em: cambian de color y de tamaño con el texto que
// acompañan, sin que haya que tocar el SVG. `aria-hidden` en todos — la palabra al lado ya
// nombra el destino, y un lector de pantalla que lea "ícono de gráfico Métricas" molesta.

type Props = { tam?: number };

const base = (tam: number) => ({
  width: tam,
  height: tam,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
});

/** Consultorios: una puerta. Es el espacio que se alquila. */
export function IconoConsultorio({ tam = 16 }: Props) {
  return (
    <svg {...base(tam)}>
      <path d="M4 21h16" />
      <path d="M7 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17" />
      <circle cx="14" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Profesionales: dos personas. Los que alquilan. */
export function IconoProfesional({ tam = 16 }: Props) {
  return (
    <svg {...base(tam)}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20v-1.2A4.8 4.8 0 0 1 7.8 14h2.4a4.8 4.8 0 0 1 4.8 4.8V20" />
      <path d="M16.5 5.6a3.2 3.2 0 0 1 0 5.9" />
      <path d="M18 14.2a4.8 4.8 0 0 1 3 4.4V20" />
    </svg>
  );
}

/** Precios: el signo de peso. Lo pidió así, y es el ícono que no necesita explicación. */
export function IconoPrecio({ tam = 16 }: Props) {
  return (
    <svg {...base(tam)}>
      <path d="M12 2.5v19" />
      <path d="M16.5 6.6C15.6 5.5 14 4.8 12.2 4.8c-2.6 0-4.5 1.4-4.5 3.4 0 2.2 1.9 3 4.3 3.5 2.8.6 4.7 1.4 4.7 3.7 0 2.1-2 3.6-4.7 3.6-2 0-3.7-.7-4.7-2" />
    </svg>
  );
}

/** Métricas: barras. Es el dibujo del panel al que lleva. */
export function IconoMetrica({ tam = 16 }: Props) {
  return (
    <svg {...base(tam)}>
      <path d="M3 21h18" />
      <rect x="4.5" y="12" width="4" height="6" rx="1" />
      <rect x="10" y="7.5" width="4" height="10.5" rx="1" />
      <rect x="15.5" y="3.5" width="4" height="14.5" rx="1" />
    </svg>
  );
}

/** El "+" del botón de crear. Trazo más grueso: va solo, sin palabra que lo acompañe. */
export function IconoMas({ tam = 24 }: Props) {
  return (
    <svg {...base(tam)} strokeWidth={2.4}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
