// proxy.ts — en Next 16 el archivo `middleware.ts` se renombró a `proxy.ts` y la función
// exportada se llama `proxy` (verificado en node_modules/next/dist/docs/.../version-16.md).
// El runtime es nodejs y no es configurable; el edge runtime NO está soportado acá.
//
// Por ahora solo agrega cabeceras de seguridad. El gate de sesión NO vive acá: vive en las
// server actions y en el resolvedor de actor (§6.1) — un gate de layout/proxy dejaría las
// actions abiertas, que son endpoints HTTP públicos.

import { NextResponse, type NextRequest } from "next/server";

export function proxy(_request: NextRequest) {
  const res = NextResponse.next();
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Frame-Options", "DENY");
  return res;
}

export const config = {
  // Excluye estáticos y assets del framework.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
