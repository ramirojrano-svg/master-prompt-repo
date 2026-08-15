// src/servicios/plata/ledger.ts — el libro de PLATA (§5.2). Append-only: nada de update/delete;
// se compensa con un asiento de signo opuesto. El saldo se DERIVA sumando asientos, jamás un
// contador mutable. Toda escritura tiene clave idempotente con @@unique en la base: sin eso,
// findFirst->create es TOCTOU y factura dos veces.

import { randomUUID } from "node:crypto";
import { type Concepto, CuentaTipo, type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { esUniqueViolado } from "../../db/errores.ts";

/** Saldo de cuenta corriente: SUM(montoCent). > 0 ⇒ el inquilino debe. */
export async function saldoCorriente(
  db: Pick<PrismaClient, "asiento">,
  a: { operadorId: string; inquilinoId: string },
): Promise<bigint> {
  const r = await db.asiento.aggregate({
    where: { operadorId: a.operadorId, inquilinoId: a.inquilinoId, cuenta: CuentaTipo.corriente },
    _sum: { montoCent: true },
  });
  return r._sum.montoCent ?? 0n;
}

/** La morosidad agrega SOLO saldos positivos por inquilino: netear esconde la deuda real (§5.6). */
export async function morosidadAgregada(
  db: Pick<PrismaClient, "asiento">,
  operadorId: string,
): Promise<bigint> {
  const porInq = await db.asiento.groupBy({
    by: ["inquilinoId"],
    where: { operadorId, cuenta: CuentaTipo.corriente },
    _sum: { montoCent: true },
  });
  return porInq.reduce((acc, r) => acc + (r._sum.montoCent && r._sum.montoCent > 0n ? r._sum.montoCent : 0n), 0n);
}

export type NuevoAsiento = {
  operadorId: string;
  inquilinoId: string;
  concepto: Concepto;
  montoCent: bigint; // con signo
  moneda: string;
  periodo: string; // 'YYYY-MM' calculado en la tz del centro por el caller
  fechaHecho: Date;
  clave: string;
  cuenta?: CuentaTipo;
  reservaId?: string;
  pagoId?: string;
  motivo?: string;
  creadoPorUserId?: string;
  revierteAId?: string;
  /** Solo en cobros: cómo entró la plata y el nº de comprobante, para conciliar. */
  medio?: "transferencia" | "mercado_pago";
  referencia?: string;
};

/** Escribe un asiento; si la clave ya existe (renotificación / doble corrida), no hace nada. */
export async function asentarIdempotente(
  db: Pick<PrismaClient, "asiento">,
  a: NuevoAsiento,
): Promise<{ creado: boolean; id?: string }> {
  try {
    const r = await db.asiento.create({
      data: {
        operadorId: a.operadorId,
        inquilinoId: a.inquilinoId,
        cuenta: a.cuenta ?? CuentaTipo.corriente,
        concepto: a.concepto,
        montoCent: a.montoCent,
        moneda: a.moneda,
        periodo: a.periodo,
        fechaHecho: a.fechaHecho,
        clave: a.clave,
        reservaId: a.reservaId ?? null,
        pagoId: a.pagoId ?? null,
        motivo: a.motivo ?? null,
        creadoPorUserId: a.creadoPorUserId ?? null,
        revierteAId: a.revierteAId ?? null,
        medio: a.medio ?? null,
        referencia: a.referencia ?? null,
      },
      select: { id: true },
    });
    return { creado: true, id: r.id };
  } catch (e) {
    if (esUniqueViolado(e)) return { creado: false };
    throw e;
  }
}

/**
 * Cobro registrado a mano (efectivo/transferencia): mismo ledger, clave 'manual:<uuid>',
 * creadoPorUserId seteado, concepto 'pago' (negativo). No hay "editar un pago": se anula con
 * reversa. La mitad de los centros arrancan así (§5.7.1).
 */
export async function cobroManual(
  db: Pick<PrismaClient, "asiento">,
  a: { operadorId: string; inquilinoId: string; montoCent: bigint; moneda: string; periodo: string; fechaHecho: Date; creadoPorUserId: string; motivo?: string },
): Promise<{ id: string }> {
  const monto = a.montoCent < 0n ? a.montoCent : -a.montoCent; // pago = a favor (negativo)
  const r = await asentarIdempotente(db, {
    ...a,
    concepto: "pago",
    montoCent: monto,
    clave: `manual:${randomUUID()}`,
  });
  return { id: r.id! };
}
