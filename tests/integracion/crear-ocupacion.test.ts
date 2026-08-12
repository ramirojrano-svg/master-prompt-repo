// tests/integracion/crear-ocupacion.test.ts — T-28…T-38 (§15), el camino de escritura real.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { crearOcupacion, type CtxReserva } from "../../src/servicios/reservas/crear.ts";
import { prisma } from "../../src/db/prisma.ts";
import { insertarOcupacion, nuevoPool, reiniciarEsquema, seedBase, TZ_SEDE, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
// Cliente con pool amplio para el test de carrera (20 transacciones interactivas en paralelo).
const db = new PrismaClient({ datasourceUrl: `${URL_DB}?connection_limit=30&pool_timeout=20` });

const HORARIO = ((): CtxReserva["horario"] => {
  const abierto = [{ desde: "06:00", hasta: "23:00" }];
  return { 0: abierto, 1: abierto, 2: abierto, 3: abierto, 4: abierto, 5: abierto, 6: abierto };
})();

const POLITICA: CtxReserva["politica"] = {
  pasoMin: 30,
  duracionMinMin: 15,
  duracionMaxMin: 720,
  bufferMin: 15,
  bufferMismoInquilino: 0,
  antelacionMinMin: 0,
  horizonteDias: 3650,
};

function ctx(inquilinoId: string, over: Partial<CtxReserva> = {}): CtxReserva {
  return {
    operadorId: "op1",
    inquilinoId,
    politica: POLITICA,
    horario: HORARIO,
    bloqueaProfesional: true,
    ahora: new Date("2026-08-01T00:00:00Z"),
    ...over,
  };
}

// 12:00Z = 09:00 AR, mismo día 2026-08-12.
function req(salaId: string, hZ: number, durMin = 60) {
  const inicio = `2026-08-12T${String(hZ).padStart(2, "0")}:00:00.000Z`;
  return { salaId, fecha: "2026-08-12", inicioISO: inicio, duracionMin: durMin };
}

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
  // 20 inquilinos para el test de carrera (in00..in19), además de in1/in2 del seed.
  const valores = Array.from({ length: 20 }, (_, k) => `('in${String(k).padStart(2, "0")}','op1','Prof ${k}')`).join(",");
  await pgPool.query(`INSERT INTO "Inquilino"("id","operadorId","nombre") VALUES ${valores}`);
  // op2 con su propia sala, para el test de aislamiento de tenant.
  await pgPool.query(`INSERT INTO "Operador"("id","nombre","slug") VALUES('op2','Otro','otro')`);
  await pgPool.query(`INSERT INTO "Sede"("id","operadorId","nombre","zonaHoraria") VALUES('se2','op2','S2','${TZ_SEDE}')`);
  await pgPool.query(`INSERT INTO "Sala"("id","operadorId","sedeId","nombre") VALUES('saAjena','op2','se2','Ajena')`);
});

beforeEach(async () => {
  await pgPool.query('TRUNCATE "Ocupacion" CASCADE');
});

after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

test("camino feliz: crea la ocupación y devuelve id", async () => {
  const r = await crearOcupacion(req("sa1", 12), ctx("in1"), db);
  assert.equal(r.ok, true);
  if (r.ok) assert.ok(r.id.length > 0);
});

test("SLOT_OCUPADO: dos reservas solapadas en la misma sala (secuencial)", async () => {
  await crearOcupacion(req("sa1", 12), ctx("in00"), db);
  const r = await crearOcupacion({ salaId: "sa1", fecha: "2026-08-12", inicioISO: "2026-08-12T12:30:00.000Z", duracionMin: 60 }, ctx("in01"), db);
  assert.deepEqual(r, { ok: false, error: "SLOT_OCUPADO" });
});

test("bordes exactos conviven: 09-10 y 10-11 en la misma sala", async () => {
  const a = await crearOcupacion(req("sa1", 12), ctx("in00"), db);
  const b = await crearOcupacion(req("sa1", 13), ctx("in01"), db);
  assert.equal(a.ok && b.ok, true);
});

test("T-28 · 20 requests idénticas en paralelo => exactamente 1 gana", async () => {
  const reqs = Array.from({ length: 20 }, (_, k) => crearOcupacion(req("sa1", 15), ctx(`in${String(k).padStart(2, "0")}`), db));
  const res = await Promise.all(reqs);
  const ok = res.filter((r) => r.ok).length;
  const ocupados = res.filter((r) => !r.ok && r.error === "SLOT_OCUPADO").length;
  assert.equal(ok, 1, "una sola reserva creada");
  assert.equal(ocupados, 19, "las otras 19 reciben SLOT_OCUPADO");
  const { rows } = await pgPool.query(`SELECT count(*)::int AS n FROM "Ocupacion" WHERE "salaId"='sa1' AND "ocupa"`);
  assert.equal(rows[0].n, 1);
});

test("T-30 · el mismo inquilino en dos salas al mismo tiempo => SOLAPA_INQUILINO", async () => {
  await crearOcupacion(req("sa1", 12), ctx("in1"), db);
  const r = await crearOcupacion({ salaId: "sa2", fecha: "2026-08-12", inicioISO: "2026-08-12T12:30:00.000Z", duracionMin: 60 }, ctx("in1"), db);
  assert.deepEqual(r, { ok: false, error: "SOLAPA_INQUILINO" });
});

test("T-31 · con bloqueaProfesional=false el inquilino entra en dos salas a la vez", async () => {
  const c = { bloqueaProfesional: false };
  await crearOcupacion(req("sa1", 12), ctx("in1", c), db);
  const r = await crearOcupacion(req("sa2", 12), ctx("in1", c), db);
  assert.equal(r.ok, true);
});

test("T-32 · una cancelada no bloquea el slot", async () => {
  await insertarOcupacion(pgPool, { id: "cancel", salaId: "sa1", inquilinoId: "in00", estado: "cancelada", inicio: "2026-08-12T12:00:00Z", fin: "2026-08-12T13:00:00Z" });
  const r = await crearOcupacion(req("sa1", 12), ctx("in01"), db);
  assert.equal(r.ok, true);
});

test("T-37 · salaId de otro operador => SALA_INEXISTENTE, sin caída a otra sala", async () => {
  const r = await crearOcupacion(req("saAjena", 12), ctx("in1"), db);
  assert.deepEqual(r, { ok: false, error: "SALA_INEXISTENTE" });
});

test("T-38 · sala archivada => SALA_INEXISTENTE", async () => {
  await pgPool.query(`UPDATE "Sala" SET "activa"=false WHERE "id"='sa2'`);
  const r = await crearOcupacion(req("sa2", 12), ctx("in1"), db);
  assert.deepEqual(r, { ok: false, error: "SALA_INEXISTENTE" });
  await pgPool.query(`UPDATE "Sala" SET "activa"=true WHERE "id"='sa2'`);
});

test("FUERA_DE_HORARIO: un pedido fuera de la franja de apertura", async () => {
  // 04:00Z = 01:00 AR, fuera de 06:00-23:00.
  const r = await crearOcupacion({ salaId: "sa1", fecha: "2026-08-12", inicioISO: "2026-08-12T04:00:00.000Z", duracionMin: 60 }, ctx("in1"), db);
  assert.deepEqual(r, { ok: false, error: "FUERA_DE_HORARIO" });
});
