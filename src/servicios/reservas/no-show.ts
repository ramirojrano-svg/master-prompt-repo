// src/servicios/reservas/no-show.ts — no-show y su reversión (§4.10.2).
// Lo marca el operador (o recepción), nunca el inquilino. No libera el slot (ya pasó): la fila
// queda en `no_show`, que sigue ocupando y alimenta la marca de reincidencia. Moverla al futuro
// haría desaparecer una falta real, por eso `no_show` congela la fila.
//
// NOTA (§4.10.2 / §5): el cobro del 100% y el consumo/reintegro de cupo son asientos del ledger
// (módulo de plata), y la doble auditoría (marcar + revertir) usa el libro de eventos. Ambos
// llegan con sus módulos; acá va la transición de estado, que es la fuente de la que se derivan.

import { EstadoOcupacion, type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";

export type ResultadoNoShow = { ok: true } | { ok: false; error: "NO_APLICABLE" };

/** confirmada -> no_show. Solo desde una reserva confirmada. */
export async function marcarNoShow(
  p: { ocupacionId: string; motivo?: string },
  ctx: { operadorId: string },
  db: PrismaClient = prisma,
): Promise<ResultadoNoShow> {
  const r = await db.ocupacion.updateMany({
    where: { id: p.ocupacionId, operadorId: ctx.operadorId, estado: EstadoOcupacion.confirmada },
    data: { estado: EstadoOcupacion.no_show, motivo: p.motivo ?? null },
  });
  return r.count === 1 ? { ok: true } : { ok: false, error: "NO_APLICABLE" };
}

/** no_show -> confirmada (reversión del operador, hasta 72 h después en la política real). */
export async function revertirNoShow(
  p: { ocupacionId: string },
  ctx: { operadorId: string },
  db: PrismaClient = prisma,
): Promise<ResultadoNoShow> {
  const r = await db.ocupacion.updateMany({
    where: { id: p.ocupacionId, operadorId: ctx.operadorId, estado: EstadoOcupacion.no_show },
    data: { estado: EstadoOcupacion.confirmada },
  });
  return r.count === 1 ? { ok: true } : { ok: false, error: "NO_APLICABLE" };
}
