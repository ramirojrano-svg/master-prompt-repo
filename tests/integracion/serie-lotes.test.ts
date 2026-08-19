// tests/integracion/serie-lotes.test.ts — cuántas idas y vueltas a la base cuesta una serie.
//
// Este archivo existe por un bug que NINGÚN test funcional podía encontrar: crear una serie
// semanal de un año hacía 347 consultas dentro de una sola transacción. Con la base al lado
// —como en estos tests— eso tarda 400 ms y pasa. Contra una base remota, a 25 ms por consulta,
// son NUEVE SEGUNDOS: se pasa del límite de 5 s de una transacción de Prisma, la transacción
// aborta y la pantalla se cae. Andaba en desarrollo y se rompía en producción, que es la peor
// forma de romperse.
//
// Por eso lo que se afirma acá no es un resultado sino un COSTO: el trabajo contra la base no
// puede crecer con el largo de la serie. Si alguien vuelve a meter una consulta adentro del bucle,
// este test lo dice antes de que llegue a producción.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { expandirSerie } from "../../src/servicios/reservas/expandir-serie.ts";
import type { CtxReserva } from "../../src/servicios/reservas/crear.ts";
import { prisma } from "../../src/db/prisma.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB, log: [{ emit: "event", level: "query" }] });

let consultas = 0;
db.$on("query" as never, () => {
  consultas++;
});

const ABIERTO = [{ desde: "06:00", hasta: "23:00" }];
const ctx: CtxReserva = {
  operadorId: "op1",
  inquilinoId: "in1",
  horario: { 0: ABIERTO, 1: ABIERTO, 2: ABIERTO, 3: ABIERTO, 4: ABIERTO, 5: ABIERTO, 6: ABIERTO },
  politica: { pasoMin: 30, duracionMinMin: 15, duracionMaxMin: 720, bufferMin: 0, bufferMismoInquilino: 0, antelacionMinMin: 0, horizonteDias: 400 },
  bloqueaProfesional: true,
};

/** Cuántas consultas cuesta una serie de N ocurrencias, y cuántas se crearon. */
async function serieDe(cantidad: number, hora: string) {
  consultas = 0;
  const r = await expandirSerie(
    { salaId: "sa1", hora, duracionMin: 60, fechaInicio: "2027-06-02", repeticion: "semanal", cantidad, modo: "parcial" },
    ctx,
    db,
  );
  return { consultas, creadas: r.ok ? r.creadas.length : -1 };
}

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
  const H = JSON.stringify({ "0": ABIERTO, "1": ABIERTO, "2": ABIERTO, "3": ABIERTO, "4": ABIERTO, "5": ABIERTO, "6": ABIERTO });
  await pgPool.query(`UPDATE "Sala" SET "horarioJson"=$1::jsonb`, [H]);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Ocupacion", "Asiento", "Tarifa" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

test("EL COSTO NO CRECE CON LA SERIE: 57 miércoles cuestan casi lo mismo que 4", async () => {
  const corta = await serieDe(4, "07:00");
  await pgPool.query('TRUNCATE "Ocupacion", "Asiento" CASCADE');
  const larga = await serieDe(57, "07:00");

  assert.equal(corta.creadas, 4);
  assert.equal(larga.creadas, 57);

  // El número exacto no importa y no se clava: lo que se fija es que la de un año no cueste
  // proporcionalmente más que la de un mes. Antes eran 6 consultas por ocurrencia; con 57 eso
  // daba 347 y la transacción se pasaba de tiempo contra una base remota.
  assert.ok(
    larga.consultas <= corta.consultas + 4,
    `una serie de 57 no puede costar mucho más que una de 4: ${corta.consultas} → ${larga.consultas} consultas`,
  );
  assert.ok(larga.consultas < 25, `57 ocurrencias en ${larga.consultas} consultas: se volvió a meter una consulta en el bucle`);
});

test("con precio cargado, los cargos se asientan igual: uno por ocurrencia, ni uno más", async () => {
  await pgPool.query(
    `INSERT INTO "Tarifa"("id","operadorId","salaId","inquilinoId","nombre","precioHoraCent","vigenteDesde")
     VALUES('t1','op1',NULL,NULL,'General',800000, now() - interval '1 day')`,
  );

  const r = await serieDe(30, "08:00");
  assert.equal(r.creadas, 30);

  const asientos = await db.asiento.count({ where: { operadorId: "op1", concepto: "cargo_uso" } });
  assert.equal(asientos, 30, "un cargo por turno");

  const total = await db.asiento.aggregate({ where: { operadorId: "op1", concepto: "cargo_uso" }, _sum: { montoCent: true } });
  assert.equal(total._sum.montoCent, 30n * 800_000n, "30 horas a $8.000");

  // Y el precio quedó ESTAMPADO en cada fila, no solo en el libro.
  const sinPrecio = await db.ocupacion.count({ where: { operadorId: "op1", importeCent: null } });
  assert.equal(sinPrecio, 0);
});

test("las ocurrencias de la MISMA serie se ven entre sí: una que se pisaría no entra dos veces", async () => {
  // Diaria de 12 h arrancando a las 18:00: la de un día termina a las 06:00 del siguiente, así que
  // choca con la siguiente del profesional. Antes eso lo cazaba la consulta por ocurrencia, que
  // corría después del create anterior; ahora la foto es una sola y las propias se suman en memoria.
  const r = await expandirSerie(
    { salaId: "sa1", hora: "18:00", duracionMin: 720, fechaInicio: "2027-06-02", repeticion: "diaria", cantidad: 5, modo: "parcial" },
    { ...ctx, horario: { 0: [{ desde: "00:00", hasta: "23:59" }], 1: [{ desde: "00:00", hasta: "23:59" }], 2: [{ desde: "00:00", hasta: "23:59" }], 3: [{ desde: "00:00", hasta: "23:59" }], 4: [{ desde: "00:00", hasta: "23:59" }], 5: [{ desde: "00:00", hasta: "23:59" }], 6: [{ desde: "00:00", hasta: "23:59" }] } },
    db,
  );
  assert.ok(r.ok);
  if (!r.ok) return;

  // Ninguna reserva creada puede solaparse con otra: es la invariante que protege el constraint,
  // y si el chequeo en memoria estuviera mal la base lo rechazaría con un error, no con conflictos.
  const filas = await db.ocupacion.findMany({ where: { operadorId: "op1" }, select: { inicio: true, fin: true }, orderBy: { inicio: "asc" } });
  for (let i = 1; i < filas.length; i++) {
    assert.ok(filas[i]!.inicio >= filas[i - 1]!.fin, "dos turnos de la misma serie no pueden pisarse");
  }
});
