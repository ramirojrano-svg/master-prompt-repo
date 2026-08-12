// tests/integracion/membresias.test.ts — F4: alta, cobro y otorgamiento de cupo (§4.12 / §5)
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { altaMembresia, cobrarMembresia, otorgarCupoDeMembresia } from "../../src/servicios/plata/membresias.ts";
import { saldoBolsa } from "../../src/servicios/plata/cupo.ts";
import { saldoCorriente } from "../../src/servicios/plata/ledger.ts";
import { prisma } from "../../src/db/prisma.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });
const PERIODO = "2026-08";
const AHORA = new Date("2026-08-12T12:00:00Z");

function alta(over: Partial<Parameters<typeof altaMembresia>[0]> = {}) {
  return altaMembresia(
    { operadorId: "op1", inquilinoId: "in1", nombre: "Plan 20h", precioMensualCent: 100_000n, minutosIncluidos: 1200, vigenteDesde: new Date("2026-08-01T00:00:00Z"), vigenteHasta: new Date("2026-09-01T00:00:00Z"), ...over },
    db,
  );
}

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Membresia","Asiento","BolsaAsiento" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

test("alta crea la membresía activa con su cupo y precio", async () => {
  const { membresiaId } = await alta();
  const m = await db.membresia.findUniqueOrThrow({ where: { id: membresiaId }, select: { estado: true, minutosIncluidos: true, precioMensualCent: true } });
  assert.equal(m.estado, "activa");
  assert.equal(m.minutosIncluidos, 1200);
  assert.equal(m.precioMensualCent, 100_000n);
});

test("cobrar la membresía asienta el abono y es idempotente por (membresía, período)", async () => {
  const { membresiaId } = await alta();
  const a = await cobrarMembresia(db, { operadorId: "op1", inquilinoId: "in1", membresiaId, periodo: PERIODO, montoCent: 100_000n, moneda: "ARS", fechaHecho: AHORA });
  const b = await cobrarMembresia(db, { operadorId: "op1", inquilinoId: "in1", membresiaId, periodo: PERIODO, montoCent: 100_000n, moneda: "ARS", fechaHecho: AHORA });
  assert.equal(a.creado, true);
  assert.equal(b.creado, false); // un solo cargo por período
  assert.equal(await saldoCorriente(db, { operadorId: "op1", inquilinoId: "in1" }), 100_000n);
});

test("otorgar cupo de una membresía VIGENTE acredita los minutos incluidos, una sola vez", async () => {
  const { membresiaId } = await alta();
  const m = await db.membresia.findUniqueOrThrow({ where: { id: membresiaId } });

  const r1 = await otorgarCupoDeMembresia(db, { membresia: m, periodo: PERIODO, ahora: AHORA });
  const r2 = await otorgarCupoDeMembresia(db, { membresia: m, periodo: PERIODO, ahora: AHORA });
  assert.equal(r1.otorgado, 1200);
  assert.equal(r2.otorgado, 0); // idempotente por la clave del período
  assert.equal(await saldoBolsa(db, { operadorId: "op1", inquilinoId: "in1", bolsa: "mes", periodo: PERIODO }), 1200);
});

test("una membresía VENCIDA no acredita cupo (cuenta muerta no acumula regalos)", async () => {
  const { membresiaId } = await alta({ vigenteHasta: new Date("2026-08-05T00:00:00Z") }); // ya venció al 12/8
  const m = await db.membresia.findUniqueOrThrow({ where: { id: membresiaId } });
  const r = await otorgarCupoDeMembresia(db, { membresia: m, periodo: PERIODO, ahora: AHORA });
  assert.equal(r.otorgado, 0);
  assert.equal(await saldoBolsa(db, { operadorId: "op1", inquilinoId: "in1", bolsa: "mes", periodo: PERIODO }), 0);
});
