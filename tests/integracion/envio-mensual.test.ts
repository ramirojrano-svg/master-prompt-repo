// tests/integracion/envio-mensual.test.ts — la tarea que corre sola.
//
// Es la única parte de la app que actúa sin que nadie apriete nada, y manda mails a veintinueve
// personas. Lo que hay que probar no es que funcione un día bueno, sino que NO haga daño:
//
//  · Que no corra el día equivocado.
//  · Que no mande dos veces si el cron se dispara dos veces.
//  · Que un fallo en uno no deje sin aviso a los demás.
//  · Que facture el mes que VIENE, no el que pasó.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { envioMensual } from "../../src/servicios/plata/envio-mensual.ts";
import { asentarIdempotente } from "../../src/servicios/plata/ledger.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Mensaje, ResultadoEnvio } from "../../src/lib/email.ts";
import { insertarOcupacion, nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });

// Lunes 31 de agosto de 2026: último día hábil del mes. Se factura SEPTIEMBRE.
const ULTIMO_HABIL = "2026-08-31";
const PERIODO = "2026-09";

function buzon(resultado: ResultadoEnvio = { ok: true, via: "smtp" }) {
  const enviados: Mensaje[] = [];
  return { enviados, mandar: async (m: Mensaje) => { enviados.push(m); return resultado; } };
}

/** Una reserva de SEPTIEMBRE con su cargo: es lo que se va a facturar el 31 de agosto. */
async function reservaDeSeptiembre(id: string, inquilinoId: string, montoCent: bigint) {
  await insertarOcupacion(pgPool, {
    id, salaId: "sa1", inquilinoId,
    inicio: `2026-09-0${id.slice(-1)}T13:00:00Z`, fin: `2026-09-0${id.slice(-1)}T14:00:00Z`,
  });
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId, concepto: "cargo_uso", montoCent,
    moneda: "ARS", periodo: PERIODO, fechaHecho: new Date(`2026-09-0${id.slice(-1)}T13:00:00Z`),
    clave: `cargo_uso:${id}`, reservaId: id,
  });
}

const conEmail = (id: string, email: string) => pgPool.query(`UPDATE "Inquilino" SET "email" = $2 WHERE id = $1`, [id, email]);

before(async () => {
  await reiniciarEsquema(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Operador","Usuario" CASCADE');
  await seedBase(pgPool);
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

// ── Cuándo corre ────────────────────────────────────────────────────────────

test("no corre un día cualquiera del mes", async () => {
  await reservaDeSeptiembre("oc1", "in1", 800_000n);
  await conEmail("in1", "perez@example.com");
  const b = buzon();

  const r = await envioMensual({ operadorId: "op1", hoy: "2026-08-15" }, db, b.mandar);
  assert.deepEqual(r, { corrio: false, motivo: "no_es_el_dia" });
  assert.equal(b.enviados.length, 0);
  // Y tampoco emite: un cierre a destiempo sella cargos que todavía podían moverse.
  assert.equal(await db.liquidacion.count(), 0);
});

test("no corre el último día del mes si ese día cae domingo", async () => {
  // 31/05/2026 es domingo: el hábil fue el viernes 29. Mandar un domingo significa que nadie lo
  // lee hasta el lunes, con el vencimiento un día más cerca.
  const b = buzon();
  const r = await envioMensual({ operadorId: "op1", hoy: "2026-05-31" }, db, b.mandar);
  assert.deepEqual(r, { corrio: false, motivo: "no_es_el_dia" });
});

test("corre el último día hábil", async () => {
  await reservaDeSeptiembre("oc1", "in1", 800_000n);
  await conEmail("in1", "perez@example.com");
  const b = buzon();

  const r = await envioMensual({ operadorId: "op1", hoy: ULTIMO_HABIL }, db, b.mandar);
  assert.ok(!("corrio" in r));
  assert.equal(r.enviadas, 1);
  assert.equal(b.enviados.length, 1);
});

// ── Qué mes factura ─────────────────────────────────────────────────────────

test("factura el mes que VIENE, no el que pasó", async () => {
  // El centro cobra a mes entrante: el 31 de agosto se cobra septiembre.
  await reservaDeSeptiembre("oc1", "in1", 800_000n);
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId: "in1", concepto: "cargo_uso", montoCent: 9_999_999n,
    moneda: "ARS", periodo: "2026-08", fechaHecho: new Date("2026-08-10T13:00:00Z"), clave: "viejo:1",
  });
  await conEmail("in1", "perez@example.com");
  const b = buzon();

  const r = await envioMensual({ operadorId: "op1", hoy: ULTIMO_HABIL }, db, b.mandar);
  assert.ok(!("corrio" in r));
  assert.equal(r.periodo, PERIODO);

  const liq = await db.liquidacion.findFirstOrThrow({ where: { operadorId: "op1", inquilinoId: "in1" } });
  assert.equal(liq.periodo, PERIODO);
  assert.equal(liq.totalCent, 800_000n, "el cargo de agosto no entra en el papel de septiembre");
});

test("el vencimiento cae dentro del mes facturado", async () => {
  await reservaDeSeptiembre("oc1", "in1", 800_000n);
  await conEmail("in1", "perez@example.com");
  await envioMensual({ operadorId: "op1", hoy: ULTIMO_HABIL }, db, buzon().mandar);

  const liq = await db.liquidacion.findFirstOrThrow({ where: { operadorId: "op1" } });
  // Día 7 por default: septiembre se paga el 7 de septiembre, no el 7 de octubre.
  assert.equal(liq.venceEl.toISOString().slice(0, 10), "2026-09-07");
});

// ── Que no mande dos veces ──────────────────────────────────────────────────

test("una segunda corrida el mismo día no manda nada de nuevo", async () => {
  await reservaDeSeptiembre("oc1", "in1", 800_000n);
  await conEmail("in1", "perez@example.com");

  const a = buzon();
  await envioMensual({ operadorId: "op1", hoy: ULTIMO_HABIL }, db, a.mandar);
  const b = buzon();
  const segunda = await envioMensual({ operadorId: "op1", hoy: ULTIMO_HABIL }, db, b.mandar);

  assert.ok(!("corrio" in segunda));
  assert.equal(b.enviados.length, 0, "un segundo disparo del cron no puede duplicar los avisos");
  assert.equal(segunda.yaAvisadas, 1);
  assert.equal(await db.liquidacion.count(), 1, "ni emitir dos veces el mismo mes");
});

test("si el envío falla, NO se marca como avisada: hay que poder reintentar", async () => {
  await reservaDeSeptiembre("oc1", "in1", 800_000n);
  await conEmail("in1", "perez@example.com");

  const roto = buzon({ ok: false, motivo: "sin_configurar" });
  const r = await envioMensual({ operadorId: "op1", hoy: ULTIMO_HABIL }, db, roto.mandar);
  assert.ok(!("corrio" in r));
  assert.equal(r.enviadas, 0);
  assert.equal(r.fallidas.length, 1);

  const liq = await db.liquidacion.findFirstOrThrow({ where: { operadorId: "op1" } });
  assert.equal(liq.avisadaEl, null, "marcarla avisada tras un fallo la dejaría sin reintento");

  // Y al reintentar, sale.
  const b = buzon();
  const otra = await envioMensual({ operadorId: "op1", hoy: ULTIMO_HABIL }, db, b.mandar);
  assert.ok(!("corrio" in otra) && otra.enviadas === 1);
});

// ── Que un problema no arrastre a los demás ─────────────────────────────────

test("el que no tiene email no frena a los demás", async () => {
  await reservaDeSeptiembre("oc1", "in1", 800_000n);
  await reservaDeSeptiembre("oc2", "in2", 700_000n);
  await conEmail("in2", "gomez@example.com"); // in1 queda sin email
  const b = buzon();

  const r = await envioMensual({ operadorId: "op1", hoy: ULTIMO_HABIL }, db, b.mandar);
  assert.ok(!("corrio" in r));
  assert.equal(r.enviadas, 1);
  assert.equal(r.fallidas.length, 1);
  assert.equal(r.fallidas[0]!.motivo, "sin email cargado");
  assert.equal(b.enviados[0]!.para, "gomez@example.com");
  // Igual se le emitió la liquidación: el papel existe aunque no haya a dónde mandarlo.
  assert.equal(await db.liquidacion.count(), 2);
});

test("a quien no se le factura no se le emite ni se le manda nada", async () => {
  await reservaDeSeptiembre("oc1", "in1", 800_000n);
  await pgPool.query(`UPDATE "Inquilino" SET "facturable" = false, "email" = 'perez@example.com' WHERE id = 'in1'`);
  const b = buzon();

  const r = await envioMensual({ operadorId: "op1", hoy: ULTIMO_HABIL }, db, b.mandar);
  assert.ok(!("corrio" in r));
  assert.equal(r.enviadas, 0);
  assert.equal(await db.liquidacion.count(), 0, "emitirle sería fabricarle una deuda");
});

test("sin reservas cargadas no emite un papel en cero", async () => {
  await conEmail("in1", "perez@example.com");
  const b = buzon();

  const r = await envioMensual({ operadorId: "op1", hoy: ULTIMO_HABIL }, db, b.mandar);
  assert.ok(!("corrio" in r));
  assert.equal(r.enviadas, 0);
  assert.equal(await db.liquidacion.count(), 0);
  assert.equal(b.enviados.length, 0);
});

// ── Lo que dice el mail ─────────────────────────────────────────────────────

test("el mail habla del mes que viene y con el nombre limpio", async () => {
  await reservaDeSeptiembre("oc1", "in1", 800_000n);
  await pgPool.query(`UPDATE "Inquilino" SET "nombre" = 'Dra Perez (Pediatra)' WHERE id = 'in1'`);
  await conEmail("in1", "perez@example.com");
  const b = buzon();

  await envioMensual({ operadorId: "op1", hoy: ULTIMO_HABIL }, db, b.mandar);
  const m = b.enviados[0]!;
  assert.match(m.asunto, /septiembre de 2026/);
  assert.ok(m.texto.includes("Dra Perez"), "el nombre va");
  assert.equal(m.texto.includes("(Pediatra)"), false, "la especialidad no: el papel va dirigido a esa persona");
});
