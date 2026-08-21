// src/lib/auth-core.ts — la lógica de autorización, separada de Auth.js para poder testearla.
// El provider Credentials de Auth.js (F2, wiring de Next) llama a `autorizar`. La sesión lleva
// `sessionVersion`; en cada lectura se compara contra la fila (fail-closed si el usuario fue
// borrado, fail-open ante error transitorio de DB) — eso vive en el callback de Auth.js.

import { type PrismaClient } from "@prisma/client";
import { verificarPassword } from "./password.ts";
import { anotarFallo, limpiarFallos, puedeIntentar } from "./freno.ts";

/**
 * Un hash de descarte, para gastar el mismo tiempo cuando el email NO existe.
 *
 * Sin esto, el login contesta enseguida para una dirección desconocida y tarda los ~80 ms de
 * bcrypt para una conocida. Esa diferencia se mide con un cronómetro y convierte el formulario en
 * un padrón: se prueban direcciones y el tiempo dice cuáles son del centro.
 *
 * El texto de origen no importa —nadie va a acertarle— pero el COSTO tiene que ser el mismo que
 * el de las contraseñas reales, o la comparación termina antes y la defensa no empareja nada.
 * Costo 10, igual que `hashPassword`: medido, tarda los mismos ~80 ms.
 */
const HASH_DESCARTE = "$2b$10$idTEGtqSIrL4e.UHpKdnXOryeuhvRviUvl3KW5xFYmuxj1e7Zh8/C";

export type UsuarioAutenticado = { id: string; email: string; nombre: string; sessionVersion: number };

/**
 * Verifica email + contraseña. Devuelve el usuario o null (mismo null para email inexistente y
 * contraseña incorrecta: no se filtra si el email existe).
 */
export async function autorizar(
  db: Pick<PrismaClient, "usuario"> & Partial<Pick<PrismaClient, "intentoFallido">>,
  cred: { email: string; password: string },
): Promise<UsuarioAutenticado | null> {
  const email = cred.email.trim().toLowerCase();
  const freno = db as PrismaClient;

  // El freno se consulta ANTES de tocar la contraseña: un bloqueado no gasta el bcrypt, que es
  // caro a propósito y sería la forma de tumbar el servidor sin adivinar ninguna clave.
  if (db.intentoFallido) {
    const v = await puedeIntentar(`login:${email}`, freno);
    if (!v.pasa) return null;
  }

  const u = await db.usuario.findUnique({
    where: { email },
    select: { id: true, email: true, nombre: true, passwordHash: true, sessionVersion: true },
  });

  // Con email desconocido se compara igual contra un hash de descarte. No sirve para nada más que
  // para gastar el mismo tiempo: es lo que evita que el reloj diga qué direcciones existen.
  if (!u || !u.passwordHash) {
    await verificarPassword(cred.password, HASH_DESCARTE);
    if (db.intentoFallido) await anotarFallo(`login:${email}`, freno);
    return null;
  }

  if (!(await verificarPassword(cred.password, u.passwordHash))) {
    if (db.intentoFallido) await anotarFallo(`login:${email}`, freno);
    return null;
  }

  // Salió bien: se borra la cuenta. Sin esto, quien se equivoca cuatro veces y acierta a la
  // quinta arrastra los cuatro fallos y el próximo error lo bloquea sin motivo.
  if (db.intentoFallido) await limpiarFallos(`login:${email}`, freno);
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

/**
 * Cuánto puede durar una sesión, en segundos, según los roles que tenga la persona.
 *
 * Doce horas para quien administra un centro; treinta días para el profesional.
 *
 * No es una distinción arbitraria: el administrador entra desde la computadora de la recepción,
 * que usan varias personas, y una sesión suya abierta un mes es un mes en que cualquiera que se
 * siente ahí ve la facturación de los treinta y seis, cambia precios o borra fichas. El
 * profesional entra desde su propio teléfono y volver a escribir la clave cada doce horas sería
 * una molestia sin nada del otro lado.
 *
 * Ante la duda, el plazo CORTO: si los roles no se pudieron leer, se asume administrador.
 */
export const HORAS_ADMIN = 12;
/**
 * El plazo del profesional, en HORAS y no en días.
 *
 * Son 720, o sea unos treinta días. Se escribe así porque es una duración y no un calendario: un
 * día de cambio de horario dura 23 o 25 horas, y multiplicar por 24 sería afirmar algo que no es
 * cierto. Acá da igual el resultado —nadie nota una hora en un mes— pero la regla existe para que
 * nadie copie ese `* 24` a un lugar donde sí importa.
 */
export const HORAS_PROFESIONAL = 720;

export function duracionDeSesion(roles: readonly string[] | null): number {
  if (roles === null) return HORAS_ADMIN * 3600;
  const administra = roles.some((r) => r === "owner" || r === "soporte_plataforma");
  return (administra ? HORAS_ADMIN : HORAS_PROFESIONAL) * 3600;
}

/**
 * ¿La sesión ya vivió más de lo que le corresponde?
 *
 * `emitidaEn` es el `iat` del token, en segundos. Sin él no se puede decidir y se deja pasar: un
 * token viejo sin fecha es un caso de borde de una versión anterior, no un ataque.
 */
export function sesionExpirada(emitidaEn: unknown, roles: readonly string[] | null, ahoraSeg: number): boolean {
  if (typeof emitidaEn !== "number" || !Number.isFinite(emitidaEn)) return false;
  return ahoraSeg - emitidaEn > duracionDeSesion(roles);
}
