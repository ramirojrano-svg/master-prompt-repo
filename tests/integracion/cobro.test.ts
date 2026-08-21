// tests/integracion/cobro.test.ts — los datos de transferencia y las horas del mes.
//
// El papel decía cuánto hay que pagar y no a dónde, así que el circuito terminaba igual en un
// WhatsApp preguntando el alias. Lo que se prueba acá es que esos datos lleguen al documento, y
// que el total de horas del mes sea el que el profesional puede verificar contra su agenda —si
// ese número no cierra, el resto del papel deja de creerse.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { cobroCon, datosDeCobro, hayDatosDeCobro } from "../../src/servicios/config/cobro.ts";
import { detalleDeLiquidacion } from "../../src/servicios/plata/detalle-liquidacion.ts";
import { cerrarPeriodo } from "../../src/servicios/plata/liquidacion.ts";
import { asentarIdempotente } from "../../src/servicios/plata/ledger.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { insertarOcupacion, nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });
const cobro = cobroCon(db);

const owner: Actor = { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null };
const profesional: Actor = { usuarioId: "u2", operadorId: "op1", rol: "inquilino_titular", inquilinoId: "in1" };
const PERIODO = "2026-08";

const COMPLETO = {
  titular: "Ramiro Julian Raño", cuit: "20-39770377-0", cbu: "0000177500099146760167",
  alias: "ramirorano.astropay", banco: "Astropay", nota: null, diaVencimiento: 7,
};

/** Una sesión con su cargo, para que la liquidación tenga renglones de verdad. */
async function sesion(id: string, desde: string, hasta: string, montoCent: bigint) {
  await insertarOcupacion(pgPool, {
    id, salaId: "sa1", inquilinoId: "in1",
    inicio: `2026-08-12T${desde}:00Z`, fin: `2026-08-12T${hasta}:00Z`,
  });
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId: "in1", concepto: "cargo_uso", montoCent,
    moneda: "ARS", periodo: PERIODO, fechaHecho: new Date(`2026-08-12T${desde}:00Z`),
    clave: `cargo_uso:${id}`, reservaId: id,
  });
}

async function cerrar() {
  const r = await cerrarPeriodo({
    operadorId: "op1", inquilinoId: "in1", periodo: PERIODO, alicuotaDecimas: 0,
    venceEl: new Date("2026-09-07T12:00:00Z"), receptorRazonSocial: "Dra Perez", receptorCondIva: "no informada",
  }, db);
  assert.ok(r.ok);
  return r.liquidacionId;
}

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

// ── Guardar y leer ──────────────────────────────────────────────────────────

test("los datos de cobro se guardan y se leen enteros", async () => {
  const r = await cobro(owner, COMPLETO);
  assert.ok(r.ok);

  const d = await datosDeCobro("op1", db);
  assert.equal(d.titular, "Ramiro Julian Raño");
  assert.equal(d.cbu, "0000177500099146760167");
  assert.equal(d.alias, "ramirorano.astropay");
  assert.equal(d.diaVencimiento, 7);
});

test("un campo vacío se guarda como NULL, no como cadena vacía", async () => {
  // Si guardara "", el `if (cobro.banco)` del documento daría falso igual pero la base quedaría
  // con dos formas de decir lo mismo. Una sola.
  await cobro(owner, { ...COMPLETO, banco: "   " });
  const d = await datosDeCobro("op1", db);
  assert.equal(d.banco, null);
});

test("sin nada cargado no hay bloque que dibujar", async () => {
  const d = await datosDeCobro("op1", db);
  assert.equal(hayDatosDeCobro(d), false, "un recuadro vacío es peor que ningún recuadro");
  assert.equal(d.diaVencimiento, 7, "el día de vencimiento arranca en 7 igual");
});

test("un día de vencimiento que no existe en febrero se rechaza", async () => {
  // 28 es el techo: una fecha que algunos meses no existe es una fecha que algún mes falla.
  const r = await cobro(owner, { ...COMPLETO, diaVencimiento: 30 });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error, "ENTRADA_INVALIDA");
});

test("un profesional no puede tocar los datos de cobro del centro", async () => {
  const r = await cobro(profesional, COMPLETO);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error, "SIN_PERMISO");
  assert.equal((await datosDeCobro("op1", db)).cbu, null);
});

// ── El total de horas del mes ───────────────────────────────────────────────

test("el documento dice cuántas horas usó en el mes y en cuántas sesiones", async () => {
  await sesion("oc1", "13", "16", 2_400_000n); // 3 h
  await sesion("oc2", "17", "18", 800_000n); //  1 h
  const id = await cerrar();

  const d = await detalleDeLiquidacion({ operadorId: "op1", liquidacionId: id }, db);
  assert.ok(d);
  assert.equal(d.minutosUsados, 240, "3 h + 1 h");
  assert.equal(d.sesiones, 2);
  assert.equal(d.lineas.length, 2, "y abajo queda la discriminación día por día");
});

test("un cargo que no es una hora de consultorio no infla el total de horas", async () => {
  await sesion("oc1", "13", "16", 2_400_000n); // 3 h
  // Una penalidad no tiene reserva detrás: sumarla como si fueran horas mentiría el número que el
  // profesional va a contrastar con su propia agenda.
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId: "in1", concepto: "penalidad_tardia", montoCent: 500_000n,
    moneda: "ARS", periodo: PERIODO, fechaHecho: new Date("2026-08-12T12:00:00Z"), clave: "pen:1",
  });
  const id = await cerrar();

  const d = await detalleDeLiquidacion({ operadorId: "op1", liquidacionId: id }, db);
  assert.ok(d);
  assert.equal(d.minutosUsados, 180, "solo las horas de consultorio");
  assert.equal(d.sesiones, 1);
  assert.equal(d.lineas.length, 2, "pero la penalidad sí figura como renglón");
  assert.equal(d.totalCent, 2_900_000n, "y sí suma al total a pagar");
});
