import type { NextConfig } from "next";

// Sin config de webpack: Turbopack es el default en dev y build (Next 16), y un plugin que
// inyecte config de webpack rompe el build (§11.0).
const nextConfig: NextConfig = {
  outputFileTracingIncludes: {},
};

export default nextConfig;
