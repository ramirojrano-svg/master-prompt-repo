// src/servicios/config/inquilinos.ts — ABM de inquilinos (§6.12 paso 6). Permiso: inquilino.administrar.
// Regla dura: dar de baja ARCHIVA, no borra (§6.7). Las reservas históricas y los movimientos de
// plata siguen existiendo y siguen apareciendo en las liquidaciones viejas; un inquilino de baja
// sigue siendo un valor válido al corregir una fila del histórico.

import { z } from "zod";
import { EstadoInquilino, type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { definirAccion } from "../../lib/accion.ts";
import type { Actor } from "../../lib/actor.ts";

export const InquilinoInput = z.object({
  nombre: z.string().trim().min(1).max(120),
});

export type ResultadoInquilino = { ok: true; id: string } | { ok: false; error: "NO_ENCONTRADO" };

async function crear(actor: Actor, input: { nombre: string }, db: PrismaClient): Promise<ResultadoInquilino> {
  const i = await db.inquilino.create({
    data: { operadorId: actor.operadorId, nombre: input.nombre, estado: EstadoInquilino.activo },
    select: { id: true },
  });
  return { ok: true, id: i.id };
}

async function editar(actor: Actor, input: { inquilinoId: string; nombre: string }, db: PrismaClient): Promise<ResultadoInquilino> {
  // Editar el nombre NO reescribe ninguna fila de plata ya emitida (§6.7): la liquidación
  // estampó sus datos al emitirse.
  const r = await db.inquilino.updateMany({
    where: { id: input.inquilinoId, operadorId: actor.operadorId },
    data: { nombre: input.nombre },
  });
  return r.count === 1 ? { ok: true, id: input.inquilinoId } : { ok: false, error: "NO_ENCONTRADO" };
}

/** Cambia el estado. `baja` archiva (no borra); `suspendido` no reserva nuevo pero entra a lo pago. */
async function cambiarEstado(actor: Actor, input: { inquilinoId: string; estado: EstadoInquilino }, db: PrismaClient): Promise<ResultadoInquilino> {
  const r = await db.inquilino.updateMany({
    where: { id: input.inquilinoId, operadorId: actor.operadorId },
    data: { estado: input.estado },
  });
  return r.count === 1 ? { ok: true, id: input.inquilinoId } : { ok: false, error: "NO_ENCONTRADO" };
}

const EstadoInput = z.object({
  inquilinoId: z.string().min(1),
  estado: z.enum(["activo", "suspendido", "baja"]),
});

export const crearInquilino = definirAccion({ permiso: "inquilino.administrar", schema: InquilinoInput }, (a, i) => crear(a, i, prisma));
export const editarInquilino = definirAccion(
  { permiso: "inquilino.administrar", schema: InquilinoInput.extend({ inquilinoId: z.string().min(1) }) },
  (a, i) => editar(a, i, prisma),
);
export const cambiarEstadoInquilino = definirAccion({ permiso: "inquilino.administrar", schema: EstadoInput }, (a, i) =>
  cambiarEstado(a, { inquilinoId: i.inquilinoId, estado: i.estado as EstadoInquilino }, prisma),
);

/** Versiones inyectables, para los tests. */
export const inquilinosCon = (db: PrismaClient) => ({
  crear: definirAccion({ permiso: "inquilino.administrar", schema: InquilinoInput }, (a, i) => crear(a, i, db)),
  editar: definirAccion({ permiso: "inquilino.administrar", schema: InquilinoInput.extend({ inquilinoId: z.string().min(1) }) }, (a, i) => editar(a, i, db)),
  cambiarEstado: definirAccion({ permiso: "inquilino.administrar", schema: EstadoInput }, (a, i) =>
    cambiarEstado(a, { inquilinoId: i.inquilinoId, estado: i.estado as EstadoInquilino }, db),
  ),
});
