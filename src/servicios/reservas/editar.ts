// src/servicios/reservas/editar.ts — editar campos NO temporales (§4.10.3 / invariante §14.25).
// Editar el motivo o una nota jamás toca salaId, inicio, fin, precio ni tzSede. La resolución
// "a qué sala pertenece esta fila con caída al default" es SOLO para el alta: corregirle el
// motivo a una reserva vieja de una sala archivada NO puede moverla a la principal en silencio.

import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";

export type ResultadoEditar = { ok: true } | { ok: false; error: "NO_ENCONTRADA" | "SIN_CAMBIOS" };

export async function editarOcupacion(
  p: { ocupacionId: string; motivo?: string | null; notaInterna?: string | null },
  ctx: { operadorId: string },
  db: PrismaClient = prisma,
): Promise<ResultadoEditar> {
  const data: { motivo?: string | null; notaInterna?: string | null } = {};
  if (p.motivo !== undefined) data.motivo = p.motivo;
  if (p.notaInterna !== undefined) data.notaInterna = p.notaInterna;
  if (Object.keys(data).length === 0) return { ok: false, error: "SIN_CAMBIOS" };

  // updateMany + operadorId (nunca update por id solo): la fila se resuelve dentro del tenant.
  // El `data` no incluye salaId/inicio/fin/tzSede: son intocables por diseño.
  const r = await db.ocupacion.updateMany({ where: { id: p.ocupacionId, operadorId: ctx.operadorId }, data });
  if (r.count === 0) return { ok: false, error: "NO_ENCONTRADA" };
  return { ok: true };
}
