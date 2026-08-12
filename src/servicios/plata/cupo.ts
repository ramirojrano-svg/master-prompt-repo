// src/servicios/plata/cupo.ts — el libro de MINUTOS (§4.12 / §5.2). Primer pedazo del ledger.
// Append-only: el saldo se DERIVA sumando asientos, nunca se lee de un contador. Dos bolsas:
// 'mes' (vence sola: el saldo filtra por período actual) y 'pack' (no vence, período '0000-00').
// Se gasta primero lo que vence. El consumo corre en Serializable con retry de P2034: sin eso,
// dos reservas simultáneas gastan el mismo minuto.

import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { esConflictoSerializable, esUniqueViolado } from "../../db/errores.ts";

export const PACK_PERIODO = "0000-00"; // los packs no vencen

type Db = Pick<PrismaClient, "bolsaAsiento"> & { $transaction: PrismaClient["$transaction"] };

/** Saldo de una bolsa (suma de asientos). Prohibido un contador mutable. */
export async function saldoBolsa(
  db: Pick<PrismaClient, "bolsaAsiento">,
  a: { operadorId: string; inquilinoId: string; bolsa: "mes" | "pack"; periodo: string },
): Promise<number> {
  const r = await db.bolsaAsiento.aggregate({
    where: { operadorId: a.operadorId, inquilinoId: a.inquilinoId, bolsa: a.bolsa, periodo: a.periodo },
    _sum: { minutos: true },
  });
  return r._sum.minutos ?? 0;
}

/** Total de minutos OTORGADOS (asientos positivos) del mes, para el otorgamiento por diferencia. */
async function totalOtorgadoMes(
  db: Pick<PrismaClient, "bolsaAsiento">,
  a: { operadorId: string; inquilinoId: string; periodo: string },
): Promise<number> {
  const r = await db.bolsaAsiento.aggregate({
    where: { operadorId: a.operadorId, inquilinoId: a.inquilinoId, bolsa: "mes", periodo: a.periodo, minutos: { gt: 0 } },
    _sum: { minutos: true },
  });
  return r._sum.minutos ?? 0;
}

/**
 * Otorga el cupo del mes PEREZOSAMENTE, por DIFERENCIA contra lo ya otorgado en ese período
 * (§9). Un upgrade de 8h a 20h a mitad de mes acredita 12, no 20 ni 0. La `clave` idempotente
 * (`@@unique(operadorId, clave)`) frena la doble corrida; el P2002 se traga. El caller pasa el
 * `periodo` (calculado en la tz del centro): recalcularlo acá abre una ventana de doble
 * otorgamiento en el borde de mes.
 */
export async function otorgarCupoMes(
  db: Pick<PrismaClient, "bolsaAsiento">,
  a: { operadorId: string; inquilinoId: string; clave: string; periodo: string; minutosObjetivo: number; origenId?: string },
): Promise<{ otorgado: number }> {
  const ya = await totalOtorgadoMes(db, a);
  const delta = a.minutosObjetivo - ya;
  if (delta <= 0) return { otorgado: 0 };
  try {
    await db.bolsaAsiento.create({
      data: { operadorId: a.operadorId, inquilinoId: a.inquilinoId, bolsa: "mes", minutos: delta, periodo: a.periodo, clave: a.clave, origenId: a.origenId ?? null },
    });
    return { otorgado: delta };
  } catch (e) {
    if (esUniqueViolado(e)) return { otorgado: 0 }; // otra corrida ya lo hizo
    throw e;
  }
}

export type Consumo = { minutosDeCupo: number; minutosExcedente: number };

/**
 * Consume `minutos` gastando PRIMERO la bolsa que vence (mes), después el pack. Lo que no
 * alcanza NO rechaza: vuelve como excedente (el operador lo cobra a tarifa de excedente).
 * Serializable + retry de P2034: dos reservas simultáneas no gastan el mismo minuto.
 */
export async function consumirMinutos(
  db: Db,
  a: { operadorId: string; inquilinoId: string; periodo: string; minutos: number; reservaId: string },
): Promise<Consumo> {
  for (let intento = 0; intento < 3; intento++) {
    try {
      return await db.$transaction(
        async (tx) => {
          let restante = a.minutos;
          let deCupo = 0;

          const delMes = await saldoBolsa(tx, { ...a, bolsa: "mes", periodo: a.periodo });
          const tomarMes = Math.min(Math.max(0, delMes), restante);
          if (tomarMes > 0) {
            await tx.bolsaAsiento.create({ data: { operadorId: a.operadorId, inquilinoId: a.inquilinoId, bolsa: "mes", minutos: -tomarMes, periodo: a.periodo, clave: `consumo:mes:${a.reservaId}` } });
            restante -= tomarMes;
            deCupo += tomarMes;
          }

          if (restante > 0) {
            const delPack = await saldoBolsa(tx, { ...a, bolsa: "pack", periodo: PACK_PERIODO });
            const tomarPack = Math.min(Math.max(0, delPack), restante);
            if (tomarPack > 0) {
              await tx.bolsaAsiento.create({ data: { operadorId: a.operadorId, inquilinoId: a.inquilinoId, bolsa: "pack", minutos: -tomarPack, periodo: PACK_PERIODO, clave: `consumo:pack:${a.reservaId}` } });
              restante -= tomarPack;
              deCupo += tomarPack;
            }
          }

          return { minutosDeCupo: deCupo, minutosExcedente: restante };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (e) {
      if (esConflictoSerializable(e) && intento < 2) continue;
      throw e;
    }
  }
  throw new Error("consumirMinutos: reintentos de Serializable agotados");
}

/** El reintegro vuelve EXACTAMENTE a la bolsa y período de los que salió (§4.10.1). */
export async function reintegrarMinutos(
  db: Pick<PrismaClient, "bolsaAsiento">,
  a: { operadorId: string; inquilinoId: string; bolsa: "mes" | "pack"; periodo: string; minutos: number; asientoId: string },
): Promise<void> {
  try {
    await db.bolsaAsiento.create({
      data: { operadorId: a.operadorId, inquilinoId: a.inquilinoId, bolsa: a.bolsa, minutos: a.minutos, periodo: a.periodo, clave: `reintegro:${a.asientoId}` },
    });
  } catch (e) {
    if (!esUniqueViolado(e)) throw e; // ya reintegrado: idempotente
  }
}
