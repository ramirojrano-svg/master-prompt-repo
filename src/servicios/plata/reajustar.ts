// src/servicios/plata/reajustar.ts — aplicar un precio nuevo a lo que todavía no se cobró.
//
// Una reserva ESTAMPA su precio al nacer (§8.8), y esa regla existe por una buena razón: cambiar
// un importe ya facturado sería reescribir el pasado. Pero la regla estaba de más en un caso que
// pasa todos los meses: subir el alquiler.
//
// Lo que pasaba: las reservas de septiembre se cargan en agosto, así que nacen con el precio de
// agosto. Se sube el precio hoy y septiembre —que todavía no ocurrió y no se le facturó a nadie—
// se seguía cobrando al precio viejo. Un aumento no tenía forma de entrar en vigencia salvo
// borrando y recargando las reservas a mano.
//
// La distinción no es "vieja o nueva" sino ESTA: ¿ya salió del centro?
//
//  · Una hora YA USADA no se toca. Ocurrió a un precio y ese precio es el que fue.
//  · Una hora ya LIQUIDADA no se toca, aunque sea futura. Hay un papel numerado con ese número
//    adentro, y el profesional lo tiene.
//  · Una hora futura y sin liquidar SÍ se reajusta. No ocurrió, no se facturó, y el precio que le
//    corresponde es el que rige para cuando se va a usar.
//
// El asiento se actualiza junto con la reserva, en la misma transacción. Cambiar una sin la otra
// dejaría la agenda diciendo un precio y la cuenta corriente cobrando otro, que es peor que el
// problema original.

import { EstadoOcupacion, type PrismaClient, TipoOcupacion } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db/prisma.ts";
import { definirAccion } from "../../lib/accion.ts";
import { cotizar, resolverTarifa } from "../../dominio/tarifa.ts";
import type { Actor } from "../../lib/actor.ts";

/** Los estados que todavía se pueden reajustar. Lo cancelado no se cobra. */
const VIVOS: EstadoOcupacion[] = [EstadoOcupacion.confirmada];

export type FilaReajuste = {
  ocupacionId: string;
  inquilinoId: string;
  nombre: string;
  inicio: Date;
  minutos: number;
  deCent: bigint;
  aCent: bigint;
};

/**
 * Qué cambiaría si se aplicara el precio de hoy. Se calcula ANTES de tocar nada: un botón que
 * mueve plata tiene que poder decir cuánta antes de que lo aprieten.
 */
export async function reservasADesajustar(
  a: { operadorId: string; inquilinoId?: string },
  db: PrismaClient = prisma,
  ahora: Date = new Date(),
): Promise<FilaReajuste[]> {
  const [ocupaciones, tarifas, fichas] = await Promise.all([
    db.ocupacion.findMany({
      where: {
        operadorId: a.operadorId,
        tipo: TipoOcupacion.reserva,
        estado: { in: VIVOS },
        inicio: { gt: ahora }, // solo lo que todavía no pasó
        ...(a.inquilinoId ? { inquilinoId: a.inquilinoId } : {}),
      },
      select: { id: true, salaId: true, inquilinoId: true, inicio: true, fin: true, precioHoraCent: true },
      orderBy: { inicio: "asc" },
    }),
    db.tarifa.findMany({
      where: { operadorId: a.operadorId, vigenteHasta: null },
      select: { id: true, salaId: true, inquilinoId: true, precioHoraCent: true, vigenteDesde: true, vigenteHasta: true },
    }),
    db.inquilino.findMany({ where: { operadorId: a.operadorId }, select: { id: true, nombre: true } }),
  ]);
  const nombreDe = new Map(fichas.map((f) => [f.id, f.nombre]));

  // Las que ya entraron en una liquidación quedan afuera: ese papel ya se emitió.
  const claves = ocupaciones.map((o) => `cargo_uso:${o.id}`);
  const asientos = claves.length
    ? await db.asiento.findMany({
        where: { operadorId: a.operadorId, clave: { in: claves } },
        select: { clave: true, liquidacionId: true },
      })
    : [];
  const liquidada = new Set(asientos.filter((x) => x.liquidacionId !== null).map((x) => x.clave));

  const filas: FilaReajuste[] = [];
  for (const o of ocupaciones) {
    if (!o.inquilinoId || liquidada.has(`cargo_uso:${o.id}`)) continue;
    const minutos = Math.round((o.fin.getTime() - o.inicio.getTime()) / 60_000);
    // El precio que rige para CUANDO se va a usar la hora, no para hoy.
    const t = resolverTarifa(tarifas, { salaId: o.salaId ?? "", inquilinoId: o.inquilinoId, ahora: o.inicio });
    const cot = cotizar(t, minutos);
    if (!t || cot.precioHoraCent === (o.precioHoraCent ?? -1n)) continue; // ya está al día
    filas.push({
      ocupacionId: o.id,
      inquilinoId: o.inquilinoId,
      nombre: nombreDe.get(o.inquilinoId) ?? "—",
      inicio: o.inicio,
      minutos,
      deCent: o.precioHoraCent ?? 0n,
      aCent: cot.precioHoraCent,
    });
  }
  return filas;
}

export const ReajustarInput = z.object({
  /** Sin id, reajusta a todos. Con id, solo a ese profesional. */
  inquilinoId: z.string().min(1).optional(),
});

export type ResultadoReajuste = { ok: true; reajustadas: number; difCent: bigint };

/**
 * Aplica el precio vigente, sin envoltorio de permiso.
 *
 * Se exporta cruda para que guardar una tarifa pueda aplicarla en el mismo paso: el permiso que
 * pide guardar un precio (`tarifa.administrar`) es EL MISMO que pide reajustar, así que volver a
 * verificarlo no agrega ningún control, y encadenar dos acciones dejaría dos entradas separadas en
 * el registro de actividad para lo que el operador vivió como un solo acto.
 */
export async function aplicarPrecioVigente(
  actor: Actor,
  input: z.infer<typeof ReajustarInput>,
  db: PrismaClient,
  ahora: Date = new Date(),
): Promise<ResultadoReajuste> {
  const filas = await reservasADesajustar({ operadorId: actor.operadorId, inquilinoId: input.inquilinoId }, db, ahora);
  let reajustadas = 0;
  let difCent = 0n;

  for (const f of filas) {
    const importe = (f.aCent * BigInt(f.minutos)) / 60n;
    const anterior = (f.deCent * BigInt(f.minutos)) / 60n;
    // Reserva y asiento juntos: si se actualizara una sin la otra, la agenda diría un precio y la
    // cuenta corriente cobraría otro.
    await db.$transaction(async (tx) => {
      await tx.ocupacion.updateMany({
        where: { id: f.ocupacionId, operadorId: actor.operadorId },
        data: { precioHoraCent: f.aCent, importeCent: importe },
      });
      await tx.asiento.updateMany({
        // `liquidacionId: null` otra vez acá y no solo en la lectura: entre que se listó y se
        // escribe, alguien pudo cerrar el mes. Es la condición que impide pisar un papel emitido.
        where: { operadorId: actor.operadorId, clave: `cargo_uso:${f.ocupacionId}`, liquidacionId: null },
        data: { montoCent: importe },
      });
    });
    reajustadas++;
    difCent += importe - anterior;
  }
  return { ok: true, reajustadas, difCent };
}

const CFG_REAJUSTE = {
  permiso: "tarifa.administrar",
  schema: ReajustarInput,
  resumen: (i: z.infer<typeof ReajustarInput>) => `reajuste de reservas futuras${i.inquilinoId ? ` de ${i.inquilinoId}` : " (todos)"}`,
} as const;

export const reajustarFuturas = definirAccion(CFG_REAJUSTE, (a, i) => aplicarPrecioVigente(a, i, prisma));

export const reajustarCon = (db: PrismaClient) =>
  definirAccion({ ...CFG_REAJUSTE, db }, (a, i) => aplicarPrecioVigente(a, i, db));
