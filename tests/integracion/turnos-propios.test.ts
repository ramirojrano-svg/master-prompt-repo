// tests/integracion/turnos-propios.test.ts — el profesional se agenda solo (§6.2).
//
// Lo que se protege no es que ande: es que NO pueda tocar lo del de al lado. En las acciones
// "propias" el inquilino no viaja en el formulario —se toma de la sesión— y el dueño de cada fila
// se verifica contra la base. Sin eso, cambiar un campo oculto en el navegador alcanzaría para
// agendar o cancelar a nombre de otro, y el permiso `reserva.crear.propia` no frenaría nada:
// desde su punto de vista la acción sería legítima.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import {
  cancelarReservaPropiaCon,
  crearReservaAjenaCon,
  crearReservaPropiaCon,
  moverReservaPropiaCon,
} from "../../src/servicios/agenda/acciones.ts";
import { prisma } from "../../src/db/prisma.ts";
import { nuevoPool, reiniciarEsquema, seedBase, TZ_SEDE, URL_DB } from "./db.ts";
import { fechaEnZona, sumarDiasLocal } from "../../src/dominio/motor/zona.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: `${URL_DB}?connection_limit=20&pool_timeout=20` });

const crearPropia = crearReservaPropiaCon(db);
const crearAjena = crearReservaAjenaCon(db);
const cancelarPropia = cancelarReservaPropiaCon(db);
const moverPropia = moverReservaPropiaCon(db);

const owner = { usuarioId: "u1", operadorId: "op1", rol: "owner" as const, inquilinoId: null };
// El profesional dueño de la ficha in1, y otro dueño de in2.
const laura = { usuarioId: "u2", operadorId: "op1", rol: "inquilino_titular" as const, inquilinoId: "in1" };
const otro = { usuarioId: "u3", operadorId: "op1", rol: "inquilino_titular" as const, inquilinoId: "in2" };
// Un acceso de profesional que nadie asoció a una ficha: pasa de verdad al crear el usuario.
const sinFicha = { usuarioId: "u4", operadorId: "op1", rol: "inquilino_titular" as const, inquilinoId: null };

// Fecha futura calculada desde el reloj Y en la zona de la sede: una fija se vuelve pasado y el
// test empieza a fallar solo; en UTC se corre de día contra un centro argentino.
const enDias = (n: number) => sumarDiasLocal(fechaEnZona(new Date(), TZ_SEDE), n)!;
const base = { salaId: "sa1", hora: "10:00", duracionMin: 60 };

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
  // Abierto los 7 días: si no, el resultado depende de en qué día de la semana caiga el test.
  const franja = [{ desde: "08:00", hasta: "22:00" }];
  const H = JSON.stringify({ "0": franja, "1": franja, "2": franja, "3": franja, "4": franja, "5": franja, "6": franja });
  await pgPool.query(`UPDATE "Sala" SET "horarioJson"=$1::jsonb`, [H]);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Ocupacion", "Asiento" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

const suyas = () => db.ocupacion.findMany({ where: { operadorId: "op1" }, select: { id: true, inquilinoId: true, salaId: true } });

test("un profesional crea SU turno", async () => {
  const r = await crearPropia(laura, { ...base, fecha: enDias(3) });
  assert.ok(r.ok && r.data.ok, "debería crearse");

  const filas = await suyas();
  assert.equal(filas.length, 1);
  assert.equal(filas[0]!.inquilinoId, "in1", "el turno queda a su nombre");
});

test("EL PUNTO: el turno queda a su nombre aunque el formulario diga otra cosa", async () => {
  // El esquema de la acción propia no tiene inquilinoId, así que un campo de más se descarta antes
  // de llegar al servicio. Si el día de mañana alguien lo agrega al esquema, este test cae.
  const r = await crearPropia(laura, { ...base, fecha: enDias(4), inquilinoId: "in2" } as never);
  assert.ok(r.ok && r.data.ok);

  const filas = await suyas();
  assert.equal(filas[0]!.inquilinoId, "in1", "manda la sesión, no el formulario");
});

test("no puede cancelar el turno de otro profesional", async () => {
  // El otro reserva (lo carga el owner, como haría el centro).
  const creada = await crearAjena(owner, { ...base, fecha: enDias(5), inquilinoId: "in2" });
  assert.ok(creada.ok && creada.data.ok);
  const [fila] = await suyas();

  const r = await cancelarPropia(laura, { ocupacionId: fila!.id, alcance: "solo" });
  assert.ok(r.ok && !r.data.ok && r.data.error === "NO_ENCONTRADO");
  // Y sigue ahí: no alcanzó con pedirlo.
  assert.equal((await suyas()).length, 1);
});

test("el turno ajeno y el inexistente responden IGUAL", async () => {
  // Si "no es tuyo" y "no existe" dieran errores distintos, la pantalla sería un detector de
  // turnos ajenos: probando ids se sabría cuáles existen (§6.11).
  const creada = await crearAjena(owner, { ...base, fecha: enDias(6), inquilinoId: "in2" });
  assert.ok(creada.ok && creada.data.ok);
  const [fila] = await suyas();

  const ajeno = await cancelarPropia(laura, { ocupacionId: fila!.id, alcance: "solo" });
  const fantasma = await cancelarPropia(laura, { ocupacionId: "no-existe", alcance: "solo" });
  assert.deepEqual(ajeno.ok && ajeno.data, fantasma.ok && fantasma.data);
});

test("sí puede cancelar el suyo", async () => {
  await crearPropia(laura, { ...base, fecha: enDias(7) });
  const [fila] = await suyas();

  const r = await cancelarPropia(laura, { ocupacionId: fila!.id, alcance: "solo" });
  assert.ok(r.ok && r.data.ok, "el suyo sí");
});

test("no puede mover el turno de otro", async () => {
  const creada = await crearAjena(owner, { ...base, fecha: enDias(8), inquilinoId: "in2" });
  assert.ok(creada.ok && creada.data.ok);
  const [fila] = await suyas();

  const r = await moverPropia(laura, { ocupacionId: fila!.id, salaDestinoId: "sa2", fecha: enDias(9), hora: "11:00" });
  assert.ok(r.ok && !r.data.ok && r.data.error === "NO_ENCONTRADO");
  assert.equal((await suyas())[0]!.salaId, "sa1", "no se movió");
});

test("sí puede mover el suyo", async () => {
  await crearPropia(laura, { ...base, fecha: enDias(10) });
  const [fila] = await suyas();

  const r = await moverPropia(laura, { ocupacionId: fila!.id, salaDestinoId: "sa2", fecha: enDias(10), hora: "11:00" });
  assert.ok(r.ok && r.data.ok, "el suyo sí");
});

test("un acceso de profesional sin ficha no reserva 'para nadie'", async () => {
  // Pasa cuando alguien crea el usuario y se olvida de asociarlo. Tiene que decirlo, no fallar
  // raro ni —peor— crear una ocupación sin dueño.
  const r = await crearPropia(sinFicha, { ...base, fecha: enDias(11) });
  assert.ok(r.ok && !r.data.ok && r.data.error === "SIN_FICHA");
  assert.equal((await suyas()).length, 0);
});

test("el choque con otro profesional se rechaza igual que en el alta del centro", async () => {
  // El motor es el mismo: la acción propia no es un camino paralelo con reglas más flojas.
  const fecha = enDias(12);
  const creada = await crearAjena(owner, { ...base, fecha, inquilinoId: "in2" });
  assert.ok(creada.ok && creada.data.ok);

  const r = await crearPropia(laura, { ...base, fecha });
  assert.ok(r.ok && !r.data.ok, "ese consultorio ya está tomado a esa hora");
  assert.equal((await suyas()).length, 1);
});

test("el owner NO pierde lo suyo: sigue pudiendo cargar a nombre de otro", async () => {
  const r = await crearAjena(owner, { ...base, fecha: enDias(13), inquilinoId: "in2" });
  assert.ok(r.ok && r.data.ok);
});

test("un profesional no puede usar la acción AJENA", async () => {
  const r = await crearAjena(otro, { ...base, fecha: enDias(14), inquilinoId: "in1" });
  assert.ok(!r.ok, "la puerta de 'a nombre de otro' le sigue cerrada");
});

// ── Lo que ya pasó no se toca ───────────────────────────────────────────────
// La pantalla no ofrece el botón, pero esconderlo no alcanza: una server action es un endpoint
// HTTP público. Cancelar una hora que ya ocurrió no libera nada —la sala estuvo ocupada igual— y
// le borraría de la cuenta algo que sí usó.

/** Una reserva que ya ocurrió. Se inserta cruda: el motor, con razón, no deja crear en el pasado. */
async function reservaPasada(id: string, inquilinoId: string) {
  const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const fin = new Date(ayer.getTime() + 60 * 60 * 1000);
  await pgPool.query(
    `INSERT INTO "Ocupacion"("id","operadorId","sedeId","salaId","inquilinoId","tipo","estado","inicio","fin","tzSede")
     VALUES($1,'op1','se1','sa1',$2,'reserva','confirmada',$3,$4,$5)`,
    [id, inquilinoId, ayer, fin, TZ_SEDE],
  );
}

test("el profesional NO puede cancelar un turno que ya pasó", async () => {
  await reservaPasada("vieja", "in1");

  const r = await cancelarPropia(laura, { ocupacionId: "vieja", alcance: "solo" });
  assert.ok(r.ok, "el permiso está: lo que falla es la regla, no el rol");
  if (r.ok) assert.equal(r.data.ok === false && r.data.error, "YA_EMPEZO");

  const fila = await db.ocupacion.findUniqueOrThrow({ where: { id: "vieja" }, select: { estado: true } });
  assert.equal(fila.estado, "confirmada", "sigue en pie: no se canceló nada");
});

test("tampoco puede MOVERLO: correr una hora que ya ocurrió es reescribir el pasado", async () => {
  await reservaPasada("vieja2", "in1");

  const r = await moverPropia(laura, {
    ocupacionId: "vieja2",
    salaDestinoId: "sa2",
    fecha: enDias(3),
    hora: "11:00",
  });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.data.ok === false && r.data.error, "YA_EMPEZO");

  const fila = await db.ocupacion.findUniqueOrThrow({ where: { id: "vieja2" }, select: { salaId: true } });
  assert.equal(fila.salaId, "sa1", "no se movió");
});

test("un turno FUTURO se sigue pudiendo cancelar: la regla es la fecha, no un bloqueo general", async () => {
  const creada = await crearPropia(laura, { ...base, fecha: enDias(5) });
  assert.ok(creada.ok && creada.data.ok);
  if (!creada.ok || !creada.data.ok) return;

  const id = (await db.ocupacion.findFirstOrThrow({ where: { inquilinoId: "in1" }, select: { id: true } })).id;
  const r = await cancelarPropia(laura, { ocupacionId: id, alcance: "solo" });
  assert.ok(r.ok && r.data.ok, "el de la semana que viene sí se cancela");
});
