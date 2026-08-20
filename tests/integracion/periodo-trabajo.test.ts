// tests/integracion/periodo-trabajo.test.ts — con qué mes abren Cierre y Cobranza.
//
// Parece un detalle de presentación y no lo es: si la pantalla abre en un mes vacío, lo primero
// que ve el que entra es todo en cero. Eso no se lee como "estás al día", se lee como que la app
// se rompió — y la respuesta real queda escondida detrás de una flecha que nadie va a tocar.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { periodoDeTrabajo } from "../../src/servicios/plata/periodo-trabajo.ts";
import { asentarIdempotente } from "../../src/servicios/plata/ledger.ts";
import { prisma } from "../../src/db/prisma.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });

function mov(periodo: string, clave: string, operadorId = "op1", inquilinoId = "in1") {
  return asentarIdempotente(db, {
    operadorId, inquilinoId, concepto: "cargo_uso", montoCent: 10_000n,
    moneda: "ARS", periodo, fechaHecho: new Date(`${periodo}-10T12:00:00Z`), clave,
  });
}

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Asiento" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

test("con historia abre el mes anterior: es el que se cierra y el que se cobra", async () => {
  await mov("2026-07", "c:julio");
  assert.equal(await periodoDeTrabajo({ operadorId: "op1", hoy: "2026-08" }, db), "2026-07");
});

test("sin historia abre el mes en curso, no una pantalla vacía", async () => {
  // El caso de un centro que empezó a usar la app este mes: todo lo que existe es de agosto.
  await mov("2026-08", "c:agosto");
  assert.equal(await periodoDeTrabajo({ operadorId: "op1", hoy: "2026-08" }, db), "2026-08");
});

test("una base sin un solo movimiento abre el mes en curso", async () => {
  assert.equal(await periodoDeTrabajo({ operadorId: "op1", hoy: "2026-08" }, db), "2026-08");
});

test("el mes en curso con movimientos NO tapa al anterior", async () => {
  // El 2 de septiembre ya hay reservas de septiembre, pero lo que hay que cerrar y cobrar es
  // agosto. Elegir "el último mes con movimientos" a secas rompería justo este caso.
  await mov("2026-08", "c:agosto");
  await mov("2026-09", "c:septiembre");
  assert.equal(await periodoDeTrabajo({ operadorId: "op1", hoy: "2026-09" }, db), "2026-08");
});

test("cruza el año sin marearse: en enero el anterior es diciembre", async () => {
  await mov("2025-12", "c:diciembre");
  assert.equal(await periodoDeTrabajo({ operadorId: "op1", hoy: "2026-01" }, db), "2025-12");
});

test("lo pedido por la URL manda, aunque el mes esté vacío", async () => {
  await mov("2026-07", "c:julio");
  // La flecha del mes tiene que poder llevar a un mes sin nada: si el default pisara lo pedido,
  // navegar hacia atrás sería imposible.
  assert.equal(await periodoDeTrabajo({ operadorId: "op1", hoy: "2026-08", pedido: "2026-03" }, db), "2026-03");
});

test("un período basura en la URL cae al default, no rompe la pantalla", async () => {
  await mov("2026-07", "c:julio");
  for (const basura of ["", "2026-13", "agosto", "../../etc"]) {
    assert.equal(await periodoDeTrabajo({ operadorId: "op1", hoy: "2026-08", pedido: basura }, db), "2026-07", basura);
  }
});

test("los movimientos de OTRO centro no cuentan como historia propia", async () => {
  await pgPool.query(`INSERT INTO "Operador"("id","nombre","slug") VALUES('op2','Otro','otro')`);
  await pgPool.query(`INSERT INTO "Inquilino"("id","operadorId","nombre") VALUES('in9','op2','Ajeno')`);
  await mov("2026-07", "c:ajeno", "op2", "in9");

  // op1 no tiene nada en julio: abrir ahí le mostraría una pantalla vacía por la actividad de
  // un centro que no es el suyo.
  assert.equal(await periodoDeTrabajo({ operadorId: "op1", hoy: "2026-08" }, db), "2026-08");
});
