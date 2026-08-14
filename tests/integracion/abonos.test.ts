// tests/integracion/abonos.test.ts — el abono mensual de los que no alquilan por hora (§4.12).
//
// Lo que se protege: que apretar "cobrar el mes" dos veces NO cobre dos veces (es un botón que
// un operador va a apretar sin acordarse si ya lo hizo), que cambiar el abono no reescriba lo
// que ya se cobró, y que el cargo caiga en el mes que se factura y no en el de hoy.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { abonosCon, abonosVigentes } from "../../src/servicios/config/abonos.ts";
import { prisma } from "../../src/db/prisma.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: `${URL_DB}?connection_limit=20&pool_timeout=20` });

// El actor del panel: dueño del centro op1.
const OWNER = { usuarioId: "u1", operadorId: "op1", rol: "owner" as const, inquilinoId: null };

// Acciones atadas a la base DE TEST. Sin esto escriben por el cliente global (`prisma`), que en
// otra corrida apunta a la base de desarrollo: el test pasaría ensuciando datos reales.
const { poner: ponerAbonoMensual, cobrar: cobrarAbonosDelMes } = abonosCon(db);

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Membresia", "Asiento" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

const cargos = () => db.asiento.findMany({ where: { concepto: "cargo_membresia" }, select: { inquilinoId: true, montoCent: true, periodo: true, fechaHecho: true } });

test("poner un abono lo deja vigente, con 0 minutos incluidos", async () => {
  const r = await ponerAbonoMensual(OWNER, { inquilinoId: "in1", montoMensual: 250_000 });
  assert.ok(r.ok && r.data.ok, "no se pudo poner el abono");

  const vigentes = await abonosVigentes("op1", db);
  assert.equal(vigentes.length, 1);
  assert.equal(vigentes[0]!.precioMensualCent, 25_000_000n); // $250.000 en centavos
  const m = await db.membresia.findFirstOrThrow({ select: { minutosIncluidos: true } });
  assert.equal(m.minutosIncluidos, 0, "un abono no incluye horas: el que lo paga no alquila");
});

test("cambiar el abono cierra el anterior en vez de editarlo", async () => {
  await ponerAbonoMensual(OWNER, { inquilinoId: "in1", montoMensual: 250_000 });
  await ponerAbonoMensual(OWNER, { inquilinoId: "in1", montoMensual: 300_000 });

  // Dos filas en total, una sola vigente: lo que ya se cobró sigue explicándose con su importe.
  assert.equal(await db.membresia.count(), 2);
  const vigentes = await abonosVigentes("op1", db);
  assert.equal(vigentes.length, 1);
  assert.equal(vigentes[0]!.precioMensualCent, 30_000_000n);
});

test("poner 0 da de baja el abono", async () => {
  await ponerAbonoMensual(OWNER, { inquilinoId: "in1", montoMensual: 250_000 });
  await ponerAbonoMensual(OWNER, { inquilinoId: "in1", montoMensual: 0 });
  assert.equal((await abonosVigentes("op1", db)).length, 0);
  assert.equal(await db.membresia.count(), 1, "la fila queda: la historia no se borra");
});

test("cobrar el mes carga un asiento por abono vigente", async () => {
  await ponerAbonoMensual(OWNER, { inquilinoId: "in1", montoMensual: 250_000 });
  await ponerAbonoMensual(OWNER, { inquilinoId: "in2", montoMensual: 250_000 });

  const r = await cobrarAbonosDelMes(OWNER, { periodo: "2026-08" });
  assert.ok(r.ok && r.data.cobrados === 2 && r.data.totalCent === 50_000_000n);

  const filas = await cargos();
  assert.equal(filas.length, 2);
  assert.ok(filas.every((f) => f.periodo === "2026-08"));
  // El hecho económico se fecha en el mes COBRADO, no "hoy": cobrar agosto en septiembre no
  // puede mandar la plata a septiembre.
  assert.ok(filas.every((f) => f.fechaHecho.toISOString().startsWith("2026-08-01")));
});

test("apretar dos veces NO cobra dos veces", async () => {
  // Es el punto de todo: es un botón que el operador va a apretar sin acordarse si ya lo hizo.
  await ponerAbonoMensual(OWNER, { inquilinoId: "in1", montoMensual: 250_000 });
  await cobrarAbonosDelMes(OWNER, { periodo: "2026-08" });

  const segunda = await cobrarAbonosDelMes(OWNER, { periodo: "2026-08" });
  assert.ok(segunda.ok && segunda.data.cobrados === 0 && segunda.data.yaEstaban === 1);
  assert.equal((await cargos()).length, 1);
});

test("cada mes se cobra por separado", async () => {
  await ponerAbonoMensual(OWNER, { inquilinoId: "in1", montoMensual: 250_000 });
  await cobrarAbonosDelMes(OWNER, { periodo: "2026-08" });
  await cobrarAbonosDelMes(OWNER, { periodo: "2026-09" });

  const filas = await cargos();
  assert.equal(filas.length, 2);
  assert.deepEqual(filas.map((f) => f.periodo).sort(), ["2026-08", "2026-09"]);
});

test("un abono dado de baja deja de cobrarse", async () => {
  await ponerAbonoMensual(OWNER, { inquilinoId: "in1", montoMensual: 250_000 });
  await ponerAbonoMensual(OWNER, { inquilinoId: "in1", montoMensual: 0 });

  const r = await cobrarAbonosDelMes(OWNER, { periodo: "2026-08" });
  assert.ok(r.ok && r.data.cobrados === 0);
  assert.equal((await cargos()).length, 0);
});

test("un profesional de otro centro no existe acá", async () => {
  const r = await ponerAbonoMensual(OWNER, { inquilinoId: "no-existe", montoMensual: 250_000 });
  assert.ok(r.ok && !r.data.ok && r.data.error === "INQUILINO_INEXISTENTE");
});
