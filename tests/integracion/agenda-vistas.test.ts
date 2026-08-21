// tests/integracion/agenda-vistas.test.ts — las vistas semana y mes del calendario (§6.4).
// Lo que se prueba es lo que rompe un calendario hecho a mano: que un turno aparezca en el día
// equivocado, que la semana cuente lo que no le toca, o que el filtro de consultorios esconda algo.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { cargarAgenda } from "../../src/servicios/agenda/dia.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { insertarOcupacion, nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });

const owner: Actor = { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null };
const inqAjeno: Actor = { usuarioId: "u9", operadorId: "op1", rol: "inquilino_titular", inquilinoId: "in2" };

// Miércoles 2026-08-12. Su semana va del domingo 9 al sábado 15.
const MIE = "2026-08-12";

const HORARIO = JSON.stringify({
  "0": [], "6": [],
  "1": [{ desde: "08:00", hasta: "22:00" }],
  "2": [{ desde: "08:00", hasta: "22:00" }],
  "3": [{ desde: "08:00", hasta: "22:00" }],
  "4": [{ desde: "08:00", hasta: "22:00" }],
  "5": [{ desde: "08:00", hasta: "22:00" }],
});

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
  await pgPool.query(`UPDATE "Sala" SET "horarioJson"=$1::jsonb`, [HORARIO]);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Ocupacion" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

test("la vista SEMANA trae los 7 días, de domingo a sábado", async () => {
  const v = await cargarAgenda({ actor: owner, fecha: MIE, vista: "semana" }, db);
  assert.ok(v);
  assert.equal(v.dias.length, 7);
  assert.equal(v.dias[0], "2026-08-09");
  assert.equal(v.dias[6], "2026-08-15");
  assert.equal(v.titulo, "9 – 15 de agosto de 2026");
});

test("la vista MES trae 42 celdas y el título del mes", async () => {
  const v = await cargarAgenda({ actor: owner, fecha: MIE, vista: "mes" }, db);
  assert.ok(v);
  assert.equal(v.dias.length, 42);
  assert.equal(v.titulo, "Agosto 2026");
});

test("en semana, cada turno cae en SU día (las columnas son días, no salas)", async () => {
  // 13:00Z = 10:00 AR del martes 11; 13:00Z del jueves 13.
  await insertarOcupacion(pgPool, { id: "mar", salaId: "sa1", inquilinoId: "in1", inicio: "2026-08-11T13:00:00Z", fin: "2026-08-11T14:00:00Z" });
  await insertarOcupacion(pgPool, { id: "jue", salaId: "sa2", inquilinoId: "in2", inicio: "2026-08-13T13:00:00Z", fin: "2026-08-13T14:00:00Z" });

  const v = await cargarAgenda({ actor: owner, fecha: MIE, vista: "semana" }, db);
  assert.ok(v);
  assert.equal(v.ubicaciones.find((u) => u.id === "mar")?.columnaId, "2026-08-11");
  assert.equal(v.ubicaciones.find((u) => u.id === "jue")?.columnaId, "2026-08-13");
  // Misma hora local => misma fila, aunque sean días distintos.
  assert.equal(v.ubicaciones.find((u) => u.id === "mar")?.fila, v.ubicaciones.find((u) => u.id === "jue")?.fila);
});

test("un turno del lunes NO aparece en la semana anterior", async () => {
  await insertarOcupacion(pgPool, { id: "o1", salaId: "sa1", inquilinoId: "in1", inicio: "2026-08-17T13:00:00Z", fin: "2026-08-17T14:00:00Z" });
  const estaSemana = await cargarAgenda({ actor: owner, fecha: MIE, vista: "semana" }, db);
  const laQueViene = await cargarAgenda({ actor: owner, fecha: "2026-08-19", vista: "semana" }, db);
  assert.equal(estaSemana!.reservas.length, 0);
  assert.equal(laQueViene!.reservas.length, 1);
});

test("el mes muestra turnos de días que son del mes anterior pero están en la grilla", async () => {
  // La grilla de agosto 2026 arranca el domingo 26 de julio: ese día se ve, así que sus turnos también.
  await insertarOcupacion(pgPool, { id: "jul", salaId: "sa1", inquilinoId: "in1", inicio: "2026-07-28T13:00:00Z", fin: "2026-07-28T14:00:00Z" });
  const v = await cargarAgenda({ actor: owner, fecha: MIE, vista: "mes" }, db);
  assert.ok(v);
  assert.equal(v.reservas.length, 1, "si la celda está en pantalla, su turno también");
  assert.equal(v.reservas[0]!.fechaLocal, "2026-07-28");
});

test("el KPI de la semana usa la apertura de LA SEMANA, no la de un día", async () => {
  await insertarOcupacion(pgPool, { id: "o1", salaId: "sa1", inquilinoId: "in1", inicio: "2026-08-11T13:00:00Z", fin: "2026-08-11T15:00:00Z" });
  const v = await cargarAgenda({ actor: owner, fecha: MIE, vista: "semana" }, db);
  assert.ok(v);
  // 2 salas × 5 días hábiles × 14 h = 140 h.
  assert.equal(v.kpis.disponiblesMin, 2 * 5 * 14 * 60);
  assert.equal(v.kpis.ocupadasMin, 120);
});

test("filtrar por consultorio saca sus turnos Y su apertura del denominador", async () => {
  await insertarOcupacion(pgPool, { id: "a", salaId: "sa1", inquilinoId: "in1", inicio: "2026-08-12T13:00:00Z", fin: "2026-08-12T14:00:00Z" });
  await insertarOcupacion(pgPool, { id: "b", salaId: "sa2", inquilinoId: "in2", inicio: "2026-08-12T13:00:00Z", fin: "2026-08-12T14:00:00Z" });

  const todas = await cargarAgenda({ actor: owner, fecha: MIE, vista: "dia" }, db);
  const soloUna = await cargarAgenda({ actor: owner, fecha: MIE, vista: "dia", salas: ["sa1"] }, db);
  assert.equal(todas!.reservas.length, 2);
  assert.equal(soloUna!.reservas.length, 1);
  assert.equal(soloUna!.reservas[0]!.id, "a");
  // Si se filtrara solo el numerador, la ocupación caería a la mitad y sería mentira.
  assert.equal(soloUna!.kpis.disponiblesMin, todas!.kpis.disponiblesMin / 2);
});

test("un id de sala inventado en el filtro se ignora, no deja la pantalla vacía (§9)", async () => {
  await insertarOcupacion(pgPool, { id: "a", salaId: "sa1", inquilinoId: "in1", inicio: "2026-08-12T13:00:00Z", fin: "2026-08-12T14:00:00Z" });
  const v = await cargarAgenda({ actor: owner, fecha: MIE, vista: "dia", salas: ["no-existe"] }, db);
  assert.ok(v);
  // El owner ve además la columna sintética "sin consultorio", que ahora está siempre para quien
  // puede crear esas reservas: sin ella no habría forma de tocarla para crear la primera.
  assert.deepEqual(v.salasVisibles.sort(), ["sa1", "sa2", "sin-sala"], "sin filtro válido se ven todas");
  assert.equal(v.reservas.length, 1);
});

test("§6.3 · la privacidad vale igual en semana y en mes", async () => {
  await insertarOcupacion(pgPool, { id: "o1", salaId: "sa1", inquilinoId: "in1", inicio: "2026-08-12T13:00:00Z", fin: "2026-08-12T14:00:00Z" });
  for (const vista of ["semana", "mes"] as const) {
    const v = await cargarAgenda({ actor: inqAjeno, fecha: MIE, vista }, db);
    assert.ok(v);
    const json = JSON.stringify(v.reservas);
    assert.ok(!json.includes("Dra Perez"), `en vista ${vista} no se filtra el nombre ajeno`);
    assert.equal(v.reservas[0]!.titulo, "Ocupado");
    assert.equal(v.reservas[0]!.esBloqueo, false, "un ocupado ajeno no se delata como bloqueo tampoco");
  }
});

test("el evento trae su horario ya formateado en la zona de la SEDE", async () => {
  await insertarOcupacion(pgPool, { id: "o1", salaId: "sa1", inquilinoId: "in1", inicio: "2026-08-12T13:00:00Z", fin: "2026-08-12T14:30:00Z" });
  const v = await cargarAgenda({ actor: owner, fecha: MIE, vista: "dia" }, db);
  assert.equal(v!.reservas[0]!.horaTexto, "10:00 – 11:30", "13:00Z es 10:00 en Buenos Aires");
  assert.equal(v!.reservas[0]!.fechaLocal, "2026-08-12");
});
