// src/types/next-auth.d.ts — extensiones de tipos de Auth.js.
// `sv` (sessionVersion) viaja en el token; el ROL NO viaja: se relee de la DB en cada request
// con resolverActor() (§9).
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user?: DefaultSession["user"] & { id?: string };
  }
  interface User {
    sv?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sv?: number;
  }
}
