// src/servicios/reservas/hold.ts — el hold de lista de espera (§4.11).
// El hold es una fila REAL tipo='hold', estado='confirmada', expiraAt = ahora + 15', y por lo
// tanto OCUPA (entra en el constraint de exclusión). Un hold "blando" (Redis o un flag) vende
// el slot dos veces en cuanto dos notificados hacen click a la vez. Pasa por el MISMO camino de
// escritura que la reserva (crearOcupacion), así el lock y el constraint lo cubren.

import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { crearOcupacion, type CtxReserva, type ResultadoCrear } from "./crear.ts";

export const HOLD_TTL_MIN = 15;

export async function crearHold(raw: unknown, ctx: CtxReserva, db: PrismaClient = prisma): Promise<ResultadoCrear> {
  const ahora = ctx.ahora ?? new Date();
  const expiraAt = new Date(ahora.getTime() + HOLD_TTL_MIN * 60_000);
  return crearOcupacion(raw, ctx, db, { tipo: "hold", expiraAt });
}
