// tests/integracion/acciones-agenda.test.ts — la acción de alta desde el panel (§6.2 / §4.8).
// Verifica que la acción NO reimplemente nada: delega en crearOcupacion (locks + constraint) y
// que el permiso se chequee SIEMPRE, aunque la pantalla haya escondido el botón.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { crearReservaAjenaCon, mensajeDeError } from "../../src/servicios/agenda/acciones.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { fechaEnZona, sumarDiasLocal } from "../../src/dominio/motor/zona.ts";
import { nuevoPool, reiniciarEsquema, seedBase, TZ_SEDE, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: `${URL_DB}?connection_limit=15` });
const accion = crearReservaAjenaCon(db);

const owner: Actor = { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null };
const inquilino: Actor = { usuarioId: "u2", operadorId: "op1", rol: "inquilino_titular", inquilinoId: "in1" };

// Fecha FUTURA calculada desde el reloj: una fecha fija se vuelve pasado y el test empieza a
// fallar solo (el motor rechaza el pasado, que es lo correcto).
const FECHA = sumarDiasLocal(fechaEnZona(new Date(), TZ_SEDE), 7)!;
const base = { salaId: "sa1", fecha: FECHA, hora: "09:00", duracionMin: 60, inquilinoId: "in1" };

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
  // Abierto los 7 días, para que el test no dependa de en qué día de la semana cae.
  const franja = [{ desde: "08:00", hasta: "22:00" }];
  const H = JSON.stringify({ "0": franja, "1": franja, "2": franja, "3": franja, "4": franja, "5": franja, "6": franja });
  await pgPool.query(`UPDATE "Sala" SET "horarioJson"=$1::jsonb`, [H]);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Ocupacion" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

test("el owner crea una reserva desde el panel", async () => {
  const r = await accion(owner, base);
  assert.ok(r.ok && r.data.ok, "debería crearse");
  const n = await db.ocupacion.count({ where: { operadorId: "op1" } });
  assert.equal(n, 1);
});

test("§6.2 · un INQUILINO no puede cargar a nombre de otro: SIN_PERMISO y cero escrituras", async () => {
  const r = await accion(inquilino, base);
  assert.deepEqual(r, { ok: false, error: "SIN_PERMISO" });
  assert.equal(await db.ocupacion.count({ where: { operadorId: "op1" } }), 0);
});

test("el permiso se chequea ANTES del schema (input basura de un rol sin permiso => SIN_PERMISO)", async () => {
  const r = await accion(inquilino, { basura: true });
  assert.deepEqual(r, { ok: false, error: "SIN_PERMISO" });
});

test("dos reservas solapadas: la segunda recibe SLOT_OCUPADO (delega en el motor con locks)", async () => {
  await accion(owner, base);
  const r = await accion(owner, { ...base, hora: "09:30", inquilinoId: "in2" });
  assert.ok(r.ok && !r.data.ok);
  if (r.ok && !r.data.ok) assert.equal(r.data.error, "SLOT_OCUPADO");
});

test("bordes exactos: 09-10 y 10-11 conviven (no chocan)", async () => {
  const a = await accion(owner, base);
  const b = await accion(owner, { ...base, hora: "10:00", inquilinoId: "in2" });
  assert.ok(a.ok && a.data.ok);
  assert.ok(b.ok && b.data.ok);
});

test("fuera del horario de apertura => FUERA_DE_HORARIO (mensaje honesto, no 'no hay lugar')", async () => {
  const r = await accion(owner, { ...base, hora: "05:00" });
  assert.ok(r.ok && !r.data.ok);
  if (r.ok && !r.data.ok) {
    assert.equal(r.data.error, "FUERA_DE_HORARIO");
    assert.match(mensajeDeError(r.data.error), /fuera de la apertura/i);
  }
});

test("20 altas simultáneas del mismo slot => exactamente una gana", async () => {
  const reqs = Array.from({ length: 20 }, (_, k) => accion(owner, { ...base, inquilinoId: k % 2 === 0 ? "in1" : "in2" }));
  const res = await Promise.all(reqs);
  const creadas = res.filter((r) => r.ok && r.data.ok).length;
  assert.equal(creadas, 1);
  assert.equal(await db.ocupacion.count({ where: { operadorId: "op1", estado: "confirmada" } }), 1);
});

test("una sala de otro operador => SALA_INEXISTENTE, jamás caída silenciosa a otra sala", async () => {
  const r = await accion(owner, { ...base, salaId: "sala-de-otro" });
  assert.ok(r.ok && !r.data.ok);
  if (r.ok && !r.data.ok) assert.equal(r.data.error, "SALA_INEXISTENTE");
});
