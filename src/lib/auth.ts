// src/lib/auth.ts — configuración de Auth.js (next-auth v5).
//
// Reglas duras (§9):
//  - El ROL NO viaja en el token. El token solo dice QUIÉN sos; el rol efectivo lo resuelve
//    resolverActor() contra la DB en cada request, porque una degradación de rol tiene que
//    surtir efecto en el próximo click, no cuando venza el JWT.
//  - `sessionVersion` sí viaja, y se compara contra la fila en cada lectura:
//      · fila ausente (usuario borrado) => FAIL-CLOSED (respuesta definitiva, no una falla).
//      · error TRANSITORIO de DB => fail-open a propósito: una caída de la base nunca debe
//        desloguear a los usuarios legítimos.

import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "../db/prisma.ts";
import { autorizar, sesionVigente } from "./auth-core.ts";

export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(cred) {
        const email = typeof cred?.email === "string" ? cred.email : "";
        const password = typeof cred?.password === "string" ? cred.password : "";
        if (!email || !password) return null;
        const u = await autorizar(prisma, { email, password });
        if (!u) return null; // mismo null para email inexistente y contraseña incorrecta
        return { id: u.id, email: u.email, name: u.nombre, sv: u.sessionVersion };
      },
    }),
  ],
  callbacks: {
    // La validación de sessionVersion va ACÁ (no en `session`): devolver null descarta el token
    // y corta la sesión de raíz.
    async jwt({ token, user }) {
      if (user) {
        token.sv = (user as { sv?: number }).sv ?? 0;
        return token;
      }
      if (!token.sub) return token;
      try {
        const fila = await prisma.usuario.findUnique({ where: { id: token.sub }, select: { sessionVersion: true } });
        // fila ausente (usuario borrado) => sv null => FAIL-CLOSED, la sesión muere.
        if (!sesionVigente(Number(token.sv ?? 0), fila?.sessionVersion ?? null)) return null;
      } catch {
        // Error TRANSITORIO de la base: fail-open a propósito — una caída de la base nunca
        // debe desloguear a los usuarios legítimos (§9).
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
