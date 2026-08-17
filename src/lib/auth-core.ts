// src/lib/auth-core.ts — la lógica de autorización, separada de Auth.js para poder testearla.
// El provider Credentials de Auth.js (F2, wiring de Next) llama a `autorizar`. La sesión lleva
// `sessionVersion`; en cada lectura se compara contra la fila (fail-closed si el usuario fue
// borrado, fail-open ante error transitorio de DB) — eso vive en el callback de Auth.js.

import { type PrismaClient } from "@prisma/client";
import { verificarPassword } from "./password.ts";

export type UsuarioAutenticado = { id: string; email: string; nombre: string; sessionVersion: number };

/**
 * Verifica email + contraseña. Devuelve el usuario o null (mismo null para email inexistente y
 * contraseña incorrecta: no se filtra si el email existe).
 */
export async function autorizar(
  db: Pick<PrismaClient, "usuario">,
  cred: { email: string; password: string },
): Promise<UsuarioAutenticado | null> {
  const u = await db.usuario.findUnique({
    where: { email: cred.email.trim().toLowerCase() },
    select: { id: true, email: true, nombre: true, passwordHash: true, sessionVersion: true },
  });
  if (!u || !u.passwordHash) return null;
  if (!(await verificarPassword(cred.password, u.passwordHash))) return null;
  return { id: u.id, email: u.email, nombre: u.nombre, sessionVersion: u.sessionVersion };
}

/** Lo que manda un proveedor externo sobre quién dice ser. Todo `unknown`: viene de afuera. */
export type PerfilExterno = { email?: unknown; email_verified?: unknown };

/**
 * ¿Se admite a alguien que se identificó con Google?
 *
 * Google NO da de alta a nadie: solo prueba que quien entra es dueño de un email. Si eso alcanzara
 * para entrar, tener un Gmail sería la credencial de la app de un consultorio. Acá se exige además
 * que ese email YA tenga acceso activo a algún centro — el alta la hace el administrador desde la
 * ficha del profesional (§6.2).
 *
 * Se exige `email_verified`: sin eso, alguien puede registrar en su proveedor un email ajeno y
 * presentarlo acá como propio. Es el mismo motivo por el que no se confía en un `From:`.
 *
 * Vive acá y no dentro del callback de Auth.js para poder probarla: es la puerta de entrada, y una
 * puerta que no se prueba es una puerta que se abre sola.
 */
export async function accesoPorProveedor(
  db: Pick<PrismaClient, "usuarioOperador">,
  perfil: PerfilExterno,
): Promise<boolean> {
  if (perfil.email_verified !== true) return false;
  const email = typeof perfil.email === "string" ? perfil.email.trim().toLowerCase() : "";
  if (!email) return false;

  const acceso = await db.usuarioOperador.findFirst({
    where: { activo: true, usuario: { email } },
    select: { usuarioId: true },
  });
  return acceso !== null;
}

/**
 * ¿La versión de sesión del token sigue siendo válida? sv de la fila:
 *  - null (usuario borrado) => INVÁLIDA (fail-closed: la fila ausente es una respuesta definitiva).
 *  - distinta a la del token => INVÁLIDA (baja/cambio de rol crítico incrementó la versión).
 * El error TRANSITORIO de DB lo maneja el caller: fail-open (una caída no desloguea a todos).
 */
export function sesionVigente(svToken: number, svFila: number | null): boolean {
  if (svFila === null) return false;
  return svToken === svFila;
}
