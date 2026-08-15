// tests/integracion/gastos.test.ts — lo que cuesta tener el espacio abierto (§5.9).
//
// Lo que se protege: que el gasto caiga en el mes en que se GASTÓ y no en el que se cargó, que
// anular deje rastro y deje de sumar, y que un gasto NO toque la cuenta corriente de nadie —que
// es la razón por la que vive en su propio libro y no entre los asientos.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { gastosCon, gastosDelMes, totalGastos } from "../../src/servicios/plata/gastos.ts";
import { saldoCorriente } from "../../src/servicios/plata/ledger.ts";
import { prisma } from "../../src/db/prisma.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: `${URL_DB}?connection_limit=20&pool_timeout=20` });

const OWNER = { usuarioId: "u1", operadorId: "op1", rol: "owner" as const, inquilinoId: null };
const { cargar: cargarGasto, anular: anularGasto } = gastosCon(db);

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Gasto", "Asiento" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

const luz = { rubro: "servicios" as const, detalle: "Factura de luz", monto: 85_000, fecha: "2026-08-10" };

test("un gasto queda cargado en el mes de su fecha", async () => {
  const r = await cargarGasto(OWNER, luz);
  assert.ok(r.ok && r.data.ok);

  const { gastos, totalCent } = await gastosDelMes({ operadorId: "op1", periodo: "2026-08" }, db);
  assert.equal(gastos.length, 1);
  assert.equal(totalCent, 8_500_000n); // $85.000 en centavos
  assert.equal(gastos[0]!.rubro, "servicios");
});

test("la fecha manda sobre el mes, no el día en que se carga", async () => {
  // Una factura del 31 de agosto que se carga el 3 de septiembre es un costo de AGOSTO. Si no, el
  // mes que ya se miró cambia solo.
  await cargarGasto(OWNER, { ...luz, fecha: "2026-08-31" });
  assert.equal(await totalGastos({ operadorId: "op1", periodo: "2026-08" }, db), 8_500_000n);
  assert.equal(await totalGastos({ operadorId: "op1", periodo: "2026-09" }, db), 0n);
});

test("los rubros se discriminan y se ordenan de mayor a menor", async () => {
  await cargarGasto(OWNER, { rubro: "servicios", detalle: "Luz", monto: 85_000, fecha: "2026-08-10" });
  await cargarGasto(OWNER, { rubro: "servicios", detalle: "Internet", monto: 15_000, fecha: "2026-08-11" });
  await cargarGasto(OWNER, { rubro: "limpieza", detalle: "Limpieza mensual", monto: 120_000, fecha: "2026-08-05" });
  await cargarGasto(OWNER, { rubro: "mantenimiento", detalle: "Plomero", monto: 40_000, fecha: "2026-08-20" });

  const { porRubro, totalCent } = await gastosDelMes({ operadorId: "op1", periodo: "2026-08" }, db);
  // limpieza 120.000 · servicios 100.000 (85+15, sumados en un solo rubro) · mantenimiento 40.000
  assert.deepEqual(
    porRubro.map((r) => [r.rubro, r.montoCent]),
    [["limpieza", 12_000_000n], ["servicios", 10_000_000n], ["mantenimiento", 4_000_000n]],
  );
  assert.equal(totalCent, 26_000_000n);
});

test("anular deja el gasto a la vista pero fuera del total", async () => {
  await cargarGasto(OWNER, luz);
  await cargarGasto(OWNER, { rubro: "limpieza", detalle: "Limpieza", monto: 120_000, fecha: "2026-08-05" });

  const antes = await gastosDelMes({ operadorId: "op1", periodo: "2026-08" }, db);
  assert.equal(antes.totalCent, 20_500_000n);

  const laLuz = antes.gastos.find((g) => g.detalle === "Factura de luz")!;
  const r = await anularGasto(OWNER, { gastoId: laLuz.id, motivo: "estaba duplicada" });
  assert.ok(r.ok && r.data.ok);

  const despues = await gastosDelMes({ operadorId: "op1", periodo: "2026-08" }, db);
  // Sigue listado —para poder explicar qué pasó— y con el motivo, pero ya no suma.
  assert.equal(despues.gastos.length, 2);
  assert.equal(despues.gastos.find((g) => g.id === laLuz.id)!.anulado, true);
  assert.equal(despues.gastos.find((g) => g.id === laLuz.id)!.motivoAnulado, "estaba duplicada");
  assert.equal(despues.totalCent, 12_000_000n);
  // Y desaparece del corte por rubro: ahí solo va lo que se puede defender.
  assert.deepEqual(despues.porRubro.map((r2) => r2.rubro), ["limpieza"]);
});

test("anular dos veces no rompe ni cambia el motivo original", async () => {
  await cargarGasto(OWNER, luz);
  const [g] = (await gastosDelMes({ operadorId: "op1", periodo: "2026-08" }, db)).gastos;

  await anularGasto(OWNER, { gastoId: g!.id, motivo: "el primero" });
  const segunda = await anularGasto(OWNER, { gastoId: g!.id, motivo: "el segundo" });

  assert.ok(segunda.ok && !segunda.data.ok && segunda.data.error === "YA_ANULADO");
  const despues = await gastosDelMes({ operadorId: "op1", periodo: "2026-08" }, db);
  assert.equal(despues.gastos[0]!.motivoAnulado, "el primero", "el motivo original no se pisa");
});

test("un gasto NO toca la cuenta corriente de ningún profesional", async () => {
  // Es la razón por la que los gastos viven en su propio libro: la factura de luz no la debe
  // nadie, y meterla entre los asientos ensuciaría los saldos.
  await cargarGasto(OWNER, luz);
  assert.equal(await saldoCorriente(db, { operadorId: "op1", inquilinoId: "in1" }), 0n);
  assert.equal(await db.asiento.count(), 0);
});

test("un mes sin gastos da cero, no rompe", async () => {
  const r = await gastosDelMes({ operadorId: "op1", periodo: "2026-08" }, db);
  assert.deepEqual(r, { gastos: [], porRubro: [], totalCent: 0n });
});

test("un período mal formado devuelve vacío en vez de consultar", async () => {
  assert.deepEqual(await gastosDelMes({ operadorId: "op1", periodo: "agosto" }, db), { gastos: [], porRubro: [], totalCent: 0n });
});

test("los gastos de otro centro no se ven", async () => {
  await cargarGasto(OWNER, luz);
  assert.equal(await totalGastos({ operadorId: "op-otro", periodo: "2026-08" }, db), 0n);
});

test("un profesional no puede cargar gastos del espacio", async () => {
  // Cuánto sale la luz es información del centro, no de quien alquila una hora.
  const inquilino = { usuarioId: "u2", operadorId: "op1", rol: "inquilino_titular" as const, inquilinoId: "in1" };
  const r = await cargarGasto(inquilino, luz);
  assert.ok(!r.ok, "tiene que rechazarse por permisos");
});
