// src/servicios/config/reset-clave.ts — "olvidé mi contraseña", por mail.
//
// Hasta ahora la única forma de recuperar el acceso era que el administrador entrara a la ficha y
// pusiera una clave nueva. Eso funciona para 29 personas que se conocen, pero deja al
// administrador sin salida (nadie lo puede resetear a él) y obliga a que la clave viaje por
// WhatsApp.
//
// Las reglas de esta pieza, y por qué:
//
//  · Se guarda el HASH del token, nunca el token. Quien tenga acceso de lectura a la base no puede
//    entrar a ninguna cuenta con eso. Es la misma razón por la que no guardamos contraseñas.
//  · UN solo uso y vencimiento corto. El token viaja por mail, y un mail queda en una bandeja de
//    entrada para siempre; el que se filtre dentro de un año no tiene que servir.
//  · Pedir el reset contesta SIEMPRE lo mismo, exista o no el email (§6.11). Si contestara distinto,
//    el formulario se convierte en un padrón: escribís mails y te dice cuáles son clientes.
//  · Al usarlo sube `sessionVersion`, que mata las sesiones abiertas. Quien recupera su cuenta
//    porque se la tomaron necesita justamente eso: que el otro quede afuera.
//  · Todos los tokens vivos de esa persona se invalidan al pedir uno nuevo. Dos llaves válidas a la
//    vez es una llave de más.

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { hashPassword } from "../../lib/password.ts";
import { emailListo, enviarEmail, mailDeReset } from "../../lib/email.ts";
import { LARGO_MIN_CLAVE } from "./accesos.ts";

/** Cuánto vive un enlace. Corto a propósito: es una llave, no una credencial. */
export const MINUTOS_VIGENCIA = 60;

export const PedirResetInput = z.object({ email: z.string().trim().toLowerCase().email() });
export const UsarResetInput = z.object({
  token: z.string().min(20),
  password: z.string().min(LARGO_MIN_CLAVE).max(200),
});

export type ResultadoPedido =
  | { ok: true; enviado: boolean }
  /** El envío no está configurado. NO se le dice al que pide —sería contarle de más—, pero el
   *  administrador tiene que poder enterarse, así que se distingue acá. */
  | { ok: false; error: "SIN_EMAIL_CONFIGURADO" };

export type ResultadoUso = { ok: true; email: string } | { ok: false; error: "TOKEN_INVALIDO" };

/** El hash con el que se guarda. SHA-256 y no bcrypt a propósito: el token ya es 256 bits de azar
 *  del sistema, así que no hay nada que estirar — y esto se compara en cada intento. */
function hashDeToken(t: string): string {
  return createHash("sha256").update(t).digest("hex");
}

export async function pedirReset(
  input: { email: string },
  ctx: { urlBase: string },
  db: PrismaClient = prisma,
): Promise<ResultadoPedido> {
  if (!emailListo()) return { ok: false, error: "SIN_EMAIL_CONFIGURADO" };

  const usuario = await db.usuario.findUnique({
    where: { email: input.email },
    select: { id: true, nombre: true, email: true },
  });
  // Email que no existe: se contesta "listo" igual. El que llama NO se entera de la diferencia.
  if (!usuario) return { ok: true, enviado: false };

  const token = randomBytes(32).toString("base64url");
  const expiraEl = new Date(Date.now() + MINUTOS_VIGENCIA * 60_000);

  await db.$transaction(async (tx) => {
    // Los pedidos anteriores que seguían vivos se queman: pedir de nuevo invalida el mail viejo.
    await tx.tokenClave.updateMany({
      where: { usuarioId: usuario.id, usadoEl: null, expiraEl: { gt: new Date() } },
      data: { usadoEl: new Date() },
    });
    await tx.tokenClave.create({ data: { usuarioId: usuario.id, tokenHash: hashDeToken(token), expiraEl } });
  });

  const enlace = `${ctx.urlBase.replace(/\/+$/, "")}/restablecer?token=${encodeURIComponent(token)}`;
  const cuerpo = mailDeReset({ nombre: usuario.nombre, enlace, minutos: MINUTOS_VIGENCIA });
  const envio = await enviarEmail({ para: usuario.email, ...cuerpo });

  // Si el proveedor lo rechaza tampoco se le cuenta al que pidió: la respuesta es la misma para
  // todos. Queda en el log del servidor, que es donde se mira cuando alguien reclama.
  if (!envio.ok) console.error("[reset] no se pudo enviar:", envio.motivo, envio.detalle ?? "");
  return { ok: true, enviado: envio.ok };
}

/** ¿El token sirve? Se consulta antes de mostrar el formulario, para no pedir una clave en vano. */
export async function tokenVigente(token: string, db: PrismaClient = prisma): Promise<boolean> {
  const fila = await db.tokenClave.findUnique({
    where: { tokenHash: hashDeToken(token) },
    select: { usadoEl: true, expiraEl: true },
  });
  return Boolean(fila && fila.usadoEl === null && fila.expiraEl > new Date());
}

export async function usarReset(input: z.infer<typeof UsarResetInput>, db: PrismaClient = prisma): Promise<ResultadoUso> {
  const fila = await db.tokenClave.findUnique({
    where: { tokenHash: hashDeToken(input.token) },
    select: { id: true, usuarioId: true, usadoEl: true, expiraEl: true, usuario: { select: { email: true } } },
  });
  // Un solo mensaje para "no existe", "ya se usó" y "venció": los tres significan lo mismo para
  // quien lo tiene en la mano, y distinguirlos le diría a un curioso si un token existió.
  if (!fila || fila.usadoEl !== null || fila.expiraEl <= new Date()) return { ok: false, error: "TOKEN_INVALIDO" };

  const hash = await hashPassword(input.password);

  const marcado = await db.$transaction(async (tx) => {
    // Se sella PRIMERO y con el `usadoEl: null` en el where: dos pestañas mandando el mismo token
    // a la vez, y solo una entra. La otra ve un token inválido, que es la verdad.
    const r = await tx.tokenClave.updateMany({ where: { id: fila.id, usadoEl: null }, data: { usadoEl: new Date() } });
    if (r.count === 0) return false;

    await tx.usuario.update({
      where: { id: fila.usuarioId },
      // `increment` y no leer-sumar-escribir: mata las sesiones abiertas sin depender del orden.
      // Quien recupera su cuenta porque se la tomaron necesita justamente que el otro quede afuera.
      data: { passwordHash: hash, sessionVersion: { increment: 1 } },
    });
    return true;
  });

  return marcado ? { ok: true, email: fila.usuario.email } : { ok: false, error: "TOKEN_INVALIDO" };
}
