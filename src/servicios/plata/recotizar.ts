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
  /** Cuántas quedaron sin tocar porque se acabó el tiempo. Se sigue apretando el botón. */
  restantes: number;
};

/** Cuántas reservas se resuelven por transacción. Ni una (1421 idas y vueltas a una base remota
 *  no entran en el tiempo de una función) ni todas (una transacción gigante tampoco). */
const LOTE = 50;

/**
 * Cuánto se trabaja antes de devolver el control. Una función de Vercel se corta a los 10 segundos
 * y lo que estaba a mitad de camino se pierde SIN decir nada: la pantalla queda con el botón
 * girando para siempre. Es mejor cortar solo, contar cuánto se hizo y cuánto falta.
 */
const PRESUPUESTO_MS = 7_000;

/** A quién le corresponden las reservas sin precio, y a cuánto saldría ponérselo. Contesta la
 *  pregunta que se hace cualquiera antes de apretar un botón que toca plata: ¿a quiénes afecta? */
export type PendientePorProfesional = {
  inquilinoId: string;
  nombre: string;
  reservas: number;
  minutos: number;
  /** El precio por hora que se les va a aplicar, o null si no hay NINGUNA tarifa para esa persona.
   *  Cero no es null: es alguien que usa el consultorio y no factura, y esa es una decisión
   *  tomada, no un dato que falta. */
  precioHoraCent: bigint | null;
  importeCent: bigint;
};

/** Cuántas reservas están esperando un precio. Para poder ofrecerlo solo cuando hace falta. */
export async function reservasSinPrecio(operadorId: string, db: PrismaClient = prisma): Promise<number> {
  return db.ocupacion.count({
    where: { operadorId, tipo: TipoOcupacion.reserva, estado: { in: VIVOS }, importeCent: null, inquilinoId: { not: null }, inquilino: { facturable: true } },
  });
}

/**
 * El desglose: a quién le corresponden esas reservas y qué precio se le va a aplicar a cada uno.
 *
 * Un botón que dice "hay 1421 reservas sin precio" y las factura de una no da forma de revisar
 * nada antes de apretarlo. Con el desglose se ve que a Mariano le van a entrar sus horas a $7.500
 * y a Patricia a $7.000 —o que a alguno no le va a entrar ninguna porque le falta la tarifa—
 * ANTES de tocar la cuenta corriente de nadie.
 */
export async function pendientesPorProfesional(
  operadorId: string,
  db: PrismaClient = prisma,
): Promise<PendientePorProfesional[]> {
  // `facturable: true` no es un detalle: sin ese filtro, el botón "ponerles el precio vigente" le
  // resolvía la tarifa GENERAL a quien no factura —no tiene tarifa propia, así que hereda la de
  // todos— y le asentaba el cargo. Apretarlo era la forma más rápida de facturarle a alguien a
  // quien se decidió no facturarle. Sus reservas quedan sin precio, que es lo correcto: no es que
  // falte el dato, es que no se le cobra.
  const filas = await db.ocupacion.findMany({
    where: { operadorId, tipo: TipoOcupacion.reserva, estado: { in: VIVOS }, importeCent: null, inquilinoId: { not: null }, inquilino: { facturable: true } },
    select: { salaId: true, inquilinoId: true, inicio: true, fin: true, inquilino: { select: { nombre: true } } },
  });
  if (filas.length === 0) return [];

  const ahora = new Date();
  const tarifas = await db.tarifa.findMany({
    where: { operadorId, vigenteDesde: { lte: ahora }, OR: [{ vigenteHasta: null }, { vigenteHasta: { gt: ahora } }] },
    select: { id: true, salaId: true, inquilinoId: true, precioHoraCent: true, vigenteDesde: true, vigenteHasta: true },
  });

  const porId = new Map<string, PendientePorProfesional>();
  for (const f of filas) {
    const id = f.inquilinoId!;
    const minutos = Math.round((f.fin.getTime() - f.inicio.getTime()) / 60_000);
    // El precio se resuelve con la MISMA función que usa el botón: si acá dijera una cosa y el
    // botón hiciera otra, el desglose sería peor que no tenerlo.
    const cot = cotizar(resolverTarifa(tarifas, { salaId: f.salaId ?? "", inquilinoId: id, ahora }), minutos);

    const acc = porId.get(id) ?? {
      inquilinoId: id,
      nombre: f.inquilino?.nombre ?? "—",
      reservas: 0,
      minutos: 0,
      precioHoraCent: null as bigint | null,
      importeCent: 0n,
    };
    acc.reservas++;
    acc.minutos += minutos;
    acc.importeCent += cot.importeCent;
    // Se guarda el precio por hora que se vio. La condición mira si HAY TARIFA, no si el precio es
    // mayor que cero: con `> 0n` el que no factura quedaba indistinguible del que no tiene tarifa
    // cargada, y son dos situaciones opuestas — una está resuelta y la otra hay que arreglarla.
    // Si una persona tuviera dos precios (por sala), queda el primero; el importe de la fila sigue
    // siendo la suma exacta, que es el número que importa.
    if (acc.precioHoraCent === null && cot.tarifaId !== null) acc.precioHoraCent = cot.precioHoraCent;
    porId.set(id, acc);
  }

  return [...porId.values()].sort((a, b) => b.reservas - a.reservas);
}

async function recotizar(actor: Actor, _input: unknown, db: PrismaClient): Promise<ResultadoRecotizar> {
  const op = actor.operadorId;

  const pendientes = await db.ocupacion.findMany({
    where: { operadorId: op, tipo: TipoOcupacion.reserva, estado: { in: VIVOS }, importeCent: null, inquilinoId: { not: null }, inquilino: { facturable: true } },
    select: { id: true, salaId: true, inquilinoId: true, inicio: true, fin: true, tzSede: true },
    orderBy: { inicio: "asc" },
  });
  if (pendientes.length === 0) return { ok: true, cotizadas: 0, sinTarifa: 0, totalCent: 0n, restantes: 0 };

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
  let procesadas = 0;
  const arranque = Date.now();

  // Primero se decide el precio de TODAS (es cálculo puro, no toca la base) y se separan las que
  // no tienen tarifa. Así el trabajo contra la base es solo escribir.
  const conPrecio: { o: (typeof pendientes)[number]; cot: ReturnType<typeof cotizar> }[] = [];
  for (const o of pendientes) {
    // El precio que se aplica es el VIGENTE HOY, no el que había cuando se creó: cuando se creó no
    // había ninguno, que es justamente el motivo por el que está en esta lista. Y se resuelve POR
    // PROFESIONAL: la tarifa a nombre de una persona le gana a la general (§ especificidad), así
    // que cada uno entra con su propio valor hora.
    const tarifa = resolverTarifa(tarifas, { salaId: o.salaId ?? "", inquilinoId: o.inquilinoId!, ahora });
    const minutos = Math.round((o.fin.getTime() - o.inicio.getTime()) / 60_000);
    const cot = cotizar(tarifa, minutos);
    // SIN TARIFA y TARIFA DE CERO son cosas distintas, y confundirlas costaba caro: alguien que
    // usa el consultorio pero no factura (un socio del centro) tiene precio CERO, y su reserva
    // tiene que quedar estampada en $0. Tratándolo como "sin tarifa" quedaba en null para siempre,
    // reapareciendo en el cartel de "reservas sin precio" en cada vuelta, sin forma de sacarlo.
    if (!tarifa) {
      sinTarifa++;
      continue;
    }
    conPrecio.push({ o, cot });
  }

  // De a LOTE por transacción, y no una por reserva. Con 1421 pendientes, una transacción por
  // fila son 1421 idas y vueltas a una base remota: no entra en el tiempo de una función y la
  // pantalla se queda con el botón girando hasta que el servidor corta sin decir nada.
  //
  // Si se corta igual, lo hecho queda hecho: volver a apretar sigue donde quedó. El asiento es
  // idempotente por reserva, así que nada se cobra dos veces.
  for (let i = 0; i < conPrecio.length; i += LOTE) {
    // El presupuesto se mira ANTES de empezar un lote, no en el medio: cortar una transacción por
    // la mitad no ahorra tiempo, solo pierde el trabajo.
    if (Date.now() - arranque > PRESUPUESTO_MS) break;

    const lote = conPrecio.slice(i, i + LOTE);
    const hechas = await db.$transaction(async (tx) => {
      const aplicadas: bigint[] = [];
      for (const { o, cot } of lote) {
        // El WHERE repite `importeCent: null`: entre la lectura de arriba y esta escritura pudo
        // haber pasado cualquier cosa, y pisar un importe ya puesto sería reescribir lo facturado.
        const r = await tx.ocupacion.updateMany({
          where: { id: o.id, operadorId: op, importeCent: null },
          data: { tarifaId: cot.tarifaId, precioHoraCent: cot.precioHoraCent, importeCent: cot.importeCent },
        });
        if (r.count === 0) continue;
        // La reserva YA quedó con precio, aunque ese precio sea cero: cuenta como hecha, si no
        // volvería a salir en el cartel de pendientes en la próxima vuelta.
        aplicadas.push(cot.importeCent);

        // Pero un cargo de $0 no se asienta: es el mismo criterio que usa el alta de una reserva.
        // Un movimiento de cero en la cuenta corriente no dice nada y ensucia el resumen.
        if (cot.importeCent === 0n) continue;

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
      }
      return aplicadas;
    });

    // Los contadores se suman AFUERA de la transacción: si Prisma la reintenta, el callback corre
    // de nuevo y lo que se hubiera sumado adentro quedaría contado dos veces.
    cotizadas += hechas.length;
    for (const c of hechas) totalCent += c;
    procesadas += lote.length;
  }

  return { ok: true, cotizadas, sinTarifa, totalCent, restantes: conPrecio.length - procesadas };
}

export const recotizarPendientes = definirAccion(
  { permiso: "tarifa.administrar", schema: z.object({}) },
  (a, i) => recotizar(a, i, prisma),
);

/** Versión inyectable, para los tests. */
export const recotizarCon = (db: PrismaClient) =>
  definirAccion({ permiso: "tarifa.administrar", schema: z.object({}), db }, (a, i) => recotizar(a, i, db));
