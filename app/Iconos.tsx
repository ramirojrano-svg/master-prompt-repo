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

/** Configuración: la tuerca. Abre las opciones de la sesión y del centro. */
export function IconoTuerca({ tam = 18 }: Props) {
  return (
    <svg {...base(tam)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/** Cerrar sesión: la puerta con la flecha saliendo. */
export function IconoSalir({ tam = 16 }: Props) {
  return (
    <svg {...base(tam)}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

/** Gastos: un billete saliendo. Es lo contrario de Precios, que es lo que entra. */
export function IconoGasto({ tam = 16 }: Props) {
  return (
    <svg {...base(tam)}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

/** Negocio: la flecha de tendencia. Es la lectura, no el dato. */
export function IconoNegocio({ tam = 16 }: Props) {
  return (
    <svg {...base(tam)}>
      <path d="M3 17l6-6 4 4 7-7" />
      <path d="M16 8h5v5" />
    </svg>
  );
}

/** Mis reservas: una hoja con renglones. Es la lista, no el calendario. */
export function IconoLista({ tam = 16 }: Props) {
  return (
    <svg {...base(tam)}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}

/** Calendario: vuelve a la agenda. */
export function IconoCalendario({ tam = 16 }: Props) {
  return (
    <svg {...base(tam)}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

/** El logo de Google, en sus cuatro colores. No usa `base()`: es una marca, no un ícono de trazo. */
export function IconoGoogle({ tam = 18 }: Props) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 48 48" aria-hidden focusable={false}>
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.5 7l-.1.3 6.5 5 .5.1c4.1-3.8 6.6-9.4 6.6-15.7Z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-.3.1-6.7 5.2-.1.3C7.9 41 15.4 46 24 46Z" />
      <path fill="#FBBC05" d="M11.5 28.4c-.5-1.4-.7-2.9-.7-4.4s.3-3 .7-4.4v-.3l-6.8-5.3-.2.1A22 22 0 0 0 2 24c0 3.5.9 6.9 2.5 9.9l7-5.5Z" />
      <path fill="#EA4335" d="M24 10.5c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.4 29.9 2 24 2 15.4 2 7.9 7 4.5 14.1l7 5.5c1.8-5.3 6.7-9.1 12.5-9.1Z" />
    </svg>
  );
}

/** Huecos libres: un calendario con un espacio vacío marcado. Es lo que la pantalla busca. */
export function IconoHueco({ tam = 16 }: Props) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <rect x="7" y="13" width="5" height="4" rx="1" fill="currentColor" stroke="none" opacity="0.35" />
      <path d="M15 15h3" />
    </svg>
  );
}
