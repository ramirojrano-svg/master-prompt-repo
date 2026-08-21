// proxy.ts — en Next 16 el archivo `middleware.ts` se renombró a `proxy.ts` y la función
// exportada se llama `proxy` (verificado en node_modules/next/dist/docs/.../version-16.md).
// El runtime es nodejs y no es configurable; el edge runtime NO está soportado acá.
//
// Por ahora solo agrega cabeceras de seguridad. El gate de sesión NO vive acá: vive en las
// server actions y en el resolvedor de actor (§6.1) — un gate de layout/proxy dejaría las
// actions abiertas, que son endpoints HTTP públicos.

import { NextResponse, type NextRequest } from "next/server";

/**
 * La política de contenido.
 *
 * Va en modo REPORTE y no bloqueando, a propósito y por ahora: Next inyecta sus propios scripts
 * en línea y una política mal calibrada rompe la app entera sin un solo error visible — la
 * pantalla queda en blanco. En modo reporte el navegador avisa por consola qué habría bloqueado,
 * y con eso se ajusta antes de prenderla de verdad.
 *
 * `'unsafe-inline'` en los scripts es lo que hay que sacar cuando se cambie a bloqueo, y para eso
 * hace falta que Next firme sus scripts con un nonce.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  // Las fotos de perfil son data URL, y el logo del PDF sale de /public.
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self'",
  // Nada de esto se usa, y declararlo cierra tres familias enteras de ataque.
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function proxy(_request: NextRequest) {
  const res = NextResponse.next();
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Frame-Options", "DENY");

  // HSTS: el navegador se acuerda de que este sitio es HTTPS y no vuelve a intentar por HTTP.
  // Sin esto, la primera visita del día puede empezar en claro en una red compartida — Vercel
  // redirige, pero la redirección misma viaja sin cifrar y es interceptable.
  //
  // Un año y con los subdominios incluidos. `preload` NO: entrar a la lista de los navegadores es
  // muy difícil de deshacer, y esto todavía no está en un dominio propio.
  res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  res.headers.set("Content-Security-Policy-Report-Only", CSP);

  // Ninguna pantalla usa cámara, micrófono ni ubicación. Declararlo evita que un script metido de
  // contrabando las pida en nombre del sitio.
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");

  return res;
}

export const config = {
  // Excluye estáticos y assets del framework.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
