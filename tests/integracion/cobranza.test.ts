// tests/integracion/cobranza.test.ts — quién pagó y quién debe.
//
// Es la pantalla con la que se le reclama plata a la gente, así que un número mal acá no es un
// error de cálculo: es reclamarle a alguien que ya pagó, o no reclamarle a quien debe. Cada test
// fija una de las decisiones que hacen que el número sea el correcto.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { cobranzaDelMes } from "../../src/servicios/plata/cobranza.ts";
import { cierreCon } from "../../src/servicios/plata/cierre.ts";
import { asentarIdempotente } from "../../src/servicios/plata/ledger.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });
const cierre = cierreCon(db);

const owner: Actor = { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null };
const PERIODO = "2026-08";
const F = new Date("2026-08-12T12:00:00Z");

function mov(inquilinoId: string, montoCent: bigint, clave: string, concepto: "cargo_uso" | "pago" = "cargo_uso") {
  return asentarIdempotente(db, { operadorId: "op1", inquilinoId, concepto, montoCent, moneda: "ARS", periodo: PERIODO, fechaHecho: F, clave });
}

/** Cierra el mes con un vencimiento elegido, para poder probar lo vencido. */
async function cerrar(inquilinoId: string, venceEl: string) {
  const r = await cierre.uno(owner, { periodo: PERIODO, inquilinoId, venceEl });
  assert.ok(r.ok, "el cierre no debería fallar por permisos");
  return r;
}

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Asiento","Liquidacion","Auditoria" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

// ── Los tres números ────────────────────────────────────────────────────────

test("emitido, pagado y pendiente salen de la liquidación y de los pagos del mes", async () => {
  await mov("in1", 20_000n, "c:1");
  await cerrar("in1", "2026-09-10");
  await mov("in1", -8_000n, "p:1", "pago");

  const c = await cobranzaDelMes({ operadorId: "op1", periodo: PERIODO }, db);
  assert.ok(c);
  const in1 = c.filas.find((f) => f.inquilinoId === "in1")!;
  assert.equal(in1.emitidoCent, 20_000n);
  assert.equal(in1.pagadoCent, 8_000n, "los pagos se leen como plata que entró, no en negativo");
  assert.equal(in1.pendienteCent, 12_000n);
});

test("con la cuenta emitida manda el total CONGELADO, no la suma de los cargos", async () => {
  await mov("in1", 10_000n, "c:1");
  await cerrar("in1", "2026-09-10");
  // Aparece un cargo tardío del mismo mes: no puede cambiar lo que se le reclama, porque el papel
  // que recibió dice otra cosa.
  await mov("in1", 5_000n, "c:tarde");

  const c = await cobranzaDelMes({ operadorId: "op1", periodo: PERIODO }, db);
  const in1 = c!.filas.find((f) => f.inquilinoId === "in1")!;
  assert.equal(in1.emitidoCent, 10_000n, "lo que dice la liquidación, no 15.000");
  assert.equal(in1.pendienteCent, 10_000n);
});

test("sin liquidación emitida se muestra lo que se VA a cobrar, y se avisa", async () => {
  await mov("in1", 7_000n, "c:1");

  const c = await cobranzaDelMes({ operadorId: "op1", periodo: PERIODO }, db);
  const in1 = c!.filas.find((f) => f.inquilinoId === "in1")!;
  assert.equal(in1.liquidacion, null);
  assert.equal(in1.emitidoCent, 7_000n, "el número existe: es lo que se emitiría");
  assert.equal(in1.vencida, false, "pero NO puede estar vencida: nunca se le comunicó");
  assert.equal(c!.sinCerrar, 1, "y la pantalla lo dice arriba");
});

// ── Lo vencido ──────────────────────────────────────────────────────────────

test("vencida es la que pasó su fecha Y sigue sin pagarse del todo", async () => {
  await mov("in1", 10_000n, "a:1");
  await cerrar("in1", "2020-01-10"); // venció hace años

  await mov("in2", 10_000n, "b:1");
  await cerrar("in2", "2099-01-10"); // vence dentro de mucho

  const c = await cobranzaDelMes({ operadorId: "op1", periodo: PERIODO }, db);
  assert.equal(c!.filas.find((f) => f.inquilinoId === "in1")!.vencida, true);
  assert.equal(c!.filas.find((f) => f.inquilinoId === "in2")!.vencida, false);
  assert.equal(c!.totales.vencidas, 1);
});

test("una vencida que se pagó deja de estar vencida", async () => {
  await mov("in1", 10_000n, "a:1");
  await cerrar("in1", "2020-01-10");
  await mov("in1", -10_000n, "p:1", "pago");

  const c = await cobranzaDelMes({ operadorId: "op1", periodo: PERIODO }, db);
  const in1 = c!.filas.find((f) => f.inquilinoId === "in1")!;
  assert.equal(in1.pendienteCent, 0n);
  assert.equal(in1.vencida, false, "pagada no es vencida, aunque la fecha haya pasado");
  assert.equal(c!.totales.vencidas, 0);
});

test("lo vencido va PRIMERO: el orden de la lista es el orden del trabajo", async () => {
  await mov("in1", 5_000n, "a:1"); // poco, pero vencido
  await cerrar("in1", "2020-01-10");
  await mov("in2", 90_000n, "b:1"); // mucho, pero al día
  await cerrar("in2", "2099-01-10");

  const c = await cobranzaDelMes({ operadorId: "op1", periodo: PERIODO }, db);
  assert.equal(c!.filas[0]!.inquilinoId, "in1", "lo vencido primero, aunque sea menos plata");
});

// ── La deuda no se maquilla ─────────────────────────────────────────────────

test("la deuda NO se netea con quien pagó de más (§5.6)", async () => {
  await mov("in1", 10_000n, "a:1");
  await cerrar("in1", "2026-09-10");
  await mov("in2", -4_000n, "b:pago", "pago"); // pagó de más: queda a favor

  const c = await cobranzaDelMes({ operadorId: "op1", periodo: PERIODO }, db);
  assert.equal(c!.totales.pendienteCent, 10_000n, "la deuda es 10.000, no 6.000");
  const in2 = c!.filas.find((f) => f.inquilinoId === "in2")!;
  assert.ok(in2.pendienteCent < 0n, "el saldo a favor se ve, pero no tapa la deuda del otro");
});

// ── Aislamiento y bordes ────────────────────────────────────────────────────

test("no se mezcla con otro centro", async () => {
  await pgPool.query(`INSERT INTO "Operador"("id","nombre","slug","moneda") VALUES('opZ','Otro','otro-z','ARS')`);
  await pgPool.query(`INSERT INTO "Inquilino"("id","operadorId","nombre") VALUES('inZ','opZ','Ajeno')`);
  await asentarIdempotente(db, { operadorId: "opZ", inquilinoId: "inZ", concepto: "cargo_uso", montoCent: 99_000n, moneda: "ARS", periodo: PERIODO, fechaHecho: F, clave: "z:1" });
  await mov("in1", 1_000n, "a:1");

  const c = await cobranzaDelMes({ operadorId: "op1", periodo: PERIODO }, db);
  assert.equal(c!.totales.emitidoCent, 1_000n, "ni un peso del otro centro");
  assert.ok(!c!.filas.some((f) => f.inquilinoId === "inZ"));
  await pgPool.query(`DELETE FROM "Operador" WHERE "id"='opZ'`);
});

test("un mes sin movimientos no rompe: da cero y lista vacía", async () => {
  const c = await cobranzaDelMes({ operadorId: "op1", periodo: "2026-01" }, db);
  assert.ok(c);
  assert.deepEqual(c.filas, []);
  assert.equal(c.totales.pendienteCent, 0n);
  assert.equal(c.totales.vencidas, 0);
});

test("un período inválido devuelve null, no una pantalla rota", async () => {
  assert.equal(await cobranzaDelMes({ operadorId: "op1", periodo: "2026-99" }, db), null);
});
