// src/servicios/reservas/espera.ts — lista de espera (§4.11).
// Los topes cuentan SOLO fechas futuras y caducan solos. Un contador anti-abuso que puede
// quedar trabado en el límite sin actividad del atacante no es un límite: es un interruptor de
// apagado que cualquiera acciona y nadie repone (§14.37).

import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";

export const TOPE_ESPERAS_OPERADOR = 20;

/** Cuenta las esperas ACTIVAS y futuras de un operador (las pasadas no cuentan para el tope). */
export async function contarEsperasActivas(
  db: Pick<PrismaClient, "esperaSlot">,
  a: { operadorId: string; ahora: Date },
): Promise<number> {
  return db.esperaSlot.count({
    where: { operadorId: a.operadorId, activo: true, fechaHasta: { gte: a.ahora } },
  });
}

export type ResultadoEspera = { ok: true; id: string } | { ok: false; error: "TOPE_ALCANZADO" };

export async function crearEspera(
  a: { operadorId: string; inquilinoId: string; salaId?: string | null; fechaDesde: Date; fechaHasta: Date; franjaDesde?: string; franjaHasta?: string; vigenteHasta: Date; ahora?: Date },
  db: PrismaClient = prisma,
): Promise<ResultadoEspera> {
  const ahora = a.ahora ?? new Date();
  if ((await contarEsperasActivas(db, { operadorId: a.operadorId, ahora })) >= TOPE_ESPERAS_OPERADOR) {
    return { ok: false, error: "TOPE_ALCANZADO" };
  }
  const e = await db.esperaSlot.create({
    data: {
      operadorId: a.operadorId,
      inquilinoId: a.inquilinoId,
      salaId: a.salaId ?? null,
      fechaDesde: a.fechaDesde,
      fechaHasta: a.fechaHasta,
      franjaDesde: a.franjaDesde ?? null,
      franjaHasta: a.franjaHasta ?? null,
      vigenteHasta: a.vigenteHasta,
    },
    select: { id: true },
  });
  return { ok: true, id: e.id };
}
