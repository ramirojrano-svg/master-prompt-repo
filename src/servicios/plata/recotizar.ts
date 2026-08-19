// src/servicios/plata/recotizar.ts — ponerle precio a las reservas que nacieron sin tarifa.
//
// Una reserva ESTAMPA su precio al nacer (§8.8). Si en ese momento no había ninguna tarifa
// cargada, se estampa NULL — que a propósito no es cero: "todavía no había precio" y "esta hora
// salió $0" son cosas distintas. El problema es que después nadie vuelve a mirarlas: quedan en la
// agenda ocupando la sala, en "Mis reservas" con un guioncito en la columna Importe, y a fin de
// mes no aparecen en ninguna suma. Son horas usadas que no se cobran nunca.
//
// Pasa siempre igual: se carga la agenda antes que los precios, que es el orden natural (primero
// hay que ver si la app sirve, después se configura la plata).
//
// Esto NO recotiza nada que ya tenga precio. Cambiar un importe estampado sería reescribir lo que
// se facturó, que es exactamente lo que §8.8 existe para impedir. Solo toca las que están en NULL:
// no hay nada que pisar, solo un hueco que llenar.

import { EstadoOcupacion, type PrismaClient, TipoOcupacion } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { definirAccion } from "../../lib/accion.ts";
import { cotizar, resolverTarifa } from "../../dominio/tarifa.ts";
import { periodoDeInstante } from "../../dominio/motor/zona.ts";
import { asentarIdempotente } from "./ledger.ts";
import { z } from "zod";
import type { Actor } from "../../lib/actor.ts";

/** Los estados que "cuentan": lo cancelado no se cobra, así que tampoco se le pone precio. */
const VIVOS: EstadoOcupacion[] = [EstadoOcupacion.confirmada, EstadoOcupacion.en_curso, EstadoOcupacion.usada, EstadoOcupacion.no_show];

export type ResultadoRecotizar = {
  ok: true;
  /** Cuántas quedaron con precio. */
  cotizadas: number;
  /** Cuántas siguen sin precio porque tampoco hay tarifa que les aplique. */
  sinTarifa: number;
  totalCent: bigint;
};

/** Cuántas reservas están esperando un precio. Para poder ofrecerlo solo cuando hace falta. */
export async function reservasSinPrecio(operadorId: string, db: PrismaClient = prisma): Promise<number> {
  return db.ocupacion.count({
    where: { operadorId, tipo: TipoOcupacion.reserva, estado: { in: VIVOS }, importeCent: null, inquilinoId: { not: null } },
  });
}

async function recotizar(actor: Actor, _input: unknown, db: PrismaClient): Promise<ResultadoRecotizar> {
  const op = actor.operadorId;

  const pendientes = await db.ocupacion.findMany({
    where: { operadorId: op, tipo: TipoOcupacion.reserva, estado: { in: VIVOS }, importeCent: null, inquilinoId: { not: null } },
    select: { id: true, salaId: true, inquilinoId: true, inicio: true, fin: true, tzSede: true },
    orderBy: { inicio: "asc" },
  });
  if (pendientes.length === 0) return { ok: true, cotizadas: 0, sinTarifa: 0, totalCent: 0n };

  const ahora = new Date();
  const [operador, tarifas] = await Promise.all([
    db.operador.findUniqueOrThrow({ where: { id: op }, select: { moneda: true } }),
    db.tarifa.findMany({
      where: { operadorId: op, vigenteDesde: { lte: ahora }, OR: [{ vigenteHasta: null }, { vigenteHasta: { gt: ahora } }] },
      select: { id: true, salaId: true, inquilinoId: true, precioHoraCent: true, vigenteDesde: true, vigenteHasta: true },
    }),
  ]);

  let cotizadas = 0;
  let sinTarifa = 0;
  let totalCent = 0n;

  for (const o of pendientes) {
    // El precio que se aplica es el VIGENTE HOY, no el que había cuando se creó: cuando se creó no
    // había ninguno, que es justamente el motivo por el que está en esta lista.
    const tarifa = resolverTarifa(tarifas, { salaId: o.salaId ?? "", inquilinoId: o.inquilinoId!, ahora });
    if (!tarifa) {
      sinTarifa++;
      continue;
    }
    const minutos = Math.round((o.fin.getTime() - o.inicio.getTime()) / 60_000);
    const cot = cotizar(tarifa, minutos);
    if (cot.importeCent <= 0n) {
      sinTarifa++;
      continue;
    }

    // Una transacción POR RESERVA y no una sola para todas: son cientos de filas y un lote entero
    // en una transacción contra una base remota se pasa del tiempo límite y no se guarda ninguna.
    // Si se corta a la mitad, lo hecho queda hecho y volver a correrlo termina el resto — el
    // asiento es idempotente por reserva, así que nada se cobra dos veces.
    await db.$transaction(async (tx) => {
      // El WHERE repite `importeCent: null`: entre la lectura de arriba y esta escritura pudo
      // haber pasado cualquier cosa, y pisar un importe ya puesto sería reescribir lo facturado.
      const r = await tx.ocupacion.updateMany({
        where: { id: o.id, operadorId: op, importeCent: null },
        data: { tarifaId: cot.tarifaId, precioHoraCent: cot.precioHoraCent, importeCent: cot.importeCent },
      });
      if (r.count === 0) return;

      await asentarIdempotente(tx, {
        operadorId: op,
        inquilinoId: o.inquilinoId!,
        concepto: "cargo_uso",
        montoCent: cot.importeCent,
        moneda: operador.moneda,
        periodo: periodoDeInstante(o.inicio, o.tzSede),
        fechaHecho: o.inicio,
        // La MISMA clave que usa el alta: si por lo que sea la reserva ya tenía su asiento, este
        // no entra. La cuenta corriente no se puede cargar dos veces por la misma hora.
        clave: `cargo_uso:${o.id}`,
        reservaId: o.id,
      });
      cotizadas++;
      totalCent += cot.importeCent;
    });
  }

  return { ok: true, cotizadas, sinTarifa, totalCent };
}

export const recotizarPendientes = definirAccion(
  { permiso: "tarifa.administrar", schema: z.object({}) },
  (a, i) => recotizar(a, i, prisma),
);

/** Versión inyectable, para los tests. */
export const recotizarCon = (db: PrismaClient) =>
  definirAccion({ permiso: "tarifa.administrar", schema: z.object({}) }, (a, i) => recotizar(a, i, db));
