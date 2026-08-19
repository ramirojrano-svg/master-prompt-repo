// tests/integracion/sin-consultorio.test.ts — reservas SIN CONSULTORIO, de punta a punta.
//
// El caso real: dos profesionales que los miércoles no usan el consultorio pero sí la recepción
// (van sus secretarias). Se les cobra la misma hora que si lo hubieran usado, y el consultorio
// tiene que quedar LIBRE para alquilárselo a otro.
//
// Este archivo existe por una regresión concreta: el "horario siempre abierto" que se le pasaba a
// estas reservas se había escrito como una franja 00:00–24:00, y 'HH:MM' no llega a las 24 — la
// franja se descartaba entera, el día quedaba sin ninguna apertura y TODA reserva sin consultorio
// daba FUERA_DE_HORARIO. Una serie de 57 miércoles quedaba en cero.
//
// Los tests unitarios del motor no lo habrían encontrado solos: el valor roto vivía en la capa de
// servicios. Por eso se prueba el camino completo, el mismo que corre la pantalla.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { crearReservaAjenaCon, crearReservaPropiaCon } from "../../src/servicios/agenda/acciones.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { fechaEnZona, sumarDiasLocal, diaSemanaDeFecha } from "../../src/dominio/motor/zona.ts";
import { nuevoPool, reiniciarEsquema, seedBase, TZ_SEDE, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: `${URL_DB}?connection_limit=15` });
const ajena = crearReservaAjenaCon(db);
const propia = crearReservaPropiaCon(db);

const owner: Actor = { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null };
const profesional: Actor = { usuarioId: "u2", operadorId: "op1", rol: "inquilino_titular", inquilinoId: "in1" };

/** El próximo miércoles, calculado desde el reloj: una fecha fija se vuelve pasado y el test
 *  empezaría a fallar solo. Miércoles = 3, que es el día del caso real. */
function proximoMiercoles(): string {
  let f = fechaEnZona(new Date(), TZ_SEDE);
  for (let i = 0; i < 8; i++) {
    f = sumarDiasLocal(f, 1)!;
    if (diaSemanaDeFecha(f) === 3) return f;
  }
  throw new Error("no hay miércoles en 8 días, algo muy raro pasó");
}

const MIERCOLES = proximoMiercoles();
/** 10 a 13, el horario del caso real. */
const SIN_SALA = { salaId: "", fecha: MIERCOLES, hora: "10:00", duracionMin: 180, inquilinoId: "in1" };

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
  // Los consultorios abren de 9 a 13 SOLO los lunes. Así, si algo volviera a mirar el horario de
  // la sala para una reserva sin consultorio, el miércoles daría cerrado y el test lo cazaría.
  const H = JSON.stringify({ "0": [], "1": [{ desde: "09:00", hasta: "13:00" }], "2": [], "3": [], "4": [], "5": [], "6": [] });
  await pgPool.query(`UPDATE "Sala" SET "horarioJson"=$1::jsonb`, [H]);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Ocupacion" CASCADE');
  await pgPool.query('TRUNCATE "Tarifa" CASCADE');
  await pgPool.query('TRUNCATE "Asiento" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

test("un turno suelto sin consultorio se crea, aunque ese día TODOS los consultorios estén cerrados", async () => {
  const r = await ajena(owner, SIN_SALA);
  assert.ok(r.ok, `el envoltorio rechazó: ${r.ok ? "" : r.error}`);
  assert.ok(r.data.ok, `no se creó: ${r.data.ok ? "" : r.data.error}`);

  const filas = await db.ocupacion.findMany({ where: { operadorId: "op1" }, select: { salaId: true } });
  assert.equal(filas.length, 1);
  assert.equal(filas[0]!.salaId, null, "tiene que quedar SIN sala: el consultorio sigue libre");
});

test("LA REGRESIÓN: la serie semanal de los miércoles se crea entera, sin ninguna fecha afuera", async () => {
  const r = await ajena(owner, { ...SIN_SALA, repeticion: "semanal" });
  assert.ok(r.ok && r.data.ok, "la serie tiene que crearse");
  if (!r.ok || !r.data.ok) return;

  // El número exacto depende del horizonte; lo que importa es que sean MUCHAS y NINGUNA afuera.
  assert.ok(r.data.creadas > 40, `se esperaba una serie larga y se crearon ${r.data.creadas}`);
  assert.deepEqual(r.data.conflictos, [], "ninguna fecha puede quedar afuera por horario");

  const sinSala = await db.ocupacion.count({ where: { operadorId: "op1", salaId: null } });
  assert.equal(sinSala, r.data.creadas, "todas las ocurrencias van sin consultorio");
});

test("el consultorio queda LIBRE: otro profesional puede alquilarlo a la misma hora", async () => {
  const a = await ajena(owner, SIN_SALA);
  assert.ok(a.ok && a.data.ok);

  // Lunes, que es cuando la sala abre, para que el único motivo posible de rechazo sea el choque.
  const lunes = sumarDiasLocal(MIERCOLES, 5)!;
  assert.equal(diaSemanaDeFecha(lunes), 1, "el control del test: tiene que caer lunes");
  const b = await ajena(owner, { salaId: "sa1", fecha: lunes, hora: "10:00", duracionMin: 120, inquilinoId: "in2" });
  assert.ok(b.ok && b.data.ok, "la sala tiene que estar disponible para otro");
});

test("se cobra igual que si hubiera usado el consultorio", async () => {
  // Tarifa general: $8.000 la hora. Sin sala, la reserva tiene que cotizar con esta misma.
  await pgPool.query(
    `INSERT INTO "Tarifa"("id","operadorId","salaId","inquilinoId","nombre","precioHoraCent","vigenteDesde")
     VALUES('t1','op1',NULL,NULL,'General',800000, now() - interval '1 day')`,
  );

  const r = await ajena(owner, SIN_SALA);
  assert.ok(r.ok && r.data.ok);

  const fila = await db.ocupacion.findFirst({ where: { operadorId: "op1" }, select: { importeCent: true, precioHoraCent: true } });
  assert.equal(fila?.precioHoraCent, 800000n, "el precio por hora es el general");
  assert.equal(fila?.importeCent, 2400000n, "3 horas a $8.000 = $24.000");

  // Y el cargo tiene que estar asentado: la hora se factura, que es todo el punto del caso.
  const cargo = await db.asiento.findFirst({ where: { operadorId: "op1", concepto: "cargo_uso" }, select: { montoCent: true } });
  assert.equal(cargo?.montoCent, 2400000n, "el cargo va al libro igual que una reserva normal");
});

test("el profesional NO puede agendarse sin consultorio: es una función del admin", async () => {
  const r = await propia(profesional, { salaId: "", fecha: MIERCOLES, hora: "10:00", duracionMin: 180 });
  assert.ok(!r.ok, "el esquema de la acción propia exige sala");
  if (!r.ok) assert.equal(r.error, "ENTRADA_INVALIDA");
  assert.equal(await db.ocupacion.count({ where: { operadorId: "op1" } }), 0, "cero escrituras");
});

test("sin consultorio el profesional sigue sin poder estar en dos lugares a la vez", async () => {
  // Este va en LUNES, el día que las salas abren: para que el choque sea el único motivo posible
  // de rechazo. En miércoles el segundo turno daría FUERA_DE_HORARIO —correcto, pero por la sala—
  // y el test no estaría probando lo que dice.
  const lunes = sumarDiasLocal(MIERCOLES, 5)!;
  const a = await ajena(owner, { ...SIN_SALA, fecha: lunes });
  assert.ok(a.ok && a.data.ok, "el de 10 a 13 sin consultorio tiene que entrar");

  // Misma persona, mismo rango, ahora pidiendo un consultorio: tiene que chocar.
  const b = await ajena(owner, { salaId: "sa1", fecha: lunes, hora: "11:00", duracionMin: 60, inquilinoId: "in1" });
  assert.ok(b.ok && !b.data.ok);
  if (b.ok && !b.data.ok) assert.equal(b.data.error, "SOLAPA_INQUILINO");
});
