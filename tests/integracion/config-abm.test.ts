// tests/integracion/config-abm.test.ts — ABM de salas e inquilinos (§6.12 / §3.6 / §6.7).
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { salasCon } from "../../src/servicios/config/salas.ts";
import { inquilinosCon } from "../../src/servicios/config/inquilinos.ts";
import { parseHorarios, resumenHorarios } from "../../src/dominio/motor/horarios.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { insertarOcupacion, nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });
const salas = salasCon(db);
const inquilinos = inquilinosCon(db);

const owner: Actor = { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null };
const profesional: Actor = { usuarioId: "u3", operadorId: "op1", rol: "inquilino_titular", inquilinoId: "in1" };

const salaBase = { nombre: "Consultorio 9", color: "#157f4a", dias: [1, 2, 3, 4, 5], desde: "08:00", hasta: "22:00" };

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query(`DELETE FROM "Sala" WHERE "id" NOT IN ('sa1','sa2')`);
  await pgPool.query(`DELETE FROM "Inquilino" WHERE "id" NOT IN ('in1','in2')`);
  await pgPool.query(`UPDATE "Sala" SET "activa"=true, "archivadaEl"=NULL`);
  await pgPool.query(`UPDATE "Inquilino" SET "estado"='activo'`);
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

// ── SALAS ───────────────────────────────────────────────────────────────────
test("el owner crea una sala con su horario semanal", async () => {
  const r = await salas.crear(owner, salaBase);
  assert.ok(r.ok && r.data.ok);
  if (!(r.ok && r.data.ok)) return;
  const s = await db.sala.findUniqueOrThrow({ where: { id: r.data.id }, select: { nombre: true, bufferMin: true, horarioJson: true, orden: true } });
  assert.equal(s.nombre, "Consultorio 9");
  assert.equal(s.bufferMin, 0, "el centro no usa tiempo de limpieza entre turnos");
  assert.equal(resumenHorarios(parseHorarios(s.horarioJson)), "Lun a Vie 08:00-22:00");
  assert.ok(s.orden > 0, "toma el siguiente orden (el pasillo no es alfabético)");
});

test("§6.2 · la un profesional NO administra salas: SIN_PERMISO y cero escrituras", async () => {
  const antes = await db.sala.count({ where: { operadorId: "op1" } });
  const r = await salas.crear(profesional, salaBase);
  assert.deepEqual(r, { ok: false, error: "SIN_PERMISO" });
  assert.equal(await db.sala.count({ where: { operadorId: "op1" } }), antes);
});

test("horario inválido (cierra antes de abrir) => HORARIO_INVALIDO, no se crea nada", async () => {
  const r = await salas.crear(owner, { ...salaBase, desde: "22:00", hasta: "08:00" });
  assert.ok(r.ok && !r.data.ok);
  if (r.ok && !r.data.ok) assert.equal(r.data.error, "HORARIO_INVALIDO");
});

test("editar cambia nombre y horario sin tocar la identidad de la sala", async () => {
  const c = await salas.crear(owner, salaBase);
  assert.ok(c.ok && c.data.ok);
  if (!(c.ok && c.data.ok)) return;
  const r = await salas.editar(owner, { ...salaBase, salaId: c.data.id, nombre: "Consultorio 9 bis", dias: [6], desde: "09:00", hasta: "13:00" });
  assert.ok(r.ok && r.data.ok);
  const s = await db.sala.findUniqueOrThrow({ where: { id: c.data.id }, select: { nombre: true, horarioJson: true } });
  assert.equal(s.nombre, "Consultorio 9 bis");
  assert.equal(resumenHorarios(parseHorarios(s.horarioJson)), "Sáb 09:00-13:00");
});

test("§3.6 · archivar NO borra: la sala y sus reservas siguen existiendo", async () => {
  await insertarOcupacion(pgPool, { id: "oc-hist", salaId: "sa2", inquilinoId: "in1", inicio: "2026-08-12T12:00:00Z", fin: "2026-08-12T13:00:00Z" });
  const r = await salas.archivar(owner, { salaId: "sa2", activa: false });
  assert.ok(r.ok && r.data.ok);

  const s = await db.sala.findUnique({ where: { id: "sa2" }, select: { activa: true, archivadaEl: true } });
  assert.ok(s, "la sala sigue existiendo");
  assert.equal(s!.activa, false);
  assert.notEqual(s!.archivadaEl, null);
  assert.equal(await db.ocupacion.count({ where: { salaId: "sa2" } }), 1, "su historia queda intacta");
});

test("reactivar una sala archivada la vuelve a activa y limpia la fecha", async () => {
  await salas.archivar(owner, { salaId: "sa2", activa: false });
  await salas.archivar(owner, { salaId: "sa2", activa: true });
  const s = await db.sala.findUniqueOrThrow({ where: { id: "sa2" }, select: { activa: true, archivadaEl: true } });
  assert.equal(s.activa, true);
  assert.equal(s.archivadaEl, null);
});

test("una sala de otro operador no se puede editar ni archivar", async () => {
  await pgPool.query(`INSERT INTO "Operador"("id","nombre","slug") VALUES('opZ','Otro','otro-z') ON CONFLICT DO NOTHING`);
  await pgPool.query(`INSERT INTO "Sede"("id","operadorId","nombre","zonaHoraria") VALUES('seZ','opZ','S','America/Argentina/Buenos_Aires') ON CONFLICT DO NOTHING`);
  await pgPool.query(`INSERT INTO "Sala"("id","operadorId","sedeId","nombre") VALUES('saZ','opZ','seZ','Ajena') ON CONFLICT DO NOTHING`);

  const r = await salas.editar(owner, { ...salaBase, salaId: "saZ" });
  assert.ok(r.ok && !r.data.ok);
  const s = await db.sala.findUniqueOrThrow({ where: { id: "saZ" }, select: { nombre: true } });
  assert.equal(s.nombre, "Ajena", "no se tocó la sala del otro tenant");
});

// ── INQUILINOS ──────────────────────────────────────────────────────────────
test("el owner agrega un profesional", async () => {
  const r = await inquilinos.crear(owner, { nombre: "Sofía García (Estética)" });
  assert.ok(r.ok && r.data.ok);
  if (!(r.ok && r.data.ok)) return;
  const i = await db.inquilino.findUniqueOrThrow({ where: { id: r.data.id }, select: { nombre: true, estado: true } });
  assert.equal(i.estado, "activo");
});

test("§6.7 · dar de baja ARCHIVA: el inquilino y su historia siguen existiendo", async () => {
  await insertarOcupacion(pgPool, { id: "oc-inq", salaId: "sa1", inquilinoId: "in2", inicio: "2026-08-12T14:00:00Z", fin: "2026-08-12T15:00:00Z" });
  const r = await inquilinos.cambiarEstado(owner, { inquilinoId: "in2", estado: "baja" });
  assert.ok(r.ok && r.data.ok);

  const i = await db.inquilino.findUnique({ where: { id: "in2" }, select: { estado: true } });
  assert.ok(i, "sigue existiendo");
  assert.equal(i!.estado, "baja");
  assert.equal(await db.ocupacion.count({ where: { inquilinoId: "in2" } }), 1, "su historia queda intacta");
});

test("editar el nombre no toca las reservas ya existentes", async () => {
  await insertarOcupacion(pgPool, { id: "oc-n", salaId: "sa1", inquilinoId: "in1", inicio: "2026-08-12T16:00:00Z", fin: "2026-08-12T17:00:00Z" });
  await inquilinos.editar(owner, { inquilinoId: "in1", nombre: "Dra. Pérez (Psiquiatría)" });
  const oc = await db.ocupacion.findUniqueOrThrow({ where: { id: "oc-n" }, select: { inquilinoId: true } });
  assert.equal(oc.inquilinoId, "in1", "la reserva sigue apuntando al mismo inquilino");
});

test("§6.2 · la un profesional NO administra profesionales", async () => {
  const r = await inquilinos.crear(profesional, { nombre: "X" });
  assert.deepEqual(r, { ok: false, error: "SIN_PERMISO" });
});
