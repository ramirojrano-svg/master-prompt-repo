// tests/integracion/cierre.test.ts — cerrar el mes desde el panel.
//
// El motor de la liquidación ya estaba probado en plata.test.ts; acá se prueba la CAPA que lo
// expone: permisos, pertenencia, y que lo que la pantalla anuncia sea exactamente lo que después
// se emite. Esa correspondencia es lo único que hace confiable un botón que factura.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { cierreCon, pendientesDeCierre } from "../../src/servicios/plata/cierre.ts";
import { asentarIdempotente } from "../../src/servicios/plata/ledger.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });
const { uno, todos } = cierreCon(db);

const owner: Actor = { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null };
const profesional: Actor = { usuarioId: "u2", operadorId: "op1", rol: "inquilino_titular", inquilinoId: "in1" };

const PERIODO = "2026-08";
const VENCE = "2026-09-10";
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
  await pgPool.query(`UPDATE "Inquilino" SET "pagador"=NULL`);
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

// ── Lo que la pantalla anuncia ──────────────────────────────────────────────

test("lo que se muestra es EXACTAMENTE lo que se va a cerrar: los pagos no entran", async () => {
  await cargo("in1", 10_000n, "c:1");
  await cargo("in1", 6_000n, "c:2");
  await cargo("in1", -3_000n, "p:1", "pago"); // un pago no es algo que se cobre

  const [fila] = await pendientesDeCierre({ operadorId: "op1", periodo: PERIODO }, db);
  assert.equal(fila!.pendientes, 2, "dos cargos, el pago no cuenta");
  assert.equal(fila!.pendienteCent, 16_000n);

  const r = await uno(owner, { periodo: PERIODO, inquilinoId: "in1", venceEl: VENCE });
  assert.ok(r.ok && r.data.ok);
  if (r.ok && r.data.ok) assert.equal(r.data.totalCent, 16_000n, "el total emitido es el anunciado");
});

test("después de cerrar no queda nada pendiente, y la fila muestra el número emitido", async () => {
  await cargo("in1", 9_000n, "c:1");
  const r = await uno(owner, { periodo: PERIODO, inquilinoId: "in1", venceEl: VENCE });
  assert.ok(r.ok && r.data.ok);

  const [fila] = await pendientesDeCierre({ operadorId: "op1", periodo: PERIODO }, db);
  assert.equal(fila!.pendientes, 0, "los cargos quedaron reclamados por la liquidación");
  assert.equal(fila!.liquidacion?.totalCent, 9_000n);
  assert.equal(fila!.liquidacion?.estado, "emitida");
  assert.ok((fila!.liquidacion?.numero ?? 0) > 0, "tiene número");
});

test("un mes cerrado NO se cierra dos veces", async () => {
  await cargo("in1", 5_000n, "c:1");
  const primera = await uno(owner, { periodo: PERIODO, inquilinoId: "in1", venceEl: VENCE });
  assert.ok(primera.ok && primera.data.ok);

  const segunda = await uno(owner, { periodo: PERIODO, inquilinoId: "in1", venceEl: VENCE });
  assert.ok(segunda.ok);
  // YA_LIQUIDADO y no "nada que liquidar": el candado de la base (una liquidación por centro,
  // profesional y mes) salta ANTES de mirar si quedaban cargos. Es la respuesta más precisa.
  if (segunda.ok) assert.equal(segunda.data.ok === false && segunda.data.error, "YA_LIQUIDADO");

  assert.equal(await db.liquidacion.count({ where: { operadorId: "op1", inquilinoId: "in1", periodo: PERIODO } }), 1);
});

test("un cargo que aparece DESPUÉS del cierre no reescribe el papel emitido", async () => {
  await cargo("in1", 5_000n, "c:1");
  const r = await uno(owner, { periodo: PERIODO, inquilinoId: "in1", venceEl: VENCE });
  assert.ok(r.ok && r.data.ok);

  // Llega un cargo tardío del mismo mes.
  await cargo("in1", 2_000n, "c:tarde");

  const liq = await db.liquidacion.findFirstOrThrow({ where: { inquilinoId: "in1", periodo: PERIODO }, select: { totalCent: true } });
  assert.equal(liq.totalCent, 5_000n, "el total quedó congelado: un mes cerrado da siempre lo mismo");

  // Y lo nuevo NO desaparece: queda visible como pendiente. Que no pueda entrar en una liquidación
  // de ese mes —hay una sola por mes y ya se emitió— es una consecuencia del candado que impide
  // facturar dos veces, y está bien que exista. Lo que NO puede pasar es que la plata se pierda de
  // vista, y por eso la pantalla la muestra en rojo como "fuera del cierre".
  const [fila] = await pendientesDeCierre({ operadorId: "op1", periodo: PERIODO }, db);
  assert.equal(fila!.pendienteCent, 2_000n, "queda a la vista");
  assert.ok(fila!.liquidacion, "y se ve que el mes ya estaba cerrado, que es lo que lo explica");

  const otroIntento = await uno(owner, { periodo: PERIODO, inquilinoId: "in1", venceEl: VENCE });
  assert.ok(otroIntento.ok);
  if (otroIntento.ok) assert.equal(otroIntento.data.ok === false && otroIntento.data.error, "YA_LIQUIDADO", "no hay segunda liquidación del mismo mes");
});

// ── El lote ─────────────────────────────────────────────────────────────────

test("cerrar el mes de TODOS emite una liquidación por profesional, y ninguna al que no debe nada", async () => {
  await cargo("in1", 4_000n, "a:1");
  await cargo("in2", 7_000n, "b:1");

  const r = await todos(owner, { periodo: PERIODO, venceEl: VENCE });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.data.cerradas, 2);
  assert.equal(r.data.totalCent, 11_000n);

  assert.equal(await db.liquidacion.count({ where: { operadorId: "op1", periodo: PERIODO } }), 2);

  // Y apretarlo de nuevo no emite nada: ya no queda pendiente.
  const otra = await todos(owner, { periodo: PERIODO, venceEl: VENCE });
  assert.ok(otra.ok);
  if (otra.ok) assert.equal(otra.data.cerradas, 0, "idempotente: apretar dos veces no factura dos veces");
  assert.equal(await db.liquidacion.count({ where: { operadorId: "op1", periodo: PERIODO } }), 2);
});

// ── Quién puede, y sobre qué ────────────────────────────────────────────────

test("un profesional NO puede cerrar meses: es plata de todo el centro", async () => {
  await cargo("in1", 4_000n, "a:1");

  assert.deepEqual(await uno(profesional, { periodo: PERIODO, inquilinoId: "in1", venceEl: VENCE }), { ok: false, error: "SIN_PERMISO" });
  assert.deepEqual(await todos(profesional, { periodo: PERIODO, venceEl: VENCE }), { ok: false, error: "SIN_PERMISO" });
  assert.equal(await db.liquidacion.count(), 0, "cero escrituras");
});

test("no se puede cerrar el mes de un profesional de OTRO centro", async () => {
  await pgPool.query(`INSERT INTO "Operador"("id","nombre","slug") VALUES('opX','Otro','otro-x')`);
  await pgPool.query(`INSERT INTO "Inquilino"("id","operadorId","nombre") VALUES('inX','opX','Ajeno')`);

  const r = await uno(owner, { periodo: PERIODO, inquilinoId: "inX", venceEl: VENCE });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.data.ok === false && r.data.error, "NADA_QUE_LIQUIDAR", "no existe para este centro");
  assert.equal(await db.liquidacion.count({ where: { inquilinoId: "inX" } }), 0);

  await pgPool.query(`DELETE FROM "Operador" WHERE "id"='opX'`);
});

test("la liquidación sale a nombre de QUIEN ABONA, no del que usó el consultorio", async () => {
  await pgPool.query(`UPDATE "Inquilino" SET "pagador"='Federico Terrón' WHERE "id"='in1'`);
  await cargo("in1", 3_000n, "c:1");

  await uno(owner, { periodo: PERIODO, inquilinoId: "in1", venceEl: VENCE });
  const liq = await db.liquidacion.findFirstOrThrow({ where: { inquilinoId: "in1" }, select: { receptorRazonSocial: true } });
  assert.equal(liq.receptorRazonSocial, "Federico Terrón", "es quien la recibe y quien la paga");
});

test("el mes de un profesional no arrastra los cargos de otro", async () => {
  await cargo("in1", 4_000n, "a:1");
  await cargo("in2", 9_000n, "b:1");

  await uno(owner, { periodo: PERIODO, inquilinoId: "in1", venceEl: VENCE });

  const filas = await pendientesDeCierre({ operadorId: "op1", periodo: PERIODO }, db);
  const otro = filas.find((f) => f.inquilinoId === "in2")!;
  assert.equal(otro.pendienteCent, 9_000n, "el de al lado sigue entero");
  assert.equal(otro.liquidacion, null);
});
