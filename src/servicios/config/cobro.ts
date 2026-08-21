// src/servicios/config/cobro.ts — a dónde tiene que transferir el profesional.
//
// La liquidación decía cuánto hay que pagar y no a dónde, así que el circuito terminaba igual en
// un WhatsApp preguntando el alias. Estos datos van al pie de cada papel emitido.
//
// Viven en el CENTRO y no en la sede: quien cobra es el titular de la cuenta, no el edificio.
//
// Todos son opcionales a propósito. Un centro recién creado no los tiene cargados, y la app no
// puede negarse a cerrar un mes por eso — lo que falte simplemente no se imprime.

import { z } from "zod";
import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { definirAccion } from "../../lib/accion.ts";
import type { Actor } from "../../lib/actor.ts";

export type DatosDeCobro = {
  titular: string | null;
  cuit: string | null;
  cbu: string | null;
  alias: string | null;
  banco: string | null;
  nota: string | null;
  diaVencimiento: number;
};

/** ¿Hay algo para imprimir? Con todo vacío el bloque no se dibuja en vez de salir un recuadro hueco. */
export function hayDatosDeCobro(d: DatosDeCobro): boolean {
  return Boolean(d.titular || d.cbu || d.alias || d.banco || d.nota);
}

export async function datosDeCobro(operadorId: string, db: PrismaClient = prisma): Promise<DatosDeCobro> {
  const o = await db.operador.findUniqueOrThrow({
    where: { id: operadorId },
    select: {
      cobroTitular: true, cobroCuit: true, cobroCbu: true, cobroAlias: true,
      cobroBanco: true, cobroNota: true, cobroDiaVencimiento: true,
    },
  });
  return {
    titular: o.cobroTitular,
    cuit: o.cobroCuit,
    cbu: o.cobroCbu,
    alias: o.cobroAlias,
    banco: o.cobroBanco,
    nota: o.cobroNota,
    diaVencimiento: o.cobroDiaVencimiento,
  };
}

/** Un campo vacío se guarda como NULL y no como "": después se pregunta `if (dato)` en un solo lugar. */
const texto = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(max).nullable().optional());

export const CobroInput = z.object({
  titular: texto(120),
  cuit: texto(20),
  cbu: texto(30),
  alias: texto(60),
  banco: texto(80),
  nota: texto(200),
  // El 28 es el techo: un vencimiento el 30 no existe en febrero, y una fecha que algunos meses
  // no existe es una fecha que algún mes va a fallar.
  diaVencimiento: z.coerce.number().int().min(1).max(28),
});

async function guardar(actor: Actor, input: z.infer<typeof CobroInput>, db: PrismaClient) {
  await db.operador.update({
    where: { id: actor.operadorId },
    data: {
      cobroTitular: input.titular ?? null,
      cobroCuit: input.cuit ?? null,
      cobroCbu: input.cbu ?? null,
      cobroAlias: input.alias ?? null,
      cobroBanco: input.banco ?? null,
      cobroNota: input.nota ?? null,
      cobroDiaVencimiento: input.diaVencimiento,
    },
  });
  return { ok: true as const };
}

const CFG_COBRO = {
  permiso: "publica.configurar",
  schema: CobroInput,
  // Sin valores en el resumen: un CBU no tiene por qué quedar copiado en el registro de auditoría.
  resumen: () => "datos de cobro del centro",
} as const;

export const guardarDatosDeCobro = definirAccion(CFG_COBRO, (a, i) => guardar(a, i, prisma));

/** Versión inyectable, para los tests. */
export const cobroCon = (db: PrismaClient) => definirAccion({ ...CFG_COBRO, db }, (a, i) => guardar(a, i, db));
