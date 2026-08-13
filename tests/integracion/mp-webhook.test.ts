// tests/integracion/mp-webhook.test.ts — §5.10 #2, #4, #5, #6: procesamiento del pago MP.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { procesarPagoMP, type ContextoPago, type PagoMP } from "../../src/servicios/plata/mp-webhook.ts";
import { saldoCorriente } from "../../src/servicios/plata/ledger.ts";
import { prisma } from "../../src/db/prisma.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });

const CTX: ContextoPago = {
  operadorId: "op1",
  inquilinoId: "in1",
  mpUserIdOperador: "MP123",
  montoEsperadoCent: 100_000n, // $1.000
  moneda: "ARS",
  periodo: "2026-08",
  fechaHecho: new Date("2026-08-12T12:00:00Z"),
};

const pagoOk: PagoMP = { id: "pay1", status: "approved", transaction_amount: 1000, collector_id: "MP123" };

async function cuenta() {
  const { rows } = await pgPool.query(`SELECT count(*)::int AS n FROM "Asiento"`);
  return rows[0].n as number;
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

test("#2 doble webhook con el mismo payment.id => un solo asiento", async () => {
  const a = await procesarPagoMP(db, pagoOk, CTX);
  const b = await procesarPagoMP(db, pagoOk, CTX);
  assert.deepEqual(a, { ok: true, efecto: "acreditado" });
  assert.deepEqual(b, { ok: true, efecto: "ya_estaba" });
  assert.equal(await cuenta(), 1);
  assert.equal(await saldoCorriente(db, { operadorId: "op1", inquilinoId: "in1" }), -100_000n);
});

test("#4 collector_id de otro operador => cross_tenant y CERO escrituras", async () => {
  const r = await procesarPagoMP(db, { ...pagoOk, collector_id: "OTRO" }, CTX);
  assert.deepEqual(r, { ok: false, efecto: "cross_tenant" });
  assert.equal(await cuenta(), 0);
});

test("#6 pago aprobado por MENOS que el total => no acredita", async () => {
  const r = await procesarPagoMP(db, { ...pagoOk, transaction_amount: 500 }, CTX);
  assert.deepEqual(r, { ok: true, efecto: "pago_insuficiente" });
  assert.equal(await cuenta(), 0);
});

test("#5 refunded de un pago que NUNCA acreditó => cero asientos", async () => {
  const r = await procesarPagoMP(db, { ...pagoOk, status: "refunded" }, CTX);
  assert.deepEqual(r, { ok: true, efecto: "sin_reversa" });
  assert.equal(await cuenta(), 0);
});

test("refunded de un pago EXISTENTE => reversa que devuelve el saldo", async () => {
  await procesarPagoMP(db, pagoOk, CTX); // acredita -100000
  const r = await procesarPagoMP(db, { ...pagoOk, status: "refunded" }, CTX); // +100000
  assert.deepEqual(r, { ok: true, efecto: "reversado" });
  assert.equal(await saldoCorriente(db, { operadorId: "op1", inquilinoId: "in1" }), 0n);
  assert.equal(await cuenta(), 2); // pago + reversa
});

test("un estado desconocido (pending) no se adopta => ignorado, sin escrituras", async () => {
  const r = await procesarPagoMP(db, { ...pagoOk, status: "pending" }, CTX);
  assert.deepEqual(r, { ok: true, efecto: "ignorado" });
  assert.equal(await cuenta(), 0);
});
