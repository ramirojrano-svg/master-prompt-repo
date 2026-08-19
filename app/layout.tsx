// app/layout.tsx — layout raíz. Español rioplatense (voseo), sin dark mode en v1 (§6.16).
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EMOAPP — gestión de alquiler de consultorios",
  description: "Agenda, inquilinos y cuenta corriente de un centro de consultorios.",
};

/**
 * Sin esto la app es INUSABLE en un teléfono, y no de a poco: los navegadores móviles asumen que
 * una página sin `viewport` fue escrita para una pantalla de escritorio, la dibujan a 980px de
 * ancho y después la achican para que entre. Todo queda a un tercio del tamaño — la letra
 * ilegible, los botones imposibles de acertar con el dedo— y ninguna hoja de estilos lo arregla,
 * porque el problema pasa antes de que el CSS opine.
 *
 * `initial-scale: 1` = un píxel del CSS es un píxel del teléfono. `maximumScale` NO se toca:
 * bloquear el zoom es lo primero que rompe la pantalla de alguien que necesita agrandar para leer,
 * y esta app la usan profesionales de todas las edades.
 *
 * `viewportFit: cover` deja que el fondo llegue hasta el borde en los teléfonos con muesca; el
 * contenido se cuida con `safe-area-inset` en el CSS.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f9fb",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}
