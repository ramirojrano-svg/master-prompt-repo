// tests/integracion/detalle-liquidacion.test.ts — el papel que recibe el profesional.
//
// Este documento es lo que se manda cuando alguien pregunta de dónde sale el importe. Si dice algo
// distinto de lo que se emitió, no es un error de pantalla: es un reclamo mal hecho.
//
// Lo que se fija acá:
//  · Que NO recalcule. Los importes son los congelados al cerrar, pase lo que pase después.
//  · Que las líneas sean los asientos SELLADOS con esa liquidación, y no "los cargos del mes":
//    un cargo tardío, posterior al cierre, no está en ese papel.
//  · Que un cargo de uso se lea como la sesión que fue, con horario y consultorio.
//  · Que la liquidación de otro centro no se pueda abrir por id.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { detalleDeLiquidacion } from "../../src/servicios/plata/detalle-liquidacion.ts";
import { cierreCon } from "../../src/servicios/plata/cierre.ts";
import { asentarIdempotente } from "../../src/servicios/plata/ledger.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { insertarOcupacion, nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });
const cierre = cierreCon(db);

const owner: Actor = { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null };
const PERIODO = "2026-08";
const F = new Date("2026-08-12T12:00:00Z");

function cargo(clave: string, montoCent: bigint, reservaId?: string) {
  return asentarIdempotente(db, {
    operadorId: "op1", inquilinoId: "in1", concepto: "cargo_uso", montoCent,
    moneda: "ARS", periodo: PERIODO, fechaHecho: F, clave, reservaId,
  });
}

async function cerrar() {
  const r = await cierre.uno(owner, { periodo: PERIODO, inquilinoId: "in1", venceEl: "2026-09-10" });
  assert.ok(r.ok && r.data.ok, "el cierre no debería fallar");
  return r.data;
}

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Asiento","Liquidacion","Ocupacion","Auditoria" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

// ── Lo que dice el papel ────────────────────────────────────────────────────

test("las líneas son los asientos de esa liquidación y suman el total emitido", async () => {
  await cargo("c:1", 20_000n);
  await cargo("c:2", 15_000n);
  const emitida = await cerrar();

  const d = await detalleDeLiquidacion({ operadorId: "op1", liquidacionId: emitida.liquidacionId }, db);
  assert.ok(d);
  assert.equal(d.lineas.length, 2);
  assert.equal(d.lineas.reduce((s, l) => s + l.montoCent, 0n), d.totalCent);
  assert.equal(d.totalCent, 35_000n);
  assert.equal(d.numero, emitida.numero);
});

test("un cargo posterior al cierre NO aparece en el papel ya emitido", async () => {
  await cargo("c:1", 20_000n);
  const emitida = await cerrar();
  // Llega tarde: es del mes, pero el papel ya salió.
  await cargo("c:tardio", 9_000n);

  const d = await detalleDeLiquidacion({ operadorId: "op1", liquidacionId: emitida.liquidacionId }, db);
  assert.ok(d);
  assert.equal(d.lineas.length, 1, "el papel no puede crecer después de emitido");
  assert.equal(d.totalCent, 20_000n);
});

test("el total no se recalcula: es el congelado al emitir", async () => {
  await cargo("c:1", 20_000n);
  const emitida = await cerrar();
  // Alguien toca el asiento a mano en la base. El documento tiene que seguir diciendo lo mismo.
  await pgPool.query(`UPDATE "Asiento" SET "montoCent" = 99999`);

  const d = await detalleDeLiquidacion({ operadorId: "op1", liquidacionId: emitida.liquidacionId }, db);
  assert.ok(d);
  assert.equal(d.totalCent, 20_000n, "el total sale de la liquidación, no de sumar los asientos de nuevo");
});

test("un cargo de uso se lee como la sesión: horario y consultorio", async () => {
  await insertarOcupacion(pgPool, {
    id: "oc1", salaId: "sa1", inquilinoId: "in1",
    inicio: "2026-08-12T13:00:00Z", fin: "2026-08-12T16:00:00Z",
  });
  await cargo("c:1", 22_500n, "oc1");
  const emitida = await cerrar();

  const d = await detalleDeLiquidacion({ operadorId: "op1", liquidacionId: emitida.liquidacionId }, db);
  assert.ok(d);
  const [l] = d.lineas;
  assert.ok(l);
  assert.ok(l.detalle.includes("Sala 1"), `esperaba el consultorio en: ${l.detalle}`);
  assert.ok(/\d{2}:\d{2} a \d{2}:\d{2}/.test(l.detalle), `esperaba el horario en: ${l.detalle}`);
  // La fecha del renglón es la de la SESIÓN, no la de cuando se asentó el cargo.
  assert.equal(l.fecha.toISOString(), "2026-08-12T13:00:00.000Z");
});

test("una reserva sin consultorio lo dice: no es un dato que falte", async () => {
  await insertarOcupacion(pgPool, {
    id: "oc1", salaId: null, inquilinoId: "in1",
    inicio: "2026-08-12T13:00:00Z", fin: "2026-08-12T16:00:00Z",
  });
  await cargo("c:1", 22_500n, "oc1");
  const emitida = await cerrar();

  const d = await detalleDeLiquidacion({ operadorId: "op1", liquidacionId: emitida.liquidacionId }, db);
  assert.ok(d);
  assert.ok(d.lineas[0]!.detalle.includes("sin consultorio"));
});

// ── Los pagos y el saldo ────────────────────────────────────────────────────

test("los pagos se listan en positivo y bajan el saldo, sin tocar el total", async () => {
  await cargo("c:1", 20_000n);
  const emitida = await cerrar();
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId: "in1", concepto: "pago", montoCent: -8_000n,
    moneda: "ARS", periodo: PERIODO, fechaHecho: F, clave: "p:1",
  });

  const d = await detalleDeLiquidacion({ operadorId: "op1", liquidacionId: emitida.liquidacionId }, db);
  assert.ok(d);
  assert.equal(d.totalCent, 20_000n, "un pago no reduce lo facturado");
  assert.equal(d.pagos.length, 1);
  assert.equal(d.pagos[0]!.montoCent, 8_000n, "un pago se lee como plata entregada, no en negativo");
  assert.equal(d.pagadoCent, 8_000n);
  assert.equal(d.saldoCent, 12_000n);
});

test("quien pagó de más queda con saldo negativo, no en cero", async () => {
  await cargo("c:1", 20_000n);
  const emitida = await cerrar();
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId: "in1", concepto: "pago", montoCent: -25_000n,
    moneda: "ARS", periodo: PERIODO, fechaHecho: F, clave: "p:1",
  });

  const d = await detalleDeLiquidacion({ operadorId: "op1", liquidacionId: emitida.liquidacionId }, db);
  assert.ok(d);
  // Redondear a cero le escondería al profesional que tiene plata a favor.
  assert.equal(d.saldoCent, -5_000n);
});

test("el pago de OTRO profesional no entra en este papel", async () => {
  await cargo("c:1", 20_000n);
  const emitida = await cerrar();
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId: "in2", concepto: "pago", montoCent: -20_000n,
    moneda: "ARS", periodo: PERIODO, fechaHecho: F, clave: "p:otro",
  });

  const d = await detalleDeLiquidacion({ operadorId: "op1", liquidacionId: emitida.liquidacionId }, db);
  assert.ok(d);
  assert.equal(d.pagos.length, 0);
  assert.equal(d.saldoCent, 20_000n, "sigue debiendo todo");
});

// ── Pertenencia ─────────────────────────────────────────────────────────────

test("la liquidación de otro centro no se abre por id", async () => {
  await cargo("c:1", 20_000n);
  const emitida = await cerrar();

  const d = await detalleDeLiquidacion({ operadorId: "op-ajeno", liquidacionId: emitida.liquidacionId }, db);
  // Inexistente y ajena dan lo mismo: distinguirlas confirmaría qué ids existen (§6.11).
  assert.equal(d, null);
});

test("un id que no existe devuelve null, no explota", async () => {
  assert.equal(await detalleDeLiquidacion({ operadorId: "op1", liquidacionId: "no-existe" }, db), null);
});

// ── El encabezado ───────────────────────────────────────────────────────────

test("sale a nombre de quien abona, estampado al emitir", async () => {
  await pgPool.query(`UPDATE "Inquilino" SET "pagador" = 'Consultorios Del Sur SRL' WHERE id = 'in1'`);
  await cargo("c:1", 20_000n);
  const emitida = await cerrar();
  // Le cambian el nombre después: el papel emitido no se puede reescribir (§8.8).
  await pgPool.query(`UPDATE "Inquilino" SET "pagador" = 'Otro Nombre SA' WHERE id = 'in1'`);

  const d = await detalleDeLiquidacion({ operadorId: "op1", liquidacionId: emitida.liquidacionId }, db);
  assert.ok(d);
  assert.equal(d.receptor, "Consultorios Del Sur SRL");
});
