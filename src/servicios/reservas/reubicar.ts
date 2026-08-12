// src/servicios/reservas/reubicar.ts — cambio de sala (§4.10.3).
// NUNCA `UPDATE salaId`. Siempre par: la fila vieja pasa a `reubicada`, nace una fila nueva con
// `reemplazaAId`. La sala/sede se estampa cuando la fila nace y ningún update la reescribe, así
// el reporte de ocupación del mes pasado da lo mismo hoy y en un año.

import { EstadoOcupacion, type PrismaClient, TipoOcupacion } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { esChoqueDeOcupacion } from "../../db/errores.ts";
import { clavesDeLock } from "../../dominio/locks.ts";

export type ResultadoReubicar =
  | { ok: true; id: string }
  | { ok: false; error: "NO_ENCONTRADA" | "CONGELADA" | "SALA_INEXISTENTE" | "SLOT_OCUPADO" | "SOLAPA_INQUILINO" };

export async function reubicarOcupacion(
  p: { ocupacionId: string; salaDestinoId: string; motivo?: string },
  ctx: { operadorId: string },
  db: PrismaClient = prisma,
): Promise<ResultadoReubicar> {
  const origen = await db.ocupacion.findFirst({ where: { id: p.ocupacionId, operadorId: ctx.operadorId } });
  if (!origen || origen.salaId == null || origen.inicio == null) return { ok: false, error: "NO_ENCONTRADA" };
  // Solo una reserva confirmada se mueve. usada/no_show/facturada CONGELAN la fila (§4.10.3).
  if (origen.estado !== EstadoOcupacion.confirmada) return { ok: false, error: "CONGELADA" };

  const dest = await db.sala.findFirst({ where: { id: p.salaDestinoId, operadorId: ctx.operadorId }, include: { sede: true } });
  if (!dest || !dest.activa) return { ok: false, error: "SALA_INEXISTENTE" };
  const tz = dest.sede.zonaHoraria;

  // Locks de las DOS salas (origen y destino), ordenados ascendentemente.
  const claves = [
    ...new Set([
      ...clavesDeLock({ salaId: origen.salaId, inquilinoId: origen.inquilinoId, inicio: origen.inicio, fin: origen.fin, tz }),
      ...clavesDeLock({ salaId: dest.id, inquilinoId: origen.inquilinoId, inicio: origen.inicio, fin: origen.fin, tz }),
    ]),
  ].sort();

  try {
    return await db.$transaction(async (tx) => {
      for (const c of claves) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c}))`;

      // Cierra la vieja (condicionado al estado de origen: si otro la tocó, count 0 => aborta).
      const cerrada = await tx.ocupacion.updateMany({
        where: { id: origen.id, operadorId: ctx.operadorId, estado: EstadoOcupacion.confirmada },
        data: { estado: EstadoOcupacion.reubicada, motivo: p.motivo ?? origen.motivo },
      });
      if (cerrada.count === 0) return { ok: false as const, error: "CONGELADA" };

      // Nace la nueva en el destino. El constraint es la red: si el destino está ocupado, 23P01.
      const nueva = await tx.ocupacion.create({
        data: {
          operadorId: ctx.operadorId,
          sedeId: dest.sedeId,
          salaId: dest.id,
          inquilinoId: origen.inquilinoId,
          tipo: TipoOcupacion.reserva,
          estado: EstadoOcupacion.confirmada,
          inicio: origen.inicio,
          fin: origen.fin,
          bufferMin: origen.bufferMin, // se conserva el buffer estampado
          tzSede: tz,
          bloqueaProfesional: origen.bloqueaProfesional,
          reemplazaAId: origen.id,
          motivo: p.motivo ?? null,
        },
        select: { id: true },
      });
      return { ok: true as const, id: nueva.id };
    });
  } catch (e) {
    const choque = esChoqueDeOcupacion(e);
    if (choque === "sala") return { ok: false, error: "SLOT_OCUPADO" };
    if (choque === "inquilino") return { ok: false, error: "SOLAPA_INQUILINO" };
    throw e;
  }
}
