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
export const FACTURABLES: Concepto[] = [
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

/**
 * Los cargos del período que YA fueron dados vuelta por una nota de crédito.
 *
 * Existe por un agujero que costaba plata de verdad. Cancelar un turno no borra su cargo: le suma
 * un contraasiento `nota_credito` por el mismo importe, y el neto del libro queda en cero, que es
 * lo correcto. Pero `FACTURABLES` —la lista de lo que el cierre reclama y suma— no incluye
 * `nota_credito`, así que el crédito era invisible para el cierre: reclamaba el cargo original y
 * emitía la liquidación por el importe entero. Resultado: un turno cancelado se le seguía
 * facturando al profesional, con el papel diciendo que lo reservó.
 *
 * La salida no es sumar la nota de crédito a `FACTURABLES` —eso daría el total bien pero dejaría
 * el renglón del turno cancelado en el detalle, y un papel cuyas líneas no suman el total es peor
 * que uno mal—. Es más simple: un cargo anulado no entra. Ni él, ni su crédito. El turno no pasó.
 */
export async function cargosAnulados(
  db: Pick<PrismaClient, "asiento">,
  a: { operadorId: string; periodo: string; inquilinoId?: string },
): Promise<string[]> {
  const reversas = await db.asiento.findMany({
    where: {
      operadorId: a.operadorId,
      periodo: a.periodo,
      ...(a.inquilinoId ? { inquilinoId: a.inquilinoId } : {}),
      revierteAId: { not: null },
    },
    select: { revierteAId: true },
  });
  return reversas.map((r) => r.revierteAId!).filter((x): x is string => x !== null);
}

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
      // Un cargo cuyo turno se canceló ya está compensado en el libro: reclamarlo lo metería en
      // el papel como si la hora se hubiera usado.
      const anulados = await cargosAnulados(tx, { operadorId: a.operadorId, periodo: a.periodo, inquilinoId: a.inquilinoId });
      const { count } = await tx.asiento.updateMany({
        where: {
          operadorId: a.operadorId, inquilinoId: a.inquilinoId, cuenta: "corriente", periodo: a.periodo,
          liquidacionId: null, concepto: { in: FACTURABLES },
          ...(anulados.length ? { id: { notIn: anulados } } : {}),
        },
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
