// tests/integracion/rentabilidad.test.ts — el negocio, no la facturación (§5.9).
//
// Lo que se protege es la distinción que da sentido a toda la pantalla: DEVENGADO (facturado −
// gastos, "¿el modelo cierra?") contra CAJA (cobrado − gastos, "¿puedo pagar la luz?"). Un centro
// con buen devengado y mala caja no tiene un problema de precios sino de cobranza, y si los dos
// números se mezclan en uno solo, el problema que queda tapado se descubre tarde.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { rentabilidad } from "../../src/servicios/reportes/rentabilidad.ts";
import { gastosCon } from "../../src/servicios/plata/gastos.ts";
import { cobrosCon } from "../../src/servicios/plata/cobros.ts";
import { asentarIdempotente } from "../../src/servicios/plata/ledger.ts";
import { prisma } from "../../src/db/prisma.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: `${URL_DB}?connection_limit=20&pool_timeout=20` });

const OWNER = { usuarioId: "u1", operadorId: "op1", rol: "owner" as const, inquilinoId: null };
const { cargar: cargarGasto } = gastosCon(db);
const { registrar: registrarCobro } = cobrosCon(db);

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

/** Le carga a un profesional un consumo del mes (lo que haría una reserva). */
const facturar = (montoCent: bigint, periodo = "2026-08", inquilinoId = "in1") =>
  asentarIdempotente(db, {
    operadorId: "op1",
    inquilinoId,
    concepto: "cargo_uso",
    montoCent,
    moneda: "ARS",
    periodo,
    fechaHecho: new Date(`${periodo}-10T12:00:00.000Z`),
    clave: `cargo_uso:${periodo}:${inquilinoId}:${montoCent}`,
  });

const delMes = (periodo = "2026-08") => rentabilidad({ actor: OWNER, periodo }, db);

test("resultado devengado = facturado − gastos", async () => {
  await facturar(100_000_00n); // $100.000
  await cargarGasto(OWNER, { rubro: "servicios", detalle: "Luz", monto: 30_000, fecha: "2026-08-10" });

  const r = (await delMes())!;
  assert.equal(r.facturadoCent, 10_000_000n);
  assert.equal(r.gastosCent, 3_000_000n);
  assert.equal(r.resultadoDevengadoCent, 7_000_000n);
  assert.equal(r.margenDevengadoDecimas, 700, "70,0% de margen sobre lo facturado");
});

test("caja y devengado se separan: facturar no es cobrar", async () => {
  // Es el punto de toda la pantalla. Se factura 100.000, se cobra 40.000, se gastan 30.000.
  await facturar(100_000_00n);
  await registrarCobro(OWNER, { inquilinoId: "in1", monto: 40_000, medio: "transferencia", referencia: "TR-1", fecha: "2026-08-15" });
  await cargarGasto(OWNER, { rubro: "servicios", detalle: "Luz", monto: 30_000, fecha: "2026-08-10" });

  const r = (await delMes())!;
  assert.equal(r.resultadoDevengadoCent, 7_000_000n, "el mes GENERÓ 70.000");
  assert.equal(r.resultadoCajaCent, 1_000_000n, "pero por la cuenta pasaron 10.000");
  assert.equal(r.cobranzaDecimas, 400, "se cobró el 40,0% de lo facturado");
});

test("un mes puede generar y aun así quedar en rojo de caja", async () => {
  // Buen negocio, mala cobranza: el caso que un solo número esconde.
  await facturar(100_000_00n);
  await cargarGasto(OWNER, { rubro: "alquiler", detalle: "Alquiler", monto: 60_000, fecha: "2026-08-01" });

  const r = (await delMes())!;
  assert.ok(r.resultadoDevengadoCent > 0n, "devengado positivo");
  assert.ok(r.resultadoCajaCent < 0n, "caja negativa: no entró un peso y el alquiler se pagó igual");
  assert.equal(r.resultadoCajaCent, -6_000_000n);
});

test("los gastos anulados no bajan el resultado", async () => {
  await facturar(100_000_00n);
  await cargarGasto(OWNER, { rubro: "servicios", detalle: "Luz", monto: 30_000, fecha: "2026-08-10" });
  const g = await db.gasto.findFirstOrThrow({ select: { id: true } });
  await db.gasto.update({ where: { id: g.id }, data: { anuladoEl: new Date(), motivoAnulado: "duplicada" } });

  const r = (await delMes())!;
  assert.equal(r.gastosCent, 0n);
  assert.equal(r.resultadoDevengadoCent, 10_000_000n);
});

test("la historia trae seis meses, del más viejo al más nuevo, sin huecos", async () => {
  await facturar(50_000_00n, "2026-06");
  await facturar(100_000_00n, "2026-08");
  await cargarGasto(OWNER, { rubro: "limpieza", detalle: "Limpieza", monto: 20_000, fecha: "2026-06-05" });

  const r = (await delMes())!;
  assert.equal(r.historia.length, 6);
  assert.deepEqual(r.historia.map((m) => m.periodo), ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);

  // Un mes sin movimiento vale 0, no se saltea: un hueco en la serie rompe la lectura de tendencia.
  const julio = r.historia.find((m) => m.periodo === "2026-07")!;
  assert.equal(julio.facturadoCent, 0n);
  assert.equal(julio.resultadoCent, 0n);

  const junio = r.historia.find((m) => m.periodo === "2026-06")!;
  assert.equal(junio.facturadoCent, 5_000_000n);
  assert.equal(junio.gastosCent, 2_000_000n);
  assert.equal(junio.resultadoCent, 3_000_000n);
});

test("el mes pedido es el último de la historia", async () => {
  const r = (await delMes("2026-05"))!;
  assert.equal(r.historia[r.historia.length - 1]!.periodo, "2026-05");
  assert.equal(r.periodo, "2026-05");
});

test("sin facturación los porcentajes son 0, no infinito ni NaN", async () => {
  await cargarGasto(OWNER, { rubro: "servicios", detalle: "Luz", monto: 30_000, fecha: "2026-08-10" });
  const r = (await delMes())!;
  assert.equal(r.margenDevengadoDecimas, 0);
  assert.equal(r.cobranzaDecimas, 0);
  // El resultado sí existe: se gastó sin facturar nada.
  assert.equal(r.resultadoDevengadoCent, -3_000_000n);
});

test("un profesional no ve la rentabilidad del centro", async () => {
  const inquilino = { usuarioId: "u2", operadorId: "op1", rol: "inquilino_titular" as const, inquilinoId: "in1" };
  assert.equal(await rentabilidad({ actor: inquilino, periodo: "2026-08" }, db), null);
});

test("un período mal formado devuelve null en vez de consultar", async () => {
  assert.equal(await rentabilidad({ actor: OWNER, periodo: "agosto" }, db), null);
});
