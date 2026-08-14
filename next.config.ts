import type { NextConfig } from "next";

// Sin config de webpack: Turbopack es el default en dev y build (Next 16), y un plugin que
// inyecte config de webpack rompe el build (§11.0).
const nextConfig: NextConfig = {
  outputFileTracingIncludes: {},
  // Next 16 bloquea los recursos de dev pedidos desde un host distinto al que sirvió la página.
  // Abriendo la app por 127.0.0.1 (lo que hace la prueba de humo) eso corta el cliente de HMR y
  // la página queda SIN HIDRATAR: se ve bien pero ningún handler de React corre, así que
  // arrastrar un turno no hace nada. Solo aplica a `next dev`.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // El indicador de Next vive abajo a la IZQUIERDA por defecto, justo encima del botón de crear
  // turno. Solo se ve en dev, pero ahí tapa el botón y parece que estuviera roto.
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
