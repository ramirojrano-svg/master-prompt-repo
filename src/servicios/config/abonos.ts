// src/servicios/config/abonos.ts — el abono MENSUAL de los que no alquilan por hora (§4.12).
//
// Hay profesionales que no usan consultorio: pagan un fijo todos los meses. Para el motor eso ya
// existe y se llama MEMBRESÍA con `minutosIncluidos: 0` — un plan mensual sin horas incluidas es
// exactamente "abona un fijo y no alquila". No se inventa una tabla nueva para lo mismo.
//
// El cobro de cada mes NO se postea solo: lo dispara el operador desde la pantalla de precios.
// Es a propósito — una app que factura sola en segundo plano genera deuda que nadie miró, y el
// día que el importe está mal ya se le mandó el resumen a treinta personas. La clave del asiento
// es `cargo_membresia:<membresiaId>:<periodo>`, así que apretar el botón dos veces en el mismo
// mes no cobra dos veces.

import { z } from "zod";
import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { definirAccion } from "../../lib/accion.ts";
import { cobrarMembresia } from "../plata/membresias.ts";
import { esPeriodoValido } from "../../dominio/reporte.ts";
import { aCentavos } from "./tarifas.ts";

export const AbonoInput = z.object({
  inquilinoId: z.string().min(1),
  /** En PESOS, como lo escribe el operador. 0 = darlo de baja (vuelve a no tener abono). */
  montoMensual: z.coerce.number().min(0).max(100_000_000),
});

export type ResultadoAbono = { ok: true } | { ok: false; error: "INQUILINO_INEXISTENTE" };

/**
 * Fija (o cambia, o da de baja) el abono de un profesional. Igual que con el precio por hora, un
 * abono no se edita en su lugar: se cierra el vigente y nace otro. Así el mes que ya se cobró
 * sigue diciendo lo que se cobró, aunque hoy el abono sea otro.
 */
async function ponerAbono(
  actor: { operadorId: string },
  input: z.infer<typeof AbonoInput>,
  db: PrismaClient = prisma,
): Promise<ResultadoAbono> {
  const inq = await db.inquilino.findFirst({ where: { id: input.inquilinoId, operadorId: actor.operadorId }, select: { id: true } });
  if (!inq) return { ok: false, error: "INQUILINO_INEXISTENTE" };

  const ahora = new Date();
  return db.$transaction(async (tx) => {
    // Cierra el vigente (si había). `vigenteHasta` es fecha, no booleano: null o pasado = no
    // vigente (§9 regla 11).
    await tx.membresia.updateMany({
      where: { operadorId: actor.operadorId, inquilinoId: inq.id, OR: [{ vigenteHasta: null }, { vigenteHasta: { gt: ahora } }] },
      data: { vigenteHasta: ahora, estado: "baja" },
    });

    if (input.montoMensual > 0) {
      await tx.membresia.create({
        data: {
          operadorId: actor.operadorId,
          inquilinoId: inq.id,
          nombre: "Abono mensual",
          precioMensualCent: aCentavos(input.montoMensual),
          minutosIncluidos: 0, // no alquila horas: el abono no incluye ninguna
          vigenteDesde: ahora,
          // Diez años: el abono no vence solo, se da de baja poniéndolo en cero.
          vigenteHasta: new Date(ahora.getTime() + 3650 * 86_400_000),
        },
      });
    }
    return { ok: true as const };
  });
}

export const ponerAbonoMensual = definirAccion({ permiso: "tarifa.administrar", schema: AbonoInput }, (a, i) => ponerAbono(a, i));

export const PeriodoInput = z.object({ periodo: z.string().refine(esPeriodoValido, "periodo inválido") });

export type ResultadoCobro = { ok: true; cobrados: number; yaEstaban: number; totalCent: bigint };

/**
 * Postea el cargo del mes a TODOS los que tienen abono vigente. Idempotente por período: los que
 * ya estaban cobrados se cuentan aparte en vez de duplicarse, así el operador puede apretar sin
 * miedo a cobrar dos veces.
 */
async function cobrarDelMes(
  actor: { operadorId: string },
  input: z.infer<typeof PeriodoInput>,
  db: PrismaClient = prisma,
): Promise<ResultadoCobro> {
  const ahora = new Date();
  const vigentes = await db.membresia.findMany({
    where: { operadorId: actor.operadorId, vigenteDesde: { lte: ahora }, OR: [{ vigenteHasta: null }, { vigenteHasta: { gt: ahora } }] },
    select: { id: true, inquilinoId: true, precioMensualCent: true },
  });
  const operador = await db.operador.findUniqueOrThrow({ where: { id: actor.operadorId }, select: { moneda: true } });

  // El hecho económico se fecha el día 1 del período cobrado, no "hoy": si el operador cobra
  // agosto en septiembre, el cargo pertenece a agosto igual (§5.1).
  const fechaHecho = new Date(`${input.periodo}-01T12:00:00.000Z`);

  let cobrados = 0;
  let yaEstaban = 0;
  let total = 0n;
  for (const m of vigentes) {
    const r = await cobrarMembresia(db, {
      operadorId: actor.operadorId,
      inquilinoId: m.inquilinoId,
      membresiaId: m.id,
      periodo: input.periodo,
      montoCent: m.precioMensualCent,
      moneda: operador.moneda,
      fechaHecho,
    });
    if (r.creado) {
      cobrados++;
      total += m.precioMensualCent;
    } else {
      yaEstaban++;
    }
  }
  return { ok: true, cobrados, yaEstaban, totalCent: total };
}

export const cobrarAbonosDelMes = definirAccion({ permiso: "tarifa.administrar", schema: PeriodoInput }, (a, i) => cobrarDelMes(a, i));

/** Versiones inyectables, para los tests: sin esto la acción escribe por el cliente global. */
export const abonosCon = (db: PrismaClient) => ({
  poner: definirAccion({ permiso: "tarifa.administrar", schema: AbonoInput, db }, (a, i) => ponerAbono(a, i, db)),
  cobrar: definirAccion({ permiso: "tarifa.administrar", schema: PeriodoInput, db }, (a, i) => cobrarDelMes(a, i, db)),
});

/** Los abonos vigentes, para la pantalla. */
export async function abonosVigentes(operadorId: string, db: PrismaClient = prisma) {
  const ahora = new Date();
  return db.membresia.findMany({
    where: { operadorId, vigenteDesde: { lte: ahora }, OR: [{ vigenteHasta: null }, { vigenteHasta: { gt: ahora } }] },
    select: { id: true, precioMensualCent: true, inquilino: { select: { id: true, nombre: true, pagador: true } } },
    orderBy: { inquilino: { nombre: "asc" } },
  });
}
