// tests/integracion/cupo.test.ts — T-54…T-57 (§15), el libro de minutos.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { consumirMinutos, otorgarCupoMes, PACK_PERIODO, saldoBolsa } from "../../src/servicios/plata/cupo.ts";
import { prisma } from "../../src/db/prisma.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: `${URL_DB}?connection_limit=15&pool_timeout=20` });
const PERIODO = "2026-08";
const inq = "in1";

function saldoMes() {
  return saldoBolsa(db, { operadorId: "op1", inquilinoId: inq, bolsa: "mes", periodo: PERIODO });
}
async function altaPack(minutos: number, clave: string) {
  await db.bolsaAsiento.create({ data: { operadorId: "op1", inquilinoId: inq, bolsa: "pack", minutos, periodo: PACK_PERIODO, clave } });
}

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "BolsaAsiento" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

test("T-54 · upgrade a mitad de mes: 8h -> 20h acredita 12, no 20 ni 0", async () => {
  await otorgarCupoMes(db, { operadorId: "op1", inquilinoId: inq, clave: `cupo:mem:${PERIODO}`, periodo: PERIODO, minutosObjetivo: 480 });
  const up = await otorgarCupoMes(db, { operadorId: "op1", inquilinoId: inq, clave: `cupo:mem:${PERIODO}:up`, periodo: PERIODO, minutosObjetivo: 1200 });
  assert.equal(up.otorgado, 720); // 12 h
  assert.equal(await saldoMes(), 1200); // 20 h
});

test("T-55 · doble corrida del otorgamiento con la MISMA clave => un solo asiento", async () => {
  const clave = `cupo:mem:${PERIODO}`;
  await otorgarCupoMes(db, { operadorId: "op1", inquilinoId: inq, clave, periodo: PERIODO, minutosObjetivo: 480 });
  const dup = await otorgarCupoMes(db, { operadorId: "op1", inquilinoId: inq, clave, periodo: PERIODO, minutosObjetivo: 480 });
  assert.equal(dup.otorgado, 0);
  const { rows } = await pgPool.query('SELECT count(*)::int AS n FROM "BolsaAsiento"');
  assert.equal(rows[0].n, 1);
  assert.equal(await saldoMes(), 480);
});

test("T-56 · excedente: gastado el cupo, la hora siguiente sale por excedente (no rechaza)", async () => {
  await otorgarCupoMes(db, { operadorId: "op1", inquilinoId: inq, clave: `cupo:mem:${PERIODO}`, periodo: PERIODO, minutosObjetivo: 480 });
  const usa8 = await consumirMinutos(db, { operadorId: "op1", inquilinoId: inq, periodo: PERIODO, minutos: 480, reservaId: "r0" });
  assert.deepEqual(usa8, { minutosDeCupo: 480, minutosExcedente: 0 });

  const hora9 = await consumirMinutos(db, { operadorId: "op1", inquilinoId: inq, periodo: PERIODO, minutos: 60, reservaId: "r1" });
  assert.deepEqual(hora9, { minutosDeCupo: 0, minutosExcedente: 60 });
});

test("gasta primero la bolsa que vence (mes) y después el pack", async () => {
  await otorgarCupoMes(db, { operadorId: "op1", inquilinoId: inq, clave: `cupo:mem:${PERIODO}`, periodo: PERIODO, minutosObjetivo: 30 });
  await altaPack(120, "bono:1");
  const r = await consumirMinutos(db, { operadorId: "op1", inquilinoId: inq, periodo: PERIODO, minutos: 90, reservaId: "rmix" });
  assert.deepEqual(r, { minutosDeCupo: 90, minutosExcedente: 0 });
  assert.equal(await saldoMes(), 0); // se agotó el mes
  assert.equal(await saldoBolsa(db, { operadorId: "op1", inquilinoId: inq, bolsa: "pack", periodo: PACK_PERIODO }), 60); // quedaron 60 del pack
});

test("T-57 · consumo concurrente con 1h de saldo: una toma cupo, la otra va a excedente", async () => {
  await otorgarCupoMes(db, { operadorId: "op1", inquilinoId: inq, clave: `cupo:mem:${PERIODO}`, periodo: PERIODO, minutosObjetivo: 60 });
  const [a, b] = await Promise.all([
    consumirMinutos(db, { operadorId: "op1", inquilinoId: inq, periodo: PERIODO, minutos: 60, reservaId: "ra" }),
    consumirMinutos(db, { operadorId: "op1", inquilinoId: inq, periodo: PERIODO, minutos: 60, reservaId: "rb" }),
  ]);
  const deCupo = [a, b].filter((r) => r.minutosDeCupo === 60).length;
  const excedente = [a, b].filter((r) => r.minutosExcedente === 60).length;
  assert.equal(deCupo, 1, "exactamente una consume del cupo");
  assert.equal(excedente, 1, "la otra va a excedente");
  assert.equal(await saldoMes(), 0);
});
