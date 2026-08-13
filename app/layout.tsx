// app/layout.tsx — layout raíz. Español rioplatense (voseo), sin dark mode en v1 (§6.16).
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EMOAPP — gestión de alquiler de consultorios",
  description: "Agenda, inquilinos y cuenta corriente de un centro de consultorios.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body>{children}</body>
    </html>
  );
}
