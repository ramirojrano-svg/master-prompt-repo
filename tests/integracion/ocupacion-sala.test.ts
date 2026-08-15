// tests/integracion/ocupacion-sala.test.ts — la ocupación por consultorio de la agenda.
//
// La agenda muestra una barrita por consultorio en su lateral y no puede llamar a `reporteMensual`
// (pide permiso de finanzas, que un profesional no tiene). Así que hay DOS funciones que calculan
// ocupación, y el riesgo real no es que una esté mal: es que se separen con el tiempo y la agenda
// diga 30% donde Métricas dice 34%. Los dos números parecen correctos y explicar cuál vale se
// vuelve imposible.
//
// Este test compara las dos salidas para el mismo período. Si alguien toca el criterio de "hora
// vendida" o el denominador en un lado y no en el otro, falla acá y no en una discusión.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { ocupacionMensualPorSala, reporteMensual } from "../../src/servicios/reportes/mensual.ts";
import { prisma } from "../../src/db/prisma.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: `${URL_DB}?connection_limit=20&pool_timeout=20` });

const OWNER = { usuarioId: "u1", operadorId: "op1", rol: "owner" as const, inquilinoId: null };
const PERIODO = "2026-08";

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

test("da EXACTAMENTE lo mismo que la tabla por consultorio de Métricas", async () => {
  const reporte = await reporteMensual({ actor: OWNER, periodo: PERIODO }, db);
  assert.ok(reporte, "el reporte tiene que existir");

  const agenda = await ocupacionMensualPorSala({ operadorId: "op1", periodo: PERIODO }, db);
  const porId = new Map(agenda.map((o) => [o.salaId, o]));

  for (const s of reporte.salas) {
    const o = porId.get(s.id);
    assert.ok(o, `falta ${s.nombre} en la ocupación de la agenda`);
    assert.equal(o.minutos, s.minutos, `minutos de ${s.nombre}`);
    assert.equal(o.aperturaMin, s.aperturaMin, `apertura de ${s.nombre}`);
    assert.equal(o.pct, s.ocupacionPct, `porcentaje de ${s.nombre}`);
  }
});

test("un consultorio sin turnos da 0% y no rompe", async () => {
  const r = await ocupacionMensualPorSala({ operadorId: "op1", periodo: "2027-01" }, db);
  assert.ok(r.length > 0, "los consultorios siguen listándose aunque no tengan turnos");
  assert.ok(r.every((o) => o.minutos === 0 && o.pct === 0));
});

test("el porcentaje nunca se inventa: sin apertura, 0", async () => {
  // Es la regla del reporte para una sala archivada, que dejó de abrir: denominador 0 ⇒ no hay
  // porcentaje que mostrar. Mejor un guion que un número que no se puede auditar.
  const r = await ocupacionMensualPorSala({ operadorId: "op1", periodo: PERIODO }, db);
  for (const o of r) {
    if (o.aperturaMin === 0) assert.equal(o.pct, 0, "sin denominador no hay porcentaje");
    assert.ok(o.pct >= 0 && o.pct <= 100, `porcentaje fuera de rango: ${o.pct}`);
  }
});

test("un período mal formado devuelve vacío en vez de consultar", async () => {
  assert.deepEqual(await ocupacionMensualPorSala({ operadorId: "op1", periodo: "agosto" }, db), []);
});

test("los consultorios de otro centro no se cuentan", async () => {
  assert.deepEqual(await ocupacionMensualPorSala({ operadorId: "op-inexistente", periodo: PERIODO }, db), []);
});
