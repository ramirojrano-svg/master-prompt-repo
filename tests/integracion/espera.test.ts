// tests/integracion/espera.test.ts — T-51, T-52, T-53 (§15), lista de espera y holds.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { crearHold } from "../../src/servicios/reservas/hold.ts";
import { crearOcupacion, type CtxReserva } from "../../src/servicios/reservas/crear.ts";
import { contarEsperasActivas } from "../../src/servicios/reservas/espera.ts";
import { prisma } from "../../src/db/prisma.ts";
import { insertarOcupacion, nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: `${URL_DB}?connection_limit=15&pool_timeout=20` });

const abierto = [{ desde: "06:00", hasta: "23:00" }];
const HORARIO: CtxReserva["horario"] = { 0: abierto, 1: abierto, 2: abierto, 3: abierto, 4: abierto, 5: abierto, 6: abierto };
const POLITICA: CtxReserva["politica"] = { pasoMin: 30, duracionMinMin: 15, duracionMaxMin: 720, bufferMin: 15, bufferMismoInquilino: 0, antelacionMinMin: 0, horizonteDias: 3650 };

function ctx(inquilinoId: string): CtxReserva {
  return { operadorId: "op1", inquilinoId, politica: POLITICA, horario: HORARIO, bloqueaProfesional: true, ahora: new Date("2026-08-01T00:00:00Z") };
}
function req(salaId: string) {
  return { salaId, fecha: "2026-08-12", inicioISO: "2026-08-12T13:00:00.000Z", duracionMin: 60 };
}

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Ocupacion" CASCADE');
  await pgPool.query('TRUNCATE "EsperaSlot" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

test("T-51 · dos notificados hacen click a la vez: un solo hold, el otro ve SLOT_OCUPADO", async () => {
  const [a, b] = await Promise.all([crearHold(req("sa1"), ctx("in1"), db), crearHold(req("sa1"), ctx("in2"), db)]);
  const ok = [a, b].filter((r) => r.ok).length;
  const ocupados = [a, b].filter((r) => !r.ok && r.error === "SLOT_OCUPADO").length;
  assert.equal(ok, 1);
  assert.equal(ocupados, 1);
  const { rows } = await pgPool.query(`SELECT count(*)::int AS n FROM "Ocupacion" WHERE "tipo"='hold' AND "ocupa"`);
  assert.equal(rows[0].n, 1);
});

test("T-52 · un hold VENCIDO que pisa el slot se marca expirada adentro del lock y la reserva entra", async () => {
  // hold con expiraAt en el pasado (antes de ahora = 2026-08-01)
  await insertarOcupacion(pgPool, {
    id: "holdViejo",
    salaId: "sa1",
    inquilinoId: "in2",
    tipo: "hold",
    estado: "confirmada",
    inicio: "2026-08-12T13:00:00Z",
    fin: "2026-08-12T14:00:00Z",
    expiraAt: "2026-07-30T00:00:00Z",
  });

  const r = await crearOcupacion(req("sa1"), ctx("in1"), db);
  assert.equal(r.ok, true);
  const viejo = await db.ocupacion.findUniqueOrThrow({ where: { id: "holdViejo" }, select: { estado: true } });
  assert.equal(viejo.estado, "expirada");
});

test("T-53 · el tope de esperas cuenta SOLO las futuras; las pasadas no cuentan", async () => {
  // 2 futuras, 3 pasadas
  await pgPool.query(
    `INSERT INTO "EsperaSlot"("id","operadorId","inquilinoId","fechaDesde","fechaHasta","vigenteHasta","activo") VALUES
      ('f1','op1','in1','2026-08-01T00:00:00Z','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z',true),
      ('f2','op1','in1','2026-08-01T00:00:00Z','2026-09-02T00:00:00Z','2026-09-02T00:00:00Z',true),
      ('p1','op1','in1','2026-06-01T00:00:00Z','2026-06-15T00:00:00Z','2026-06-15T00:00:00Z',true),
      ('p2','op1','in1','2026-06-01T00:00:00Z','2026-06-16T00:00:00Z','2026-06-16T00:00:00Z',true),
      ('p3','op1','in1','2026-06-01T00:00:00Z','2026-06-17T00:00:00Z','2026-06-17T00:00:00Z',true)`,
  );
  const n = await contarEsperasActivas(db, { operadorId: "op1", ahora: new Date("2026-08-12T00:00:00Z") });
  assert.equal(n, 2); // las 3 pasadas no cuentan
});
