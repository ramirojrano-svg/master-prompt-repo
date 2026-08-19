// tests/integracion/recotizar.test.ts — ponerle precio a las reservas que nacieron sin tarifa.
//
// El caso real: 1421 reservas cargadas antes de configurar los precios. Ocupan la agenda, se ven
// normales, y no aparecen en ninguna suma. Este archivo fija las dos cosas que hacen que el botón
// sirva o sea peligroso:
//
//  · Que cada profesional entre con SU valor hora, no con uno general para todos.
//  · Que con muchas reservas el trabajo se haga igual: una transacción por fila son cientos de
//    idas y vueltas a una base remota, no entra en el tiempo de una función y se corta sin decir
//    nada. Se hace por tandas, y lo hecho queda hecho.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { pendientesPorProfesional, recotizarCon, reservasSinPrecio } from "../../src/servicios/plata/recotizar.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { insertarOcupacion, nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: `${URL_DB}?connection_limit=15` });
const recotizar = recotizarCon(db);

const owner: Actor = { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null };
const profesional: Actor = { usuarioId: "u2", operadorId: "op1", rol: "inquilino_titular", inquilinoId: "in1" };

/** in1 hace de Mariano y in2 de Patricia: los dos del seed base. */
async function tarifa(id: string, inquilinoId: string | null, precioHoraCent: number) {
  await pgPool.query(
    `INSERT INTO "Tarifa"("id","operadorId","salaId","inquilinoId","nombre","precioHoraCent","vigenteDesde")
     VALUES($1,'op1',NULL,$2,$3,$4, now() - interval '1 day')`,
    [id, inquilinoId, id, precioHoraCent],
  );
}

/** Una reserva SIN precio, como las que quedaron de antes de configurar la plata. */
async function reservaSinPrecio(id: string, inquilinoId: string, dia: number, horas: number) {
  const d = String(dia).padStart(2, "0");
  await insertarOcupacion(pgPool, {
    id,
    salaId: "sa1",
    inquilinoId,
    inicio: `2026-03-${d}T12:00:00Z`,
    fin: `2026-03-${d}T${String(12 + horas).padStart(2, "0")}:00:00Z`,
  });
}

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Ocupacion", "Asiento", "Tarifa" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

test("cada profesional entra con SU valor hora, no con el general", async () => {
  await tarifa("tGeneral", null, 800_000); // $8.000 general
  await tarifa("tMariano", "in1", 750_000); // $7.500 el suyo
  await tarifa("tPatricia", "in2", 700_000); // $7.000 el suyo

  await reservaSinPrecio("r1", "in1", 2, 4); // Mariano, 4 h
  await reservaSinPrecio("r2", "in2", 3, 5); // Patricia, 5 h

  const r = await recotizar(owner, {});
  assert.ok(r.ok);
  assert.equal(r.data.cotizadas, 2);
  assert.equal(r.data.restantes, 0);

  const mariano = await db.ocupacion.findUniqueOrThrow({ where: { id: "r1" }, select: { importeCent: true, precioHoraCent: true } });
  const patricia = await db.ocupacion.findUniqueOrThrow({ where: { id: "r2" }, select: { importeCent: true, precioHoraCent: true } });

  assert.equal(mariano.precioHoraCent, 750_000n, "la tarifa propia le gana a la general");
  assert.equal(mariano.importeCent, 3_000_000n, "4 h × $7.500 = $30.000");
  assert.equal(patricia.precioHoraCent, 700_000n);
  assert.equal(patricia.importeCent, 3_500_000n, "5 h × $7.000 = $35.000");
  assert.equal(r.data.totalCent, 6_500_000n);
});

test("el desglose dice a quiénes corresponden ANTES de apretar, con el mismo precio que se va a aplicar", async () => {
  await tarifa("tMariano", "in1", 750_000);
  await tarifa("tPatricia", "in2", 700_000);
  await reservaSinPrecio("r1", "in1", 2, 4);
  await reservaSinPrecio("r2", "in1", 3, 2);
  await reservaSinPrecio("r3", "in2", 4, 5);

  const desglose = await pendientesPorProfesional("op1", db);
  assert.equal(desglose.length, 2);

  // Ordenado por cantidad: Mariano tiene 2, Patricia 1.
  assert.equal(desglose[0]!.reservas, 2);
  assert.equal(desglose[0]!.precioHoraCent, 750_000n);
  assert.equal(desglose[0]!.minutos, 6 * 60);
  assert.equal(desglose[0]!.importeCent, 4_500_000n, "6 h × $7.500");

  assert.equal(desglose[1]!.reservas, 1);
  assert.equal(desglose[1]!.precioHoraCent, 700_000n);

  // Y lo que anuncia es EXACTAMENTE lo que después escribe: si difirieran, el desglose sería peor
  // que no tenerlo.
  const r = await recotizar(owner, {});
  assert.ok(r.ok);
  assert.equal(r.data.totalCent, 4_500_000n + 3_500_000n);
});

test("a quien no tiene ninguna tarifa se lo muestra como 'sin tarifa' y no se le inventa un precio", async () => {
  await tarifa("tMariano", "in1", 750_000);
  await reservaSinPrecio("r1", "in1", 2, 1);
  await reservaSinPrecio("r2", "in2", 3, 1); // in2 no tiene tarifa, y no hay general

  const desglose = await pendientesPorProfesional("op1", db);
  const sinTarifa = desglose.find((d) => d.inquilinoId === "in2")!;
  assert.equal(sinTarifa.precioHoraCent, null);
  assert.equal(sinTarifa.importeCent, 0n);

  const r = await recotizar(owner, {});
  assert.ok(r.ok);
  assert.equal(r.data.cotizadas, 1);
  assert.equal(r.data.sinTarifa, 1, "la de in2 queda esperando su tarifa, no se factura en $0");
  const intocada = await db.ocupacion.findUniqueOrThrow({ where: { id: "r2" }, select: { importeCent: true } });
  assert.equal(intocada.importeCent, null);
});

test("MUCHAS reservas: se hacen todas, y el cargo queda asentado una sola vez por reserva", async () => {
  await tarifa("tGeneral", null, 800_000);
  // 120 reservas: bastantes más que el lote, para que pase por varias transacciones.
  for (let i = 0; i < 120; i++) {
    const dia = (i % 28) + 1;
    await insertarOcupacion(pgPool, {
      id: `m${i}`,
      salaId: i % 2 === 0 ? "sa1" : "sa2",
      inquilinoId: i % 2 === 0 ? "in1" : "in2",
      inicio: `2026-03-${String(dia).padStart(2, "0")}T${String(6 + (i % 10)).padStart(2, "0")}:00:00Z`,
      fin: `2026-03-${String(dia).padStart(2, "0")}T${String(7 + (i % 10)).padStart(2, "0")}:00:00Z`,
    });
  }
  assert.equal(await reservasSinPrecio("op1", db), 120);

  const r = await recotizar(owner, {});
  assert.ok(r.ok);
  assert.equal(r.data.cotizadas + r.data.restantes, 120, "lo hecho más lo que falta son todas");
  assert.equal(await reservasSinPrecio("op1", db), r.data.restantes, "las que faltan siguen esperando");

  // Se aprieta de nuevo hasta terminar, que es lo que hace el usuario cuando quedan pendientes.
  let vueltas = 0;
  while ((await reservasSinPrecio("op1", db)) > 0 && vueltas < 20) {
    await recotizar(owner, {});
    vueltas++;
  }
  assert.equal(await reservasSinPrecio("op1", db), 0, "termina en unas pocas pasadas");

  // Y nada se cobró dos veces: un asiento por reserva, ni uno más.
  const asientos = await db.asiento.count({ where: { operadorId: "op1", concepto: "cargo_uso" } });
  assert.equal(asientos, 120);
});

test("volver a apretarlo cuando ya no queda nada no cobra de nuevo", async () => {
  await tarifa("tGeneral", null, 800_000);
  await reservaSinPrecio("r1", "in1", 2, 3);

  await recotizar(owner, {});
  const segunda = await recotizar(owner, {});
  assert.ok(segunda.ok);
  assert.equal(segunda.data.cotizadas, 0, "no hay nada que hacer");
  assert.equal(await db.asiento.count({ where: { operadorId: "op1", concepto: "cargo_uso" } }), 1);
});

test("un precio ESTAMPADO no se reescribe, aunque hoy la tarifa sea otra (§8.8)", async () => {
  await tarifa("tGeneral", null, 800_000);
  await reservaSinPrecio("r1", "in1", 2, 1);
  await pgPool.query(`UPDATE "Ocupacion" SET "importeCent"=100000, "precioHoraCent"=100000 WHERE "id"='r1'`);

  const r = await recotizar(owner, {});
  assert.ok(r.ok);
  assert.equal(r.data.cotizadas, 0, "ya tenía precio: no se toca");
  const fila = await db.ocupacion.findUniqueOrThrow({ where: { id: "r1" }, select: { importeCent: true } });
  assert.equal(fila.importeCent, 100_000n, "sigue valiendo lo que valía");
});

test("un profesional no puede correr esto: toca la cuenta corriente de todos", async () => {
  await tarifa("tGeneral", null, 800_000);
  await reservaSinPrecio("r1", "in1", 2, 1);

  const r = await recotizar(profesional, {});
  assert.deepEqual(r, { ok: false, error: "SIN_PERMISO" });
  assert.equal(await reservasSinPrecio("op1", db), 1, "cero escrituras");
});
