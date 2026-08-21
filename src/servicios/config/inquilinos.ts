// src/servicios/config/inquilinos.ts — ABM de inquilinos (§6.12 paso 6). Permiso: inquilino.administrar.
// Regla dura: dar de baja ARCHIVA, no borra (§6.7). Las reservas históricas y los movimientos de
// plata siguen existiendo y siguen apareciendo en las liquidaciones viejas; un inquilino de baja
// sigue siendo un valor válido al corregir una fila del histórico.

import { z } from "zod";
import { EstadoInquilino, type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { definirAccion } from "../../lib/accion.ts";
import type { Actor } from "../../lib/actor.ts";
import { telefonoAWa } from "../../dominio/perfil.ts";

export const InquilinoInput = z.object({
  nombre: z.string().trim().min(1).max(120),
  // Quién ABONA, cuando no es el mismo profesional. Vacío = paga él. Es un dato de facturación:
  // la deuda NO se muda de cuenta (ver el comentario del campo en schema.prisma).
  pagador: z.string().trim().max(120).optional(),
  // ¿Se le factura? Viene de una casilla, así que ausente significa DESTILDADA. Por eso el default
  // del formulario es "no facturable" solo cuando el campo no viaja: al crear a alguien nuevo se
  // manda tildada, que es el caso normal.
  facturable: z.coerce.boolean().optional(),
  // A dónde se le manda la liquidación. Vacío se guarda como NULL: "" y null significarían lo
  // mismo y habría que preguntar por los dos en cada lugar que lo use.
  // Se guarda ya normalizado: cada uno lo escribe distinto, y un link de wa.me armado con
  // cualquiera de esas formas no abre nada. Lo que no se pueda normalizar se guarda NULL.
  whatsapp: z.preprocess(
    (v) => (typeof v === "string" ? telefonoAWa(v) : null),
    z.string().nullable().optional(),
  ),
  email: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().email().max(160).nullable().optional(),
  ),
});

export type ResultadoInquilino = { ok: true; id: string } | { ok: false; error: "NO_ENCONTRADO" };

type DatosInquilino = { nombre: string; pagador?: string; facturable?: boolean; email?: string | null; whatsapp?: string | null };

async function crear(actor: Actor, input: DatosInquilino, db: PrismaClient): Promise<ResultadoInquilino> {
  const i = await db.inquilino.create({
    data: {
      operadorId: actor.operadorId,
      nombre: input.nombre,
      pagador: input.pagador || null,
      estado: EstadoInquilino.activo,
      facturable: input.facturable ?? true,
      email: input.email ?? null,
      whatsapp: input.whatsapp ?? null,
    },
    select: { id: true },
  });
  return { ok: true, id: i.id };
}

async function editar(
  actor: Actor,
  input: DatosInquilino & { inquilinoId: string },
  db: PrismaClient,
): Promise<ResultadoInquilino> {
  // Editar el nombre NO reescribe ninguna fila de plata ya emitida (§6.7): la liquidación
  // estampó sus datos al emitirse.
  //
  // Dejar de facturarle TAMPOCO toca lo ya facturado: los cargos que están asentados siguen ahí y
  // se siguen cobrando. Marca de acá en adelante — si además hay que perdonarle lo viejo, eso es
  // un pago o una nota de crédito, que son movimientos que quedan registrados.
  const r = await db.inquilino.updateMany({
    where: { id: input.inquilinoId, operadorId: actor.operadorId },
    data: { nombre: input.nombre, pagador: input.pagador || null, facturable: input.facturable ?? false, email: input.email ?? null, whatsapp: input.whatsapp ?? null },
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
  crear: definirAccion({ permiso: "inquilino.administrar", schema: InquilinoInput, db }, (a, i) => crear(a, i, db)),
  editar: definirAccion({ permiso: "inquilino.administrar", schema: InquilinoInput.extend({ inquilinoId: z.string().min(1) }), db }, (a, i) => editar(a, i, db)),
  cambiarEstado: definirAccion({ permiso: "inquilino.administrar", schema: EstadoInput, db }, (a, i) =>
    cambiarEstado(a, { inquilinoId: i.inquilinoId, estado: i.estado as EstadoInquilino }, db),
  ),
});
