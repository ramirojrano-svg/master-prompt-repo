// tests/integracion/periodo-trabajo.test.ts — con qué mes abre Cierre de mes.
//
// El centro cobra A MES ENTRANTE: el último día hábil de agosto se emite y se manda lo que cada
// profesional va a pagar por septiembre. Así que la pantalla abre en el mes que VIENE, que es el
// que se está por cobrar — no en el que pasó.
//
// El caso de borde importa igual que antes: si el mes que viene todavía no tiene una sola reserva
// cargada, abrir ahí muestra todo en cero. Eso no se lee como "estás al día", se lee como que la
// app se rompió, y la respuesta real queda detrás de una flecha que nadie va a tocar.

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

test("con reservas cargadas abre el mes que VIENE: es el que se está por cobrar", async () => {
  await mov("2026-09", "c:septiembre");
  assert.equal(await periodoDeTrabajo({ operadorId: "op1", hoy: "2026-08" }, db), "2026-09");
});

test("sin nada cargado para el mes que viene, abre el mes en curso", async () => {
  // A principio de mes todavía no hay reservas del siguiente: abrir ahí sería una pantalla en
  // cero que parece rota.
  await mov("2026-08", "c:agosto");
  assert.equal(await periodoDeTrabajo({ operadorId: "op1", hoy: "2026-08" }, db), "2026-08");
});

test("una base sin un solo movimiento abre el mes en curso", async () => {
  assert.equal(await periodoDeTrabajo({ operadorId: "op1", hoy: "2026-08" }, db), "2026-08");
});

test("el mes en curso con movimientos no tapa al que viene", async () => {
  // En septiembre ya hay reservas de septiembre cargadas, pero lo que se está por cobrar es
  // octubre. El mes en curso es solo el paracaídas de cuando el siguiente está vacío.
  await mov("2026-09", "c:septiembre");
  await mov("2026-10", "c:octubre");
  assert.equal(await periodoDeTrabajo({ operadorId: "op1", hoy: "2026-09" }, db), "2026-10");
});

test("cruza el año sin marearse: en diciembre el que viene es enero", async () => {
  await mov("2027-01", "c:enero");
  assert.equal(await periodoDeTrabajo({ operadorId: "op1", hoy: "2026-12" }, db), "2027-01");
});

test("lo pedido por la URL manda, aunque el mes esté vacío", async () => {
  await mov("2026-07", "c:julio");
  // La flecha del mes tiene que poder llevar a un mes sin nada: si el default pisara lo pedido,
  // navegar hacia atrás sería imposible.
  assert.equal(await periodoDeTrabajo({ operadorId: "op1", hoy: "2026-08", pedido: "2026-03" }, db), "2026-03");
});

test("un período basura en la URL cae al default, no rompe la pantalla", async () => {
  await mov("2026-09", "c:septiembre");
  for (const basura of ["", "2026-13", "agosto", "../../etc"]) {
    assert.equal(await periodoDeTrabajo({ operadorId: "op1", hoy: "2026-08", pedido: basura }, db), "2026-09", basura);
  }
});

test("los movimientos de OTRO centro no cuentan como propios", async () => {
  await pgPool.query(`INSERT INTO "Operador"("id","nombre","slug") VALUES('op2','Otro','otro')`);
  await pgPool.query(`INSERT INTO "Inquilino"("id","operadorId","nombre") VALUES('in9','op2','Ajeno')`);
  await mov("2026-09", "c:ajeno", "op2", "in9");

  // op1 no tiene nada en septiembre: abrir ahí le mostraría una pantalla vacía por la actividad
  // de un centro que no es el suyo.
  assert.equal(await periodoDeTrabajo({ operadorId: "op1", hoy: "2026-08" }, db), "2026-08");
});
