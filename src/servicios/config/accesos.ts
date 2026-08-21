// src/servicios/config/accesos.ts — el acceso de un profesional a la app (§6.2 / §9).
//
// Dos cosas que el centro necesita y no tenía:
//   · DARLE ACCESO a un profesional. La app está pensada para que se agenden solos, y de los 29
//     cargados solo uno tenía usuario: los demás no podían entrar ni aunque quisieran.
//   · RESTABLECERLE LA CONTRASEÑA cuando la pierde. Sin esto la única salida era un script en la
//     terminal del servidor, o sea: no había salida.
//
// Se hace desde la ficha del profesional y no por mail. Mandar un mail de recuperación necesita un
// proveedor, un dominio verificado y una plantilla; para 29 personas que se conocen entre sí, que
// el administrador le pase la clave nueva es más simple y no depende de que ningún servicio ande.
//
// RESTABLECER MATA LAS SESIONES ABIERTAS. `sessionVersion` sube, y el callback de Auth.js la
// compara contra el token en cada lectura (§9). Sin eso, cambiarle la contraseña a alguien que se
// fue del centro no lo sacaría: seguiría adentro con la cookie que ya tenía, que es justo lo que
// uno cree estar evitando al resetear.

import { z } from "zod";
import { Rol, type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { definirAccion } from "../../lib/accion.ts";
import { hashPassword } from "../../lib/password.ts";

/** Mínimo de la contraseña. Corto es una invitación a "1234"; largo, a anotarla en un papel. */
export const LARGO_MIN_CLAVE = 8;

const Clave = z.string().min(LARGO_MIN_CLAVE).max(200);
const Email = z.string().trim().toLowerCase().email();

export const CrearAccesoInput = z.object({
  inquilinoId: z.string().min(1),
  email: Email,
  password: Clave,
});

export const RestablecerInput = z.object({
  inquilinoId: z.string().min(1),
  password: Clave,
});

export type ResultadoAcceso =
  | { ok: true; email: string }
  | { ok: false; error: "INQUILINO_INEXISTENTE" | "YA_TIENE_ACCESO" | "EMAIL_DE_OTRO" | "SIN_ACCESO" | "CUENTA_COMPARTIDA" };

/** El acceso actual de un profesional, para la pantalla. null = todavía no tiene. */
export async function accesoDeInquilino(
  a: { operadorId: string; inquilinoId: string },
  db: PrismaClient = prisma,
): Promise<{ email: string; activo: boolean } | null> {
  const uo = await db.usuarioOperador.findFirst({
    where: { operadorId: a.operadorId, inquilinoId: a.inquilinoId },
    select: { activo: true, usuario: { select: { email: true } } },
  });
  return uo ? { email: uo.usuario.email, activo: uo.activo } : null;
}

async function crear(
  actor: { operadorId: string },
  input: z.infer<typeof CrearAccesoInput>,
  db: PrismaClient = prisma,
): Promise<ResultadoAcceso> {
  const inq = await db.inquilino.findFirst({
    where: { id: input.inquilinoId, operadorId: actor.operadorId },
    select: { id: true, nombre: true },
  });
  if (!inq) return { ok: false, error: "INQUILINO_INEXISTENTE" };

  const yaTiene = await db.usuarioOperador.findFirst({
    where: { operadorId: actor.operadorId, inquilinoId: inq.id },
    select: { usuarioId: true },
  });
  if (yaTiene) return { ok: false, error: "YA_TIENE_ACCESO" };

  const hash = await hashPassword(input.password);

  return db.$transaction(async (tx) => {
    // Un usuario puede alquilar en varios centros con UNA identidad: si el email ya existe, se
    // reusa en vez de fallar. Lo que NO se hace es pisarle la contraseña — la comparte con el otro
    // centro, y cambiarla desde acá le rompería el acceso allá.
    const existente = await tx.usuario.findUnique({ where: { email: input.email }, select: { id: true } });
    const usuario = existente ?? (await tx.usuario.create({
      data: { email: input.email, nombre: inq.nombre, passwordHash: hash },
      select: { id: true },
    }));

    // Ese email ya trabaja en este centro con otra ficha: sería dos profesionales con un login.
    const ocupado = await tx.usuarioOperador.findFirst({
      where: { operadorId: actor.operadorId, usuarioId: usuario.id },
      select: { usuarioId: true },
    });
    if (ocupado) return { ok: false as const, error: "EMAIL_DE_OTRO" as const };

    await tx.usuarioOperador.create({
      data: {
        usuarioId: usuario.id,
        operadorId: actor.operadorId,
        rol: Rol.inquilino_titular,
        inquilinoId: inq.id,
        activo: true,
      },
    });
    return { ok: true as const, email: input.email };
  });
}

async function restablecer(
  actor: { operadorId: string },
  input: z.infer<typeof RestablecerInput>,
  db: PrismaClient = prisma,
): Promise<ResultadoAcceso> {
  const uo = await db.usuarioOperador.findFirst({
    where: { operadorId: actor.operadorId, inquilinoId: input.inquilinoId },
    select: { usuarioId: true, usuario: { select: { email: true } } },
  });
  if (!uo) return { ok: false, error: "SIN_ACCESO" };

  // La membresía es de ESTE centro, pero `Usuario` es una identidad GLOBAL: el update de abajo
  // cambia la contraseña con la que esa persona entra a todos lados. `crear()` ya se cuida de eso
  // —cuando el email existe reusa el usuario y NO le pisa la clave— y sin este chequeo restablecer
  // deshacía esa protección: alcanzaba con dar de alta un centro propio, agregar el email de
  // cualquiera como profesional (el chequeo de `ocupado` solo mira adentro del centro propio) y
  // resetear, para quedarse con su cuenta en el centro ajeno.
  //
  // Fail-closed: si la identidad vive también afuera, acá no se toca. Que la restablezca el centro
  // donde esa persona es de verdad, o que use un email distinto para este.
  //
  // Se pregunta por `usuario` y no con `usuarioOperador.count({ where: { operadorId: { not } } })`
  // a propósito: `UsuarioOperador` está en los modelos que el guard de prisma.ts scopea, y el guard
  // PISA el operadorId del where con el del contexto. Hoy no corre (nadie llama a `conTenant`),
  // pero el día que se active, ese count daría 0 siempre y el chequeo pasaría a fallar abierto —
  // justo el que sostiene esto. `Usuario` no es un modelo de tenant y `findUnique` no está entre
  // las ops scopeadas, así que este camino no depende de que el guard esté puesto o no.
  const identidad = await db.usuario.findUnique({
    where: { id: uo.usuarioId },
    select: { operadores: { select: { operadorId: true } } },
  });
  const afuera = (identidad?.operadores ?? []).some((m) => m.operadorId !== actor.operadorId);
  if (afuera) return { ok: false, error: "CUENTA_COMPARTIDA" };

  const hash = await hashPassword(input.password);
  await db.usuario.update({
    where: { id: uo.usuarioId },
    // `increment` y no leer-sumar-escribir: dos reseteos a la vez no pueden dejar la versión atrás.
    data: { passwordHash: hash, sessionVersion: { increment: 1 } },
  });
  return { ok: true, email: uo.usuario.email };
}

// La configuración se define UNA vez y la comparten la acción de producción y la inyectable. Con
// dos literales separados, el resumen de auditoría se agregaba en una y se olvidaba en la otra —
// que es exactamente lo que pasó la primera vez que se escribió esto.
//
// El resumen lleva el EMAIL y nunca la contraseña, que viaja en el mismo input.
const CFG_CREAR_ACCESO = {
  permiso: "usuarios.administrar",
  schema: CrearAccesoInput,
  resumen: (i: z.infer<typeof CrearAccesoInput>) => `alta de acceso para ${i.email}`,
} as const;

const CFG_RESTABLECER = {
  permiso: "usuarios.administrar",
  schema: RestablecerInput,
  resumen: (i: z.infer<typeof RestablecerInput>) => `clave nueva puesta a mano al profesional ${i.inquilinoId}`,
} as const;

export const crearAcceso = definirAccion(CFG_CREAR_ACCESO, (a, i) => crear(a, i));
export const restablecerClave = definirAccion(CFG_RESTABLECER, (a, i) => restablecer(a, i));

/** Versiones inyectables, para los tests. */
export const accesosCon = (db: PrismaClient) => ({
  crear: definirAccion({ ...CFG_CREAR_ACCESO, db }, (a, i) => crear(a, i, db)),
  restablecer: definirAccion({ ...CFG_RESTABLECER, db }, (a, i) => restablecer(a, i, db)),
});

/**
 * Todos los profesionales del centro con su acceso, si lo tienen.
 *
 * Existe porque gestionar los accesos de a uno, entrando a cada ficha, no escala: en este centro
 * hay treinta y cinco profesionales y a treinta y cuatro les falta. La pregunta que se hace de
 * verdad no es "¿este tiene acceso?" sino "¿a quiénes les falta?", y esa solo se contesta con la
 * lista entera delante.
 */
export async function accesosDelCentro(
  operadorId: string,
  db: PrismaClient = prisma,
): Promise<{ inquilinoId: string; nombre: string; email: string | null; activo: boolean }[]> {
  const [inquilinos, vinculos] = await Promise.all([
    db.inquilino.findMany({
      where: { operadorId, estado: { not: "baja" } },
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    }),
    db.usuarioOperador.findMany({
      where: { operadorId, inquilinoId: { not: null } },
      select: { inquilinoId: true, activo: true, usuario: { select: { email: true } } },
    }),
  ]);
  const porInquilino = new Map(vinculos.map((v) => [v.inquilinoId!, v]));

  return inquilinos.map((i) => {
    const v = porInquilino.get(i.id);
    return { inquilinoId: i.id, nombre: i.nombre, email: v?.usuario.email ?? null, activo: v?.activo ?? false };
  });
}
