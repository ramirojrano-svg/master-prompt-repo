// src/servicios/plata/liquidacion.ts — cierre mensual (§5.4). Idempotente por clave natural
// (operadorId, inquilinoId, periodo) con @@unique en la base + captura de P2002; NUNCA
// findFirst->create. Los asientos se reclaman con un updateMany condicionado dentro de la tx, y
// el total se suma SOLO sobre lo reclamado. Un mes cerrado da el mismo número siempre: los
// campos se congelan al emitir y no se recalculan.

import { type Concepto, type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { esUniqueViolado } from "../../db/errores.ts";
import { desagregarIva } from "../../lib/plata/dinero.ts";

// Los cargos (débitos) del período. Los pagos NO entran a la liquidación (§5.4).
const FACTURABLES: Concepto[] = [
  "cargo_uso",
  "cargo_excedente",
  "cargo_membresia",
  "cargo_exclusividad",
  "cargo_bono",
  "penalidad_tardia",
  "penalidad_noshow",
  "interes_mora",
  "ajuste_debito",
];

class NadaQueLiquidar extends Error {}

export type ResultadoCierre =
  | { ok: true; liquidacionId: string; numero: number; totalCent: bigint }
  | { ok: false; error: "NADA_QUE_LIQUIDAR" | "YA_LIQUIDADO" };

export async function cerrarPeriodo(
  a: {
    operadorId: string;
    inquilinoId: string;
    periodo: string;
    alicuotaDecimas: number; // 0 | 105 | 210
    venceEl: Date;
    receptorRazonSocial: string;
    receptorCondIva: string;
    receptorCuit?: string;
  },
  db: PrismaClient = prisma,
): Promise<ResultadoCierre> {
  try {
    return await db.$transaction(async (tx) => {
      // Correlativo por operador. La carrera la ataja el @@unique([operadorId, numero]).
      const ultimo = await tx.liquidacion.aggregate({ where: { operadorId: a.operadorId }, _max: { numero: true } });
      const numero = (ultimo._max.numero ?? 0) + 1;

      const liq = await tx.liquidacion.create({
        data: {
          operadorId: a.operadorId,
          inquilinoId: a.inquilinoId,
          periodo: a.periodo,
          numero,
          estado: "borrador",
          subtotalCent: 0n,
          netoCent: 0n,
          ivaCent: 0n,
          alicuota: a.alicuotaDecimas,
          totalCent: 0n,
          venceEl: a.venceEl,
          receptorRazonSocial: a.receptorRazonSocial,
          receptorCondIva: a.receptorCondIva,
          receptorCuit: a.receptorCuit ?? null,
        },
        select: { id: true },
      });

      // 1) Reclamar SOLO los asientos del período que nadie liquidó todavía.
      const { count } = await tx.asiento.updateMany({
        where: { operadorId: a.operadorId, inquilinoId: a.inquilinoId, cuenta: "corriente", periodo: a.periodo, liquidacionId: null, concepto: { in: FACTURABLES } },
        data: { liquidacionId: liq.id },
      });
      if (count === 0) throw new NadaQueLiquidar();

      // 2) Recién ahora sumar, y sumar SOLO lo reclamado.
      const total = await tx.asiento.aggregate({ where: { liquidacionId: liq.id }, _sum: { montoCent: true } });
      const subtotalCent = total._sum.montoCent ?? 0n;
      const { netoCent, ivaCent } = desagregarIva(subtotalCent, a.alicuotaDecimas);

      await tx.liquidacion.update({
        where: { id: liq.id },
        data: { subtotalCent, totalCent: subtotalCent, netoCent, ivaCent, estado: "emitida", emitidaAt: new Date() },
      });

      return { ok: true as const, liquidacionId: liq.id, numero, totalCent: subtotalCent };
    });
  } catch (e) {
    if (e instanceof NadaQueLiquidar) return { ok: false, error: "NADA_QUE_LIQUIDAR" };
    if (esUniqueViolado(e)) return { ok: false, error: "YA_LIQUIDADO" }; // otra corrida ya cerró (inquilino,periodo)
    throw e;
  }
}
