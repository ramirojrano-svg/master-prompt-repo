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
import Google from "next-auth/providers/google";
import { prisma } from "../db/prisma.ts";
import { accesoPorProveedor, autorizar, sesionVigente } from "./auth-core.ts";

/**
 * ¿Está configurado el login con Google? Se decide por la presencia de las credenciales y no por
 * una bandera aparte: una bandera puede quedar prendida sin credenciales, y entonces el botón
 * aparece y lleva a una pantalla de error de Google.
 */
export const GOOGLE_LISTO = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    // Google entra SOLO si hay credenciales. Sin esto, Auth.js falla al arrancar en cualquier
    // instalación que no las tenga —incluida la de desarrollo— y el login deja de existir entero
    // por una función opcional.
    ...(GOOGLE_LISTO
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID!,
            clientSecret: process.env.AUTH_GOOGLE_SECRET!,
            // `select_account` para que el segundo login del día no entre solo con la cuenta que
            // quedó pegada: en una máquina compartida eso mete a la persona equivocada.
            authorization: { params: { prompt: "select_account" } },
          }),
        ]
      : []),
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
    /**
     * Google NO da de alta a nadie: la regla vive en `accesoPorProveedor` (auth-core), que es
     * donde se puede probar. Acá solo se decide a quién se le aplica.
     */
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return true; // credenciales: ya lo resolvió authorize()
      return accesoPorProveedor(prisma, profile ?? {});
    },

    // La validación de sessionVersion va ACÁ (no en `session`): devolver null descarta el token
    // y corta la sesión de raíz.
    async jwt({ token, user, account }) {
      // Con Google, `user.id` es el id de GOOGLE y no el de nuestra tabla. Se resuelve por email y
      // se pisa `sub`: todo lo que sigue —resolverActor, sessionVersion— indexa por nuestro id, y
      // dejar el de Google haría que la sesión no encuentre a nadie.
      if (account?.provider === "google") {
        const email = typeof token.email === "string" ? token.email.trim().toLowerCase() : "";
        const fila = await prisma.usuario.findUnique({ where: { email }, select: { id: true, sessionVersion: true } });
        if (!fila) return null;
        token.sub = fila.id;
        token.sv = fila.sessionVersion;
        return token;
      }
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
