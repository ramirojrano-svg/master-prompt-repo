// tests/integracion/cancelar-turno.test.ts — dar de baja un turno desde el panel (§4.10).
//
// Lo que se protege: que cancelar libere la sala DE VERDAD (si no, el hueco no se puede volver a
// vender) y que la plata se devuelva una sola vez, sin borrar el cargo original y sin tocar un
// mes ya liquidado.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { crearOcupacion, type CtxReserva } from "../../src/servicios/reservas/crear.ts";
import { cancelarOcupacion } from "../../src/servicios/reservas/cancelar.ts";
import { marcarNoShow } from "../../src/servicios/reservas/no-show.ts";
import { prisma } from "../../src/db/prisma.ts";
import { insertarOcupacion, nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: `${URL_DB}?connection_limit=20&pool_timeout=20` });

const abierto = [{ desde: "08:00", hasta: "22:00" }];
const HORARIO: CtxReserva["horario"] = { 0: abierto, 1: abierto, 2: abierto, 3: abierto, 4: abierto, 5: abierto, 6: abierto };
const POLITICA: CtxReserva["politica"] = { pasoMin: 30, duracionMinMin: 15, duracionMaxMin: 720, bufferMin: 0, bufferMismoInquilino: 0, antelacionMinMin: 0, horizonteDias: 3650 };
const AHORA = new Date("2026-08-01T00:00:00Z");
const CTX = { operadorId: "op1" };

function ctxCrear(inquilinoId: string): CtxReserva {
  return { operadorId: "op1", inquilinoId, politica: POLITICA, horario: HORARIO, bloqueaProfesional: true, ahora: AHORA };
}
// 10:00 AR = 13:00Z.
const req = (salaId: string, fecha: string) => ({ salaId, fecha, inicioISO: `${fecha}T13:00:00.000Z`, duracionMin: 60 });

async function crear(salaId = "sa1", fecha = "2026-08-12", inq = "in1"): Promise<string> {
  const r = await crearOcupacion(req(salaId, fecha), ctxCrear(inq), db);
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.ok ? r.id : "";
}

async function tarifaGeneral(precioHoraCent: bigint) {
  await pgPool.query(
    `INSERT INTO "Tarifa"("id","operadorId","nombre","precioHoraCent","vigenteDesde") VALUES('ta1','op1','General',$1,'2020-01-01T00:00:00Z')`,
    [precioHoraCent.toString()],
  );
}

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Ocupacion", "Tarifa", "Asiento" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

test("cancelar deja la fila en `cancelada`", async () => {
  const id = await crear();
  const r = await cancelarOcupacion({ ocupacionId: id, motivo: "el profesional avisó" }, CTX, db);
  assert.ok(r.ok, r.ok ? "" : r.error);

  const f = await db.ocupacion.findUniqueOrThrow({ where: { id }, select: { estado: true, motivo: true } });
  assert.equal(f.estado, "cancelada");
  assert.equal(f.motivo, "el profesional avisó");
});

test("la sala queda LIBRE: el hueco se puede volver a vender", async () => {
  // Es el punto de todo: si cancelar no libera, el turno cancelado sigue bloqueando la hora y el
  // consultorio se queda vacío igual.
  const id = await crear();
  const choca = await crearOcupacion(req("sa1", "2026-08-12"), ctxCrear("in2"), db);
  assert.deepEqual(choca, { ok: false, error: "SLOT_OCUPADO" });

  assert.ok((await cancelarOcupacion({ ocupacionId: id }, CTX, db)).ok);

  const despues = await crearOcupacion(req("sa1", "2026-08-12"), ctxCrear("in2"), db);
  assert.ok(despues.ok, "después de cancelar, esa hora tiene que poder venderse de nuevo");
});

test("la plata se devuelve entera y el cargo original NO se borra", async () => {
  await tarifaGeneral(800_000n);
  const id = await crear();

  const r = await cancelarOcupacion({ ocupacionId: id, motivo: "obra en el consultorio" }, CTX, db);
  assert.ok(r.ok && r.devueltoCent === 800_000n);

  const asientos = await db.asiento.findMany({ where: { reservaId: id }, orderBy: { concepto: "asc" }, select: { concepto: true, montoCent: true, revierteAId: true, periodo: true } });
  assert.equal(asientos.length, 2, "tienen que quedar los DOS: el cargo y su reversa");
  const cargo = asientos.find((a) => a.concepto === "cargo_uso");
  const nota = asientos.find((a) => a.concepto === "nota_credito");
  assert.equal(cargo?.montoCent, 800_000n);
  assert.equal(nota?.montoCent, -800_000n);
  assert.equal(nota?.revierteAId, (await db.asiento.findFirstOrThrow({ where: { concepto: "cargo_uso", reservaId: id }, select: { id: true } })).id);
  // La reversa va al mes del cargo: ese mes vuelve a reflejar que el turno no ocurrió.
  assert.equal(nota?.periodo, cargo?.periodo);

  // Neto cero: el profesional no debe nada por un turno que no pasó.
  const suma = asientos.reduce((a, x) => a + x.montoCent, 0n);
  assert.equal(suma, 0n);
});

test("cancelar dos veces no devuelve dos veces", async () => {
  await tarifaGeneral(800_000n);
  const id = await crear();
  assert.ok((await cancelarOcupacion({ ocupacionId: id }, CTX, db)).ok);

  const segunda = await cancelarOcupacion({ ocupacionId: id }, CTX, db);
  assert.deepEqual(segunda, { ok: false, error: "YA_CANCELADA" });
  assert.equal(await db.asiento.count({ where: { concepto: "nota_credito" } }), 1);
});

test("un turno sin precio cargado se cancela igual, sin devolver nada", async () => {
  const id = await crear(); // sin tarifa vigente: importe NULL, no hay cargo
  const r = await cancelarOcupacion({ ocupacionId: id }, CTX, db);
  assert.ok(r.ok && r.devueltoCent === 0n);
  assert.equal(await db.asiento.count(), 0);
});

test("un turno ya usado o ausente está congelado: no se cancela", async () => {
  const id = await crear();
  assert.deepEqual(await marcarNoShow({ ocupacionId: id }, CTX, db), { ok: true });
  assert.deepEqual(await cancelarOcupacion({ ocupacionId: id }, CTX, db), { ok: false, error: "CONGELADA" });
});

test("un bloqueo no es un turno de nadie", async () => {
  await insertarOcupacion(pgPool, {
    id: "bloq", salaId: "sa1", inquilinoId: null, estado: "confirmada", tipo: "bloqueo",
    inicio: "2026-08-12T13:00:00Z", fin: "2026-08-12T14:00:00Z",
  });
  assert.deepEqual(await cancelarOcupacion({ ocupacionId: "bloq" }, CTX, db), { ok: false, error: "NO_CANCELABLE" });
});

test("un turno de otro centro no existe acá", async () => {
  assert.deepEqual(await cancelarOcupacion({ ocupacionId: "no-existe" }, CTX, db), { ok: false, error: "NO_ENCONTRADA" });
});

test("si el mes ya se liquidó no se cancela, y la fila queda intacta", async () => {
  await tarifaGeneral(800_000n);
  const id = await crear();
  await pgPool.query(`
    INSERT INTO "Liquidacion"("id","operadorId","inquilinoId","periodo","numero","estado",
      "subtotalCent","netoCent","ivaCent","alicuota","totalCent","venceEl",
      "receptorRazonSocial","receptorCondIva")
    VALUES('li1','op1','in1','2026-08',1,'emitida',800000,800000,0,0,800000,
      '2026-09-10T00:00:00Z','Dra Perez','monotributo')`);
  await pgPool.query(`UPDATE "Asiento" SET "liquidacionId"='li1' WHERE "concepto"='cargo_uso'`);

  assert.deepEqual(await cancelarOcupacion({ ocupacionId: id }, CTX, db), { ok: false, error: "MES_CERRADO" });
  assert.equal((await db.ocupacion.findUniqueOrThrow({ where: { id }, select: { estado: true } })).estado, "confirmada");
  assert.equal(await db.asiento.count({ where: { concepto: "nota_credito" } }), 0);
});
