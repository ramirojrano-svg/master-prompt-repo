// src/servicios/operador/alta.ts — alta de operador (§11 F1, onboarding paso 1).
// El país DERIVA la zona horaria y la moneda; la zona se estampa en la Sede y NUNCA queda en el
// default del esquema (regla dura §14.4: el error de zona es invisible en la grilla, ya pasó con
// 450 de 455 cuentas). Crea el tenant completo (Operador + Sede + Usuario dueño) en una
// transacción, con la contraseña hasheada.

import { type PrismaClient, Rol } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { esUniqueViolado } from "../../db/errores.ts";
import { esPaisSoportado, monedaDePais, zonaDePais } from "../../dominio/paises.ts";
import { hashPassword } from "../../lib/password.ts";

export type AltaOperador = {
  nombreOperador: string;
  slug: string;
  pais: string;
  nombreSede: string;
  direccion?: string;
  email: string;
  nombreUsuario: string;
  password: string;
};

export type ResultadoAlta =
  | { ok: true; operadorId: string; usuarioId: string; zonaHoraria: string }
  | { ok: false; error: "PAIS_INVALIDO" | "SLUG_TOMADO" | "EMAIL_TOMADO" };

export async function altaOperador(a: AltaOperador, db: PrismaClient = prisma): Promise<ResultadoAlta> {
  if (!esPaisSoportado(a.pais)) return { ok: false, error: "PAIS_INVALIDO" };
  const zonaHoraria = zonaDePais(a.pais)!;
  const moneda = monedaDePais(a.pais)!;
  const passwordHash = await hashPassword(a.password);

  try {
    return await db.$transaction(async (tx) => {
      const operador = await tx.operador.create({
        data: { nombre: a.nombreOperador, slug: a.slug, pais: a.pais, moneda },
        select: { id: true },
      });
      await tx.sede.create({
        data: { operadorId: operador.id, nombre: a.nombreSede, direccion: a.direccion ?? "", zonaHoraria },
      });
      const usuario = await tx.usuario.create({
        data: { email: a.email.trim().toLowerCase(), nombre: a.nombreUsuario, passwordHash },
        select: { id: true },
      });
      await tx.usuarioOperador.create({
        data: { usuarioId: usuario.id, operadorId: operador.id, rol: Rol.owner },
      });
      return { ok: true as const, operadorId: operador.id, usuarioId: usuario.id, zonaHoraria };
    });
  } catch (e) {
    if (esUniqueViolado(e)) {
      // slug y email son los dos unique posibles; el mensaje del error dice cuál.
      const msg = String((e as { message?: string })?.message ?? "");
      return { ok: false, error: msg.includes("email") ? "EMAIL_TOMADO" : "SLUG_TOMADO" };
    }
    throw e;
  }
}
