// tests/integracion/reajustar-precio.test.ts — que un aumento entre en vigencia.
//
// Caso real: a una profesional se le sube la hora de 6.000 a 7.000. Sus reservas de septiembre ya
// estaban cargadas —se cargan en agosto—, así que habían estampado 6.000 al nacer (§8.8) y
// septiembre se le seguía cobrando al precio viejo. Un aumento no tenía forma de aplicarse salvo
// borrando y recargando las reservas a mano.
//
// La línea que se prueba es la que separa lo que se puede reajustar de lo que no, y no es
// "vieja o nueva" sino "¿ya salió del centro?": una hora usada ocurrió a un precio, y una hora ya
// liquidada está adentro de un papel numerado que el profesional tiene.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { tarifasCon } from "../../src/servicios/config/tarifas.ts";
import { reajustarCon, reservasADesajustar } from "../../src/servicios/plata/reajustar.ts";
import { cierreCon } from "../../src/servicios/plata/cierre.ts";
import { crearOcupacion, type CtxReserva } from "../../src/servicios/reservas/crear.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { nuevoPool, reiniciarEsquema, seedBase, TZ_SEDE, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });
const tarifas = tarifasCon(db);
const reajustar = reajustarCon(db);

const owner: Actor = { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null };
const profesional: Actor = { usuarioId: "u2", operadorId: "op1", rol: "inquilino_titular", inquilinoId: "in1" };

const abierto = [{ desde: "06:00", hasta: "23:00" }];
const HORARIO: CtxReserva["horario"] = { 0: abierto, 1: abierto, 2: abierto, 3: abierto, 4: abierto, 5: abierto, 6: abierto };
const POLITICA: CtxReserva["politica"] = { pasoMin: 30, duracionMinMin: 15, duracionMaxMin: 720, bufferMin: 15, bufferMismoInquilino: 0, antelacionMinMin: 0, horizonteDias: 3650 };
const ctx = (inquilinoId = "in1"): CtxReserva => ({ operadorId: "op1", inquilinoId, politica: POLITICA, horario: HORARIO, bloqueaProfesional: true });

// A 30 días: siempre futuro, sin clavar una fecha que caduque.
const DIA = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const reservar = (hZ: number, inquilinoId = "in1") =>
  crearOcupacion({ salaId: "sa1", fecha: DIA, inicioISO: `${DIA}T${String(hZ).padStart(2, "0")}:00:00.000Z`, duracionMin: 60 }, ctx(inquilinoId), db);

const precioDe = async (i = "in1") =>
  (await db.ocupacion.findFirst({ where: { inquilinoId: i }, select: { precioHoraCent: true } }))?.precioHoraCent;
const cargoDe = async (i = "in1") =>
  (await db.asiento.findFirst({ where: { inquilinoId: i, concepto: "cargo_uso" }, select: { montoCent: true } }))?.montoCent;

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Ocupacion","Tarifa","Asiento","Liquidacion" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

/**
 * Deja un precio nuevo vigente SIN aplicarlo, escribiendo la tarifa a mano.
 *
 * Hace falta desde que guardar un precio lo aplica solo: los tests del reajuste MANUAL necesitan
 * un desfasaje para tener algo que reajustar, y con `tarifas.poner` ya no queda ninguno. El botón
 * de la pantalla de Precios sigue existiendo para lo que se haya desfasado por otro camino —una
 * reserva creada mientras se guardaba el precio, un arreglo a mano en la base—, y esto reproduce
 * exactamente ese estado.
 */
async function tarifaSinAplicar(precioHora: number, inquilinoId: string | null = null) {
  const ahora = new Date();
  await db.tarifa.updateMany({
    where: { operadorId: "op1", salaId: null, inquilinoId, vigenteHasta: null },
    data: { vigenteHasta: ahora },
  });
  await db.tarifa.create({
    data: {
      operadorId: "op1", salaId: null, inquilinoId,
      nombre: inquilinoId ?? "General",
      precioHoraCent: BigInt(precioHora) * 100n,
      vigenteDesde: ahora,
    },
  });
}

test("el caso reportado: subir la hora aplica a las reservas futuras", async () => {
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: "in1" });
  await reservar(13);
  assert.equal(await precioDe(), 600_000n, "nace con el precio de hoy");

  await tarifaSinAplicar(7000, "in1");
  const r = await reajustar(owner, {});
  assert.ok(r.ok);
  assert.equal(r.data.reajustadas, 1);

  assert.equal(await precioDe(), 700_000n, "la reserva tiene que quedar al precio nuevo");
  assert.equal(await cargoDe(), 700_000n, "y el cargo también, o la agenda y la cuenta dirían cosas distintas");
});

test("dice lo que va a cambiar ANTES de tocarlo", async () => {
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: "in1" });
  await reservar(13);
  await reservar(15);
  await tarifaSinAplicar(7000, "in1");

  const previo = await reservasADesajustar({ operadorId: "op1" }, db);
  assert.equal(previo.length, 2);
  assert.equal(previo[0]!.deCent, 600_000n);
  assert.equal(previo[0]!.aCent, 700_000n);
  // Y mirar no escribe.
  assert.equal(await precioDe(), 600_000n);
});

test("una reserva YA LIQUIDADA no se toca, aunque sea futura", async () => {
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: "in1" });
  await reservar(13);
  const periodo = new Intl.DateTimeFormat("en-CA", { timeZone: TZ_SEDE, year: "numeric", month: "2-digit" })
    .format(new Date(`${DIA}T13:00:00.000Z`)).slice(0, 7);
  const { todos } = cierreCon(db);
  const c = await todos(owner, { periodo, venceEl: `${periodo}-28` });
  assert.ok(c.ok && c.data.cerradas === 1, "el escenario arranca con el mes cerrado");

  await tarifas.poner(owner, { precioHora: 7000, inquilinoId: "in1" });
  const r = await reajustar(owner, {});
  assert.ok(r.ok && r.data.reajustadas === 0, "hay un papel emitido con ese número adentro");
  assert.equal(await precioDe(), 600_000n);
  assert.equal(await cargoDe(), 600_000n);
});

test("no toca las horas que ya pasaron", async () => {
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: "in1" });
  await reservar(13);
  await tarifas.poner(owner, { precioHora: 7000, inquilinoId: "in1" });

  // Un instante posterior a la reserva: para el reajuste, esa hora ya ocurrió.
  const despues = new Date(Date.now() + 60 * 86_400_000);
  const filas = await reservasADesajustar({ operadorId: "op1" }, db, despues);
  assert.equal(filas.length, 0, "una hora usada ocurrió a un precio y ese precio es el que fue");
});

test("se puede reajustar a UNO solo sin tocar a los demás", async () => {
  await tarifas.poner(owner, { precioHora: 6000 }); // general, para los dos
  await reservar(13, "in1");
  await reservar(15, "in2");
  await tarifaSinAplicar(9000, "in1"); // solo a in1

  const r = await reajustar(owner, { inquilinoId: "in1" });
  assert.ok(r.ok && r.data.reajustadas === 1);
  assert.equal(await precioDe("in1"), 900_000n);
  assert.equal(await precioDe("in2"), 600_000n, "el de al lado no se toca");
});

test("reajustar dos veces seguidas no vuelve a mover nada", async () => {
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: "in1" });
  await reservar(13);
  await tarifaSinAplicar(7000, "in1");

  const a = await reajustar(owner, {});
  const b = await reajustar(owner, {});
  assert.equal(a.ok && a.data.reajustadas, 1);
  assert.equal(b.ok && b.data.reajustadas, 0, "ya estaban al día");
  assert.equal(await cargoDe(), 700_000n);
});

test("una BAJA de precio también se aplica: no es solo para aumentos", async () => {
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: "in1" });
  await reservar(13);
  await tarifaSinAplicar(4000, "in1");

  const r = await reajustar(owner, {});
  assert.ok(r.ok && r.data.reajustadas === 1);
  assert.equal(await cargoDe(), 400_000n);
  assert.ok(r.ok && r.data.difCent < 0n, "la diferencia tiene que dar a favor del profesional");
});

test("un profesional no puede reajustar precios", async () => {
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: "in1" });
  await reservar(13);
  await tarifaSinAplicar(7000, "in1");

  const r = await reajustar(profesional, {});
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error, "SIN_PERMISO");
  assert.equal(await precioDe(), 600_000n, "un rechazo no deja rastro escrito");
});

// ── Guardar el precio ES aplicarlo ──────────────────────────────────────────
//
// El reajuste existía y funcionaba, pero había que ir a buscarlo: se guardaba el precio nuevo y
// las reservas ya agendadas quedaban con el importe viejo hasta que alguien bajaba hasta el aviso
// del final de la pantalla de Precios y apretaba otro botón. El operador cambiaba el valor de la
// hora, miraba la liquidación y seguía viendo el número anterior. Para él eso no era "falta un
// paso": era que el precio no se cambiaba.

test("guardar un precio nuevo lo aplica solo a lo ya agendado", async () => {
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: "in1" });
  await reservar(13);
  assert.equal(await precioDe(), 600_000n);

  const r = await tarifas.poner(owner, { precioHora: 7000, inquilinoId: "in1" });

  assert.ok(r.ok && r.data.ok);
  assert.equal(r.data.aplicadas, 1, "tiene que decir cuántas tocó");
  assert.equal(await precioDe(), 700_000n, "la reserva quedó al precio nuevo sin apretar nada más");
  assert.equal(await cargoDe(), 700_000n, "y el cargo de la cuenta corriente también");
});

test("guardar el precio GENERAL alcanza a quien no tiene precio propio", async () => {
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: null });
  await reservar(13);

  const r = await tarifas.poner(owner, { precioHora: 7000, inquilinoId: null });

  assert.ok(r.ok && r.data.ok);
  assert.equal(r.data.aplicadas, 1);
  assert.equal(await precioDe(), 700_000n);
});

test("ponerle precio a UNO no toca las reservas de los demás", async () => {
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: null });
  await reservar(13, "in1");
  await reservar(15, "in2");

  const r = await tarifas.poner(owner, { precioHora: 9000, inquilinoId: "in1" });

  assert.ok(r.ok && r.data.ok);
  assert.equal(r.data.aplicadas, 1, "solo la de in1");
  assert.equal(await precioDe("in1"), 900_000n);
  assert.equal(await precioDe("in2"), 600_000n, "in2 sigue con el general");
});

test("guardar un precio NO toca una reserva ya liquidada", async () => {
  // El freno que no se puede perder al hacerlo automático: un papel emitido no se reescribe.
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: "in1" });
  await reservar(13);
  const periodo = new Intl.DateTimeFormat("en-CA", { timeZone: TZ_SEDE, year: "numeric", month: "2-digit" })
    .format(new Date(`${DIA}T13:00:00.000Z`)).slice(0, 7);
  const c = await cierreCon(db).todos(owner, { periodo, venceEl: `${periodo}-28` });
  assert.ok(c.ok && c.data.cerradas === 1, "el escenario arranca con el mes cerrado");

  const r = await tarifas.poner(owner, { precioHora: 7000, inquilinoId: "in1" });

  assert.ok(r.ok && r.data.ok);
  assert.equal(r.data.aplicadas, 0, "no había nada reajustable");
  assert.equal(await precioDe(), 600_000n, "la reserva liquidada conserva su precio");
  assert.equal(await cargoDe(), 600_000n);
});

test("dar de baja un precio propio devuelve la reserva al general", async () => {
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: null });
  const propia = await tarifas.poner(owner, { precioHora: 9000, inquilinoId: "in1" });
  assert.ok(propia.ok && propia.data.ok);
  await reservar(13);
  assert.equal(await precioDe(), 900_000n);

  const r = await tarifas.cerrar(owner, { tarifaId: propia.data.id });

  assert.ok(r.ok && r.data.ok);
  assert.equal(await precioDe(), 600_000n, "cae en el general, sin apretar nada más");
});

test("guardar el mismo precio dos veces no mueve nada la segunda", async () => {
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: "in1" });
  await reservar(13);
  const primera = await tarifas.poner(owner, { precioHora: 7000, inquilinoId: "in1" });
  const segunda = await tarifas.poner(owner, { precioHora: 7000, inquilinoId: "in1" });

  assert.ok(primera.ok && primera.data.ok && segunda.ok && segunda.data.ok);
  assert.equal(primera.data.aplicadas, 1);
  assert.equal(segunda.data.aplicadas, 0, "ya estaban al día");
});
