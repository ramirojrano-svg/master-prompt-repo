// tests/integracion/ocupacion-exclusion.test.ts
// F1 · paso 2 (§16): la migración de Ocupacion con los dos EXCLUDE. T-29 es el corazón:
// un INSERT crudo solapado (bypass del motor) tiene que rebotar en la BASE con 23P01.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { constraintDe, insertarOcupacion, nuevoPool, reiniciarEsquema, seedBase, sqlstate } from "./db.ts";

const pool = nuevoPool();

// Rangos en UTC. La sede es AR (-3): 12:00Z = 09:00 local.
const T = (h: number, m = 0) =>
  `2026-08-12T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;

before(async () => {
  await reiniciarEsquema(pool);
  await seedBase(pool);
});

beforeEach(async () => {
  await pool.query('TRUNCATE "Ocupacion" CASCADE');
});

after(async () => {
  await pool.end();
});

test("T-29 · INSERT crudo solapado en la misma sala rebota con 23P01", async () => {
  await insertarOcupacion(pool, { id: "a", salaId: "sa1", inquilinoId: "in1", inicio: T(12), fin: T(13) });
  await assert.rejects(
    insertarOcupacion(pool, { id: "b", salaId: "sa1", inquilinoId: "in1", inicio: T(12, 30), fin: T(13, 30) }),
    (e: unknown) => {
      assert.equal(sqlstate(e), "23P01");
      assert.equal(constraintDe(e), "ocupacion_sala_sin_solape");
      return true;
    },
  );
});

test("bordes exactos NO chocan a nivel base ('[)'): 09-10 y 10-11 conviven", async () => {
  await insertarOcupacion(pool, { id: "a", salaId: "sa1", inquilinoId: "in1", inicio: T(12), fin: T(13) });
  await insertarOcupacion(pool, { id: "b", salaId: "sa1", inquilinoId: "in1", inicio: T(13), fin: T(14) });
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM "Ocupacion" WHERE "salaId"=\'sa1\'');
  assert.equal(rows[0].n, 2);
});

test("una ocupación cancelada no ocupa: otra confirmada entra en el mismo rango", async () => {
  await insertarOcupacion(pool, { id: "x", salaId: "sa2", inquilinoId: "in1", estado: "cancelada", inicio: T(12), fin: T(13) });
  await insertarOcupacion(pool, { id: "y", salaId: "sa2", inquilinoId: null, estado: "confirmada", inicio: T(12), fin: T(13) });
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM "Ocupacion" WHERE "ocupa"`);
  assert.equal(rows[0].n, 1); // solo la confirmada ocupa
});

test("T-30 · eje inquilino: la misma persona en dos salas al mismo tiempo rebota con 23P01", async () => {
  await insertarOcupacion(pool, { id: "a", salaId: "sa1", inquilinoId: "in1", inicio: T(17), fin: T(18) });
  await assert.rejects(
    insertarOcupacion(pool, { id: "b", salaId: "sa2", inquilinoId: "in1", inicio: T(17, 30), fin: T(18, 30) }),
    (e: unknown) => {
      assert.equal(sqlstate(e), "23P01");
      assert.equal(constraintDe(e), "ocupacion_inquilino_sin_solape");
      return true;
    },
  );
});

test("T-31 · bloqueaProfesional=false permite al inquilino dos salas a la vez", async () => {
  await insertarOcupacion(pool, { id: "a", salaId: "sa1", inquilinoId: "in1", inicio: T(23), fin: T(23, 59), bloqueaProfesional: false });
  await insertarOcupacion(pool, { id: "b", salaId: "sa2", inquilinoId: "in1", inicio: T(23), fin: T(23, 59), bloqueaProfesional: false });
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM "Ocupacion" WHERE "inquilinoId"=\'in1\'');
  assert.equal(rows[0].n, 2);
});

test("un bloqueo (mantenimiento) sobre la sala tampoco admite una reserva encima", async () => {
  // El EXCLUDE cruza tipos: reserva encima de mantenimiento choca (la razón de una sola tabla, §4.8.2).
  await insertarOcupacion(pool, { id: "m", salaId: "sa1", inquilinoId: null, tipo: "mantenimiento", inicio: T(12), fin: T(14) });
  await assert.rejects(
    insertarOcupacion(pool, { id: "r", salaId: "sa1", inquilinoId: "in1", tipo: "reserva", inicio: T(13), fin: T(13, 30) }),
    (e: unknown) => sqlstate(e) === "23P01",
  );
});

test("CHECK dur_max: una ocupación de más de 12 h se rechaza (23514)", async () => {
  await assert.rejects(
    insertarOcupacion(pool, { id: "d", salaId: "sa1", inquilinoId: "in1", inicio: T(0), fin: T(13) }),
    (e: unknown) => sqlstate(e) === "23514",
  );
});

test("CHECK sala_requerida: una reserva sin sala se rechaza", async () => {
  await assert.rejects(
    insertarOcupacion(pool, { id: "s", salaId: null, inquilinoId: "in1", tipo: "reserva", inicio: T(12), fin: T(13) }),
    (e: unknown) => sqlstate(e) === "23514",
  );
});

test("un bloqueo global (salaId y sedeId null) es válido y no rompe los EXCLUDE", async () => {
  await insertarOcupacion(pool, { id: "g", salaId: null, sedeId: null, inquilinoId: null, tipo: "bloqueo", inicio: T(12), fin: T(14) });
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM "Ocupacion" WHERE "tipo"=\'bloqueo\'');
  assert.equal(rows[0].n, 1);
});
