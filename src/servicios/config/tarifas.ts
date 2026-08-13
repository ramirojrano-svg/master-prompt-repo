// src/servicios/config/tarifas.ts — precios por hora. Permiso: tarifa.administrar (solo owner).
//
// Regla dura (§8.8): un precio NO SE EDITA. Poner un precio nuevo = CERRAR el vigente
// (vigenteHasta = ahora) y CREAR otro (vigenteDesde = ahora), en la misma transacción. Si se
// editara la fila, cambiar el precio hoy reescribiría lo que se reservó y se facturó ayer, y no
// habría forma de explicarle a un profesional por qué su resumen del mes pasado cambió solo.
//
// Además, cada ocupación ESTAMPA el precio con el que nació (crear.ts). O sea: hay dos redes.
// Esta tabla dice cuánto sale de acá en adelante; la ocupación dice cuánto salió aquel día.

import { z } from "zod";
import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { definirAccion } from "../../lib/accion.ts";
import { resolverTarifa, type TarifaVigente } from "../../dominio/tarifa.ts";
import type { Actor } from "../../lib/actor.ts";

/** El alcance de una tarifa. Vacío = general (todas las salas, todos los profesionales). */
const Alcance = z.object({
  // Los select mandan "" cuando el usuario elige "todas"/"todos": eso es null, no un id vacío.
  salaId: z.string().trim().transform((s) => s || null).nullable().default(null),
  inquilinoId: z.string().trim().transform((s) => s || null).nullable().default(null),
});

export const TarifaInput = Alcance.extend({
  // Se escribe en PESOS (lo que el owner tiene en la cabeza) y se guarda en CENTAVOS.
  // coerce.number sobre "8000" y sobre "8000.50"; el redondeo es al centavo, no al peso.
  precioHora: z.coerce.number().finite().min(0).max(100_000_000),
});

export type TarifaInputT = z.infer<typeof TarifaInput>;

export type ResultadoTarifa =
  | { ok: true; id: string }
  | { ok: false; error: "SALA_INEXISTENTE" | "PROFESIONAL_INEXISTENTE" | "NO_ENCONTRADA" };

/** Pesos → centavos, sin float en el resultado. Math.round acá es sobre 2 decimales, no sobre plata acumulada. */
export function aCentavos(pesos: number): bigint {
  return BigInt(Math.round(pesos * 100));
}

/** Nombre legible del alcance, para la lista y la auditoría. */
function nombreDeAlcance(sala: string | null, prof: string | null): string {
  if (prof && sala) return `${prof} en ${sala}`;
  if (prof) return prof;
  if (sala) return sala;
  return "General";
}

async function poner(actor: Actor, input: TarifaInputT, db: PrismaClient): Promise<ResultadoTarifa> {
  // Pertenencia: los ids vienen del cliente. findFirst({id, operadorId}), nunca findUnique({id}).
  const [sala, inq] = await Promise.all([
    input.salaId ? db.sala.findFirst({ where: { id: input.salaId, operadorId: actor.operadorId }, select: { nombre: true } }) : null,
    input.inquilinoId ? db.inquilino.findFirst({ where: { id: input.inquilinoId, operadorId: actor.operadorId }, select: { nombre: true } }) : null,
  ]);
  if (input.salaId && !sala) return { ok: false, error: "SALA_INEXISTENTE" };
  if (input.inquilinoId && !inq) return { ok: false, error: "PROFESIONAL_INEXISTENTE" };

  const ahora = new Date();
  const precioHoraCent = aCentavos(input.precioHora);

  return await db.$transaction(async (tx) => {
    // 1. Cerrar la(s) vigente(s) del MISMO alcance. Se cierran en `ahora`, así una reserva creada
    //    un milisegundo antes sigue habiendo usado el precio viejo (vigenteHasta es exclusivo).
    await tx.tarifa.updateMany({
      where: {
        operadorId: actor.operadorId,
        salaId: input.salaId,
        inquilinoId: input.inquilinoId,
        vigenteHasta: null,
      },
      data: { vigenteHasta: ahora },
    });

    // 2. Crear la nueva. Fila nueva, no UPDATE: el historial queda entero.
    const t = await tx.tarifa.create({
      data: {
        operadorId: actor.operadorId,
        salaId: input.salaId,
        inquilinoId: input.inquilinoId,
        nombre: nombreDeAlcance(sala?.nombre ?? null, inq?.nombre ?? null),
        precioHoraCent,
        vigenteDesde: ahora,
      },
      select: { id: true },
    });
    return { ok: true as const, id: t.id };
  });
}

/**
 * Da de baja un precio sin poner otro: el alcance vuelve a caer en el que le siga por
 * especificidad (la de sala, o la general). No borra: cierra.
 */
async function cerrar(actor: Actor, input: { tarifaId: string }, db: PrismaClient): Promise<ResultadoTarifa> {
  const r = await db.tarifa.updateMany({
    where: { id: input.tarifaId, operadorId: actor.operadorId, vigenteHasta: null },
    data: { vigenteHasta: new Date() },
  });
  return r.count === 1 ? { ok: true, id: input.tarifaId } : { ok: false, error: "NO_ENCONTRADA" };
}

export const ponerTarifa = definirAccion({ permiso: "tarifa.administrar", schema: TarifaInput }, (a, i) => poner(a, i, prisma));
export const cerrarTarifa = definirAccion(
  { permiso: "tarifa.administrar", schema: z.object({ tarifaId: z.string().min(1) }) },
  (a, i) => cerrar(a, i, prisma),
);

/** Versiones inyectables, para los tests. */
export const tarifasCon = (db: PrismaClient) => ({
  poner: definirAccion({ permiso: "tarifa.administrar", schema: TarifaInput }, (a, i) => poner(a, i, db)),
  cerrar: definirAccion({ permiso: "tarifa.administrar", schema: z.object({ tarifaId: z.string().min(1) }) }, (a, i) => cerrar(a, i, db)),
});

/** Las tarifas vigentes del operador, ordenadas de la más específica a la general. */
export async function tarifasVigentes(operadorId: string, db: PrismaClient = prisma) {
  const filas = await db.tarifa.findMany({
    where: { operadorId, vigenteHasta: null },
    select: { id: true, nombre: true, salaId: true, inquilinoId: true, precioHoraCent: true, vigenteDesde: true, vigenteHasta: true },
    orderBy: [{ inquilinoId: "asc" }, { salaId: "asc" }, { vigenteDesde: "desc" }],
  });
  return filas.sort((a, b) => {
    const esp = (t: { salaId: string | null; inquilinoId: string | null }) => (t.inquilinoId ? 2 : 0) + (t.salaId ? 1 : 0);
    return esp(b) - esp(a) || a.nombre.localeCompare(b.nombre, "es");
  });
}

/**
 * Qué precio le sale HOY a cada (profesional, sala). Misma función que usa el alta de reserva
 * (`resolverTarifa`), no una copia: si el cuadro dice $8.000 la reserva cobra $8.000 (§5.1).
 */
export function cuadroDePrecios(
  tarifas: TarifaVigente[],
  salas: { id: string; nombre: string }[],
  inquilinos: { id: string; nombre: string }[],
  ahora = new Date(),
) {
  return inquilinos.map((i) => ({
    inquilino: i,
    celdas: salas.map((s) => ({
      sala: s,
      tarifa: resolverTarifa(tarifas, { salaId: s.id, inquilinoId: i.id, ahora }),
    })),
  }));
}
