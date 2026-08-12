// tests/integracion/series-y-reubicacion.test.ts — T-40 (DB), T-41, T-48, T-49, T-50 (§15)
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { crearOcupacion, type CtxReserva } from "../../src/servicios/reservas/crear.ts";
import { expandirSerie } from "../../src/servicios/reservas/expandir-serie.ts";
import { reubicarOcupacion } from "../../src/servicios/reservas/reubicar.ts";
import { editarOcupacion } from "../../src/servicios/reservas/editar.ts";
import { marcarNoShow, revertirNoShow } from "../../src/servicios/reservas/no-show.ts";
import { sumarDiasLocal } from "../../src/dominio/motor/zona.ts";
import { prisma } from "../../src/db/prisma.ts";
import { insertarOcupacion, nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: `${URL_DB}?connection_limit=20&pool_timeout=20` });

const abierto = [{ desde: "06:00", hasta: "23:00" }];
const HORARIO: CtxReserva["horario"] = { 0: abierto, 1: abierto, 2: abierto, 3: abierto, 4: abierto, 5: abierto, 6: abierto };
const POLITICA: CtxReserva["politica"] = { pasoMin: 30, duracionMinMin: 15, duracionMaxMin: 720, bufferMin: 15, bufferMismoInquilino: 0, antelacionMinMin: 0, horizonteDias: 3650 };

function ctx(inquilinoId: string, over: Partial<CtxReserva> = {}): CtxReserva {
  return { operadorId: "op1", inquilinoId, politica: POLITICA, horario: HORARIO, bloqueaProfesional: true, ahora: new Date("2026-08-01T00:00:00Z"), ...over };
}

// 10:00 AR = 13:00Z (AR no tiene DST).
function req(salaId: string, fecha: string) {
  return { salaId, fecha, inicioISO: `${fecha}T13:00:00.000Z`, duracionMin: 60 };
}

async function bloquear(fecha: string, id: string) {
  await insertarOcupacion(pgPool, { id, salaId: "sa1", inquilinoId: "in2", estado: "confirmada", inicio: `${fecha}T13:00:00Z`, fin: `${fecha}T14:00:00Z` });
}

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});

beforeEach(async () => {
  await pgPool.query('TRUNCATE "Ocupacion" CASCADE');
});

after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

const SEMANAS_CHOQUE = [0, 5, 11];

test("T-40 · expandir serie (parcial): 12 semanas, 3 chocan => 9 creadas + reporte de las 3", async () => {
  for (const k of SEMANAS_CHOQUE) await bloquear(sumarDiasLocal("2026-08-12", k * 7)!, `b${k}`);

  const r = await expandirSerie({ salaId: "sa1", hora: "10:00", duracionMin: 60, fechaInicio: "2026-08-12", semanas: 12, modo: "parcial" }, ctx("in1"), db);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.creadas.length, 9);
    assert.equal(r.conflictos.length, 3);
    const { rows } = await pgPool.query('SELECT count(*)::int AS n FROM "Ocupacion" WHERE "serieId"=$1', [r.serieId]);
    assert.equal(rows[0].n, 9);
  }
});

test("T-41 · todo_o_nada: 1 de 12 choca => 0 filas creadas, tx abortada", async () => {
  await bloquear(sumarDiasLocal("2026-08-12", 5 * 7)!, "b5");

  const r = await expandirSerie({ salaId: "sa1", hora: "10:00", duracionMin: 60, fechaInicio: "2026-08-12", semanas: 12, modo: "todo_o_nada" }, ctx("in1"), db);
  assert.deepEqual(r.ok, false);
  if (!r.ok) assert.equal(r.error, "SERIE_ABORTADA");
  // solo queda el bloqueante; ninguna fila de serie
  const { rows } = await pgPool.query('SELECT count(*)::int AS n FROM "Ocupacion" WHERE "serieId" IS NOT NULL');
  assert.equal(rows[0].n, 0);
});

test("una serie sin conflictos crea las N ocurrencias", async () => {
  const r = await expandirSerie({ salaId: "sa1", hora: "10:00", duracionMin: 60, fechaInicio: "2026-08-12", semanas: 4, modo: "parcial" }, ctx("in1"), db);
  assert.ok(r.ok && r.creadas.length === 4);
});

test("T-49 · reubicación: Sala 1 -> Sala 2, la vieja queda reubicada, la nueva con reemplazaAId", async () => {
  const creada = await crearOcupacion(req("sa1", "2026-08-12"), ctx("in1"), db);
  assert.ok(creada.ok);
  const idViejo = creada.ok ? creada.id : "";

  const r = await reubicarOcupacion({ ocupacionId: idViejo, salaDestinoId: "sa2", motivo: "sala en mantenimiento" }, { operadorId: "op1" }, db);
  assert.ok(r.ok);

  const vieja = await db.ocupacion.findUniqueOrThrow({ where: { id: idViejo }, select: { estado: true, salaId: true } });
  assert.equal(vieja.estado, "reubicada");
  assert.equal(vieja.salaId, "sa1"); // el histórico de la Sala 1 NO cambia

  if (r.ok) {
    const nueva = await db.ocupacion.findUniqueOrThrow({ where: { id: r.id }, select: { salaId: true, reemplazaAId: true, estado: true } });
    assert.equal(nueva.salaId, "sa2");
    assert.equal(nueva.reemplazaAId, idViejo);
    assert.equal(nueva.estado, "confirmada");
  }
});

test("T-48 · no-show: marcar y revertir cambian el estado (confirmada -> no_show -> confirmada)", async () => {
  const creada = await crearOcupacion(req("sa1", "2026-08-12"), ctx("in1"), db);
  assert.ok(creada.ok);
  const id = creada.ok ? creada.id : "";

  assert.deepEqual(await marcarNoShow({ ocupacionId: id, motivo: "no vino" }, { operadorId: "op1" }, db), { ok: true });
  assert.equal((await db.ocupacion.findUniqueOrThrow({ where: { id }, select: { estado: true } })).estado, "no_show");

  assert.deepEqual(await revertirNoShow({ ocupacionId: id }, { operadorId: "op1" }, db), { ok: true });
  assert.equal((await db.ocupacion.findUniqueOrThrow({ where: { id }, select: { estado: true } })).estado, "confirmada");
});

test("T-50 · editar el motivo de una reserva de una sala ARCHIVADA no toca salaId", async () => {
  const creada = await crearOcupacion(req("sa2", "2026-08-12"), ctx("in1"), db);
  assert.ok(creada.ok);
  const id = creada.ok ? creada.id : "";

  await pgPool.query(`UPDATE "Sala" SET "activa"=false WHERE "id"='sa2'`);
  const r = await editarOcupacion({ ocupacionId: id, motivo: "corrijo el motivo" }, { operadorId: "op1" }, db);
  assert.deepEqual(r, { ok: true });

  const fila = await db.ocupacion.findUniqueOrThrow({ where: { id }, select: { salaId: true, motivo: true, estado: true } });
  assert.equal(fila.salaId, "sa2"); // intacto, aunque la sala esté archivada
  assert.equal(fila.motivo, "corrijo el motivo");
  await pgPool.query(`UPDATE "Sala" SET "activa"=true WHERE "id"='sa2'`);
});
