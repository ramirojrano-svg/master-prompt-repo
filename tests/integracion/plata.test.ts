// tests/integracion/plata.test.ts — el ledger y el cierre (§5.10).
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { asentarIdempotente, cobroManual, morosidadAgregada, saldoCorriente } from "../../src/servicios/plata/ledger.ts";
import { cerrarPeriodo } from "../../src/servicios/plata/liquidacion.ts";
import { prisma } from "../../src/db/prisma.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: `${URL_DB}?connection_limit=15` });
const PERIODO = "2026-08";
const F = new Date("2026-08-12T12:00:00Z");

function cargo(inquilinoId: string, montoCent: bigint, clave: string, concepto: "cargo_uso" | "pago" = "cargo_uso") {
  return asentarIdempotente(db, { operadorId: "op1", inquilinoId, concepto, montoCent, moneda: "ARS", periodo: PERIODO, fechaHecho: F, clave });
}

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Asiento","Liquidacion" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

test("saldo = Σ asientos tras 50 operaciones aleatorias (incluida una reversa)", async () => {
  let esperado = 0n;
  for (let i = 0; i < 50; i++) {
    const monto = BigInt((Math.floor(Math.random() * 200) - 100) * 100); // -10000..10000
    await cargo("in1", monto, `t:${i}`, monto >= 0n ? "cargo_uso" : "pago");
    esperado += monto;
  }
  assert.equal(await saldoCorriente(db, { operadorId: "op1", inquilinoId: "in1" }), esperado);
});

test("clave idempotente: el mismo asiento dos veces cuenta una sola vez", async () => {
  const a = await cargo("in1", 5_000n, "dup:1");
  const b = await cargo("in1", 5_000n, "dup:1");
  assert.equal(a.creado, true);
  assert.equal(b.creado, false);
  assert.equal(await saldoCorriente(db, { operadorId: "op1", inquilinoId: "in1" }), 5_000n);
});

test("cobro manual baja el saldo (asiento negativo)", async () => {
  await cargo("in1", 9_000n, "c:1");
  await cobroManual(db, { operadorId: "op1", inquilinoId: "in1", montoCent: 4_000n, moneda: "ARS", periodo: PERIODO, fechaHecho: F, creadoPorUserId: "u1" });
  assert.equal(await saldoCorriente(db, { operadorId: "op1", inquilinoId: "in1" }), 5_000n);
});

test("cerrar período suma los cargos, NO los pagos; segunda corrida => YA_LIQUIDADO", async () => {
  await cargo("in1", 10_000n, "c:1");
  await cargo("in1", 6_000n, "c:2");
  await cargo("in1", -3_000n, "p:1", "pago"); // un pago NO entra a la liquidación

  const r1 = await cerrarPeriodo({ operadorId: "op1", inquilinoId: "in1", periodo: PERIODO, alicuotaDecimas: 0, venceEl: F, receptorRazonSocial: "Dra Perez", receptorCondIva: "monotributo" }, db);
  assert.ok(r1.ok);
  if (r1.ok) assert.equal(r1.totalCent, 16_000n); // 10000 + 6000, sin el pago

  const r2 = await cerrarPeriodo({ operadorId: "op1", inquilinoId: "in1", periodo: PERIODO, alicuotaDecimas: 0, venceEl: F, receptorRazonSocial: "Dra Perez", receptorCondIva: "monotributo" }, db);
  assert.deepEqual(r2, { ok: false, error: "YA_LIQUIDADO" });

  const n = await db.liquidacion.count({ where: { operadorId: "op1", inquilinoId: "in1", periodo: PERIODO } });
  assert.equal(n, 1); // una sola liquidación
});

test("dos cierres en PARALELO del mismo período => una sola liquidación, misma suma", async () => {
  await cargo("in1", 8_000n, "c:1");
  const args = { operadorId: "op1", inquilinoId: "in1", periodo: PERIODO, alicuotaDecimas: 0, venceEl: F, receptorRazonSocial: "Dra", receptorCondIva: "monotributo" };
  const [a, b] = await Promise.all([cerrarPeriodo(args, db), cerrarPeriodo(args, db)]);
  const oks = [a, b].filter((r) => r.ok).length;
  assert.equal(oks, 1);
  const n = await db.liquidacion.count({ where: { operadorId: "op1", periodo: PERIODO } });
  assert.equal(n, 1);
});

test("período sin cargos facturables => NADA_QUE_LIQUIDAR", async () => {
  await cargo("in1", -5_000n, "p:1", "pago"); // solo un pago
  const r = await cerrarPeriodo({ operadorId: "op1", inquilinoId: "in1", periodo: PERIODO, alicuotaDecimas: 0, venceEl: F, receptorRazonSocial: "x", receptorCondIva: "x" }, db);
  assert.deepEqual(r, { ok: false, error: "NADA_QUE_LIQUIDAR" });
});

test("morosidad agrega SOLO saldos positivos (no netea al que pagó de más)", async () => {
  await cargo("in1", 10_000n, "d:1"); // in1 debe 10.000
  await cargo("in2", -4_000n, "f:1", "pago"); // in2 a favor 4.000
  const mora = await morosidadAgregada(db, "op1");
  assert.equal(mora, 10_000n); // no 6.000
});
