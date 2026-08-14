import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Sin config de webpack: Turbopack es el default en dev y build (Next 16), y un plugin que
// inyecte config de webpack rompe el build (§11.0).
const nextConfig: NextConfig = {
  outputFileTracingIncludes: {},
  // La raíz del proyecto, CLAVADA acá. Next la infiere buscando lockfiles hacia arriba, y si hay
  // un package-lock.json suelto en la carpeta del usuario (queda ahí con un `npm install` corrido
  // por error fuera del proyecto) elige ESA como raíz. Consecuencia: carga los .env de allá y la
  // app termina hablando con otra base que la que revisan los scripts — `doctor` dice "todo en
  // orden" y el login rechaza la contraseña, sin ninguna pista de por qué.
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
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
