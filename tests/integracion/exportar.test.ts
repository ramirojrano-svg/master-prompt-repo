// tests/integracion/exportar.test.ts — los datos del mes, afuera.
//
// La exportación no tiene lógica de negocio, y justamente por eso hay que probarla: lo que puede
// salir mal es silencioso. Una columna corrida por un nombre con coma, un importe con la coma
// decimal que Excel lee como separador, una reserva de otro mes colada en la planilla — nada de
// eso tira error, solo da un archivo con números que no cierran y que nadie va a auditar.
//
// Lo que se fija acá:
//  · El recorte por período: lo que entra y lo que NO.
//  · La plata como número con punto, que es lo único que Excel suma.
//  · El nombre del profesional, que en `Asiento` no viene por relación sino por diccionario.
//  · Que "sin consultorio" se escriba como tal y no quede una celda vacía.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { exportarCsv, queExportar } from "../../src/servicios/reportes/exportar.ts";
import { asentarIdempotente } from "../../src/servicios/plata/ledger.ts";
import { prisma } from "../../src/db/prisma.ts";
import { insertarOcupacion, nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });

const PERIODO = "2026-08";
const F = new Date("2026-08-12T12:00:00Z");

/** Las filas de datos, sin BOM ni encabezado: es lo que se quiere mirar en cada test. */
function filas(csv: string): string[] {
  const lineas = csv.replace(/^﻿/, "").split("\r\n").filter((l) => l !== "");
  return lineas.slice(1);
}
function encabezado(csv: string): string {
  return csv.replace(/^﻿/, "").split("\r\n")[0]!;
}

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Asiento","Ocupacion" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

// ── Movimientos ─────────────────────────────────────────────────────────────

test("los movimientos salen con el nombre del profesional y la plata con punto decimal", async () => {
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId: "in1", concepto: "cargo_uso",
    montoCent: 123_456n, moneda: "ARS", periodo: PERIODO, fechaHecho: F, clave: "c:1",
  });

  const csv = await exportarCsv({ operadorId: "op1", periodo: PERIODO, que: "movimientos" }, db);
  assert.ok(csv);
  const [fila] = filas(csv);
  assert.ok(fila);
  // El nombre no viene por relación (Asiento guarda inquilinoId suelto): si el diccionario falla,
  // acá queda la celda vacía y la planilla no sirve para nada.
  assert.ok(fila.includes("Dra Perez"), `esperaba el nombre en: ${fila}`);
  // $1.234,56 se escribe 1234.56 — con coma, Excel lo parte en dos columnas.
  assert.ok(fila.includes("1234.56"), `esperaba el importe con punto en: ${fila}`);
});

test("un pago sale en negativo, tal como está asentado", async () => {
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId: "in1", concepto: "pago",
    montoCent: -50_000n, moneda: "ARS", periodo: PERIODO, fechaHecho: F, clave: "p:1",
  });

  const csv = await exportarCsv({ operadorId: "op1", periodo: PERIODO, que: "movimientos" }, db);
  assert.ok(csv);
  assert.ok(filas(csv)[0]!.includes("-500.00"), "el signo es el que distingue un cobro de un cargo");
});

test("los movimientos de otro mes no entran", async () => {
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId: "in1", concepto: "cargo_uso",
    montoCent: 1_000n, moneda: "ARS", periodo: "2026-07", fechaHecho: new Date("2026-07-10T12:00:00Z"), clave: "c:julio",
  });

  const csv = await exportarCsv({ operadorId: "op1", periodo: PERIODO, que: "movimientos" }, db);
  assert.ok(csv);
  assert.equal(filas(csv).length, 0, "la planilla de agosto no puede traer plata de julio");
});

// ── Turnos ──────────────────────────────────────────────────────────────────

test("los turnos salen con profesional, consultorio y duración", async () => {
  await insertarOcupacion(pgPool, {
    id: "oc1", salaId: "sa1", inquilinoId: "in1",
    inicio: "2026-08-12T13:00:00Z", fin: "2026-08-12T15:00:00Z",
  });

  const csv = await exportarCsv({ operadorId: "op1", periodo: PERIODO, que: "turnos" }, db);
  assert.ok(csv);
  const [fila] = filas(csv);
  assert.ok(fila);
  assert.ok(fila.includes("Dra Perez"));
  assert.ok(fila.includes("Sala 1"));
  assert.ok(fila.includes("120"), `esperaba 120 minutos en: ${fila}`);
});

test("una reserva sin consultorio lo dice, no deja la celda vacía", async () => {
  await insertarOcupacion(pgPool, {
    id: "oc1", salaId: null, inquilinoId: "in1",
    inicio: "2026-08-12T13:00:00Z", fin: "2026-08-12T15:00:00Z",
  });

  const csv = await exportarCsv({ operadorId: "op1", periodo: PERIODO, que: "turnos" }, db);
  assert.ok(csv);
  // Una celda vacía se lee como "falta el dato"; acá el dato es que no usa consultorio.
  assert.ok(filas(csv)[0]!.includes("sin consultorio"));
});

test("los turnos del mes siguiente quedan afuera", async () => {
  await insertarOcupacion(pgPool, {
    id: "oc1", salaId: "sa1", inquilinoId: "in1",
    inicio: "2026-09-01T13:00:00Z", fin: "2026-09-01T15:00:00Z",
  });

  const csv = await exportarCsv({ operadorId: "op1", periodo: PERIODO, que: "turnos" }, db);
  assert.ok(csv);
  assert.equal(filas(csv).length, 0);
});

test("un bloqueo de sala no es un turno y no se exporta", async () => {
  await insertarOcupacion(pgPool, {
    id: "oc1", salaId: "sa1", inquilinoId: null, tipo: "bloqueo",
    inicio: "2026-08-12T13:00:00Z", fin: "2026-08-12T15:00:00Z",
  });

  const csv = await exportarCsv({ operadorId: "op1", periodo: PERIODO, que: "turnos" }, db);
  assert.ok(csv);
  assert.equal(filas(csv).length, 0, "la planilla de turnos es de lo que se le cobra a alguien");
});

// ── Bordes ──────────────────────────────────────────────────────────────────

test("un período inválido devuelve null en vez de una planilla vacía", async () => {
  for (const p of ["", "2026-13", "agosto", "2026-8"]) {
    assert.equal(await exportarCsv({ operadorId: "op1", periodo: p, que: "movimientos" }, db), null, p);
  }
});

test("el CSV vacío igual trae encabezados: se abre en Excel y se entiende", async () => {
  const csv = await exportarCsv({ operadorId: "op1", periodo: PERIODO, que: "movimientos" }, db);
  assert.ok(csv);
  assert.ok(csv.startsWith("﻿"), "sin BOM, Excel rompe los acentos");
  assert.equal(encabezado(csv), "fecha,profesional,concepto,monto,moneda,medio,comprobante,liquidacion,clave");
});

test("lo que no sea 'turnos' es la plata: la URL no puede pedir una tercera cosa", () => {
  assert.equal(queExportar("turnos"), "turnos");
  assert.equal(queExportar("movimientos"), "movimientos");
  assert.equal(queExportar(null), "movimientos");
  assert.equal(queExportar("../../etc/passwd"), "movimientos");
});
