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
import { desajusteDelCentro, reajustarCon, reservasADesajustar } from "../../src/servicios/plata/reajustar.ts";
import { cierreCon } from "../../src/servicios/plata/cierre.ts";
import { crearOcupacion, type CtxReserva } from "../../src/servicios/reservas/crear.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { insertarOcupacion, nuevoPool, reiniciarEsquema, seedBase, TZ_SEDE, URL_DB } from "./db.ts";
import { asentarIdempotente } from "../../src/servicios/plata/ledger.ts";

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

/** Hoy en la zona de la sede, como lo manda el formulario. */
const hoyLocal = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ_SEDE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

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

test("no toca una hora que ocurrió ANTES de que cambiara el precio", async () => {
  // §8.8 de verdad: esa hora se usó cuando regía otro precio, y ese es el que fue.
  //
  // Lo que protege no es un filtro por fecha, es la resolución: a cada reserva le corresponde la
  // tarifa que regía EL DÍA QUE SE USA. Una hora de hace dos meses resuelve contra la tarifa de
  // hace dos meses —la que ya tiene estampada— y no se mueve, aunque hoy se cargue otra.
  await db.tarifa.create({
    data: {
      operadorId: "op1", salaId: null, inquilinoId: "in1", nombre: "viejo",
      precioHoraCent: 600_000n, vigenteDesde: new Date(Date.now() - 120 * 86_400_000),
    },
  });
  const hace60 = new Date(Date.now() - 60 * 86_400_000);
  await insertarOcupacion(pgPool, {
    id: "vieja", salaId: "sa1", inquilinoId: "in1",
    inicio: hace60.toISOString(), fin: new Date(hace60.getTime() + 3_600_000).toISOString(),
  });
  await db.ocupacion.update({ where: { id: "vieja" }, data: { precioHoraCent: 600_000n, importeCent: 600_000n } });

  await tarifas.poner(owner, { precioHora: 7000, inquilinoId: "in1" });

  const o = await db.ocupacion.findUniqueOrThrow({ where: { id: "vieja" }, select: { precioHoraCent: true } });
  assert.equal(o.precioHoraCent, 600_000n, "una hora usada ocurrió a un precio y ese precio es el que fue");
});

test("SÍ toca una hora que ya pasó pero ocurrió DESPUÉS del cambio de precio", async () => {
  // El caso reportado, y el que el filtro por fecha tapaba. Se sube el precio y el turno de hoy a
  // la mañana —que ya ocurrió cuando uno guarda— sucedió igual bajo el precio nuevo: le
  // corresponde el nuevo. Con el filtro viejo se facturaba al anterior y la diferencia se perdía.
  await db.tarifa.create({
    data: {
      operadorId: "op1", salaId: null, inquilinoId: "in1", nombre: "viejo",
      precioHoraCent: 600_000n, vigenteDesde: new Date(Date.now() - 120 * 86_400_000),
    },
  });
  const hace6h = new Date(Date.now() - 6 * 3_600_000);
  await insertarOcupacion(pgPool, {
    id: "hoy", salaId: "sa1", inquilinoId: "in1",
    inicio: hace6h.toISOString(), fin: new Date(hace6h.getTime() + 3_600_000).toISOString(),
  });
  await db.ocupacion.update({ where: { id: "hoy" }, data: { precioHoraCent: 600_000n, importeCent: 600_000n } });
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId: "in1", concepto: "cargo_uso", montoCent: 600_000n, moneda: "ARS",
    periodo: hace6h.toISOString().slice(0, 7), fechaHecho: hace6h, clave: "cargo_uso:hoy", reservaId: "hoy",
  });

  // Como lo carga el operador: "rige desde hoy", que quiere decir el día entero.
  const r = await tarifas.poner(owner, { precioHora: 7000, inquilinoId: "in1", vigenteDesde: hoyLocal() });

  assert.ok(r.ok && r.data.ok && r.data.aplicadas === 1);
  const o = await db.ocupacion.findUniqueOrThrow({ where: { id: "hoy" }, select: { precioHoraCent: true } });
  assert.equal(o.precioHoraCent, 700_000n);
  const c = await db.asiento.findFirstOrThrow({ where: { clave: "cargo_uso:hoy" }, select: { montoCent: true } });
  assert.equal(c.montoCent, 700_000n, "y el cargo también, o la liquidación cobra otra cosa");
});

test("el caso de Laila: nueve turnos de cuatro horas, uno ya ocurrido hoy", async () => {
  // 36 horas a 7.100 son 255.600. Facturaba 251.200: ocho turnos al precio nuevo y el de hoy a la
  // mañana al viejo. La diferencia —4.400, cuatro horas entre 6.000 y 7.100— se perdía todos los
  // meses, en cada profesional que tuviera un turno el día del cambio.
  await db.tarifa.create({
    data: {
      operadorId: "op1", salaId: null, inquilinoId: "in1", nombre: "viejo",
      precioHoraCent: 600_000n, vigenteDesde: new Date(Date.now() - 120 * 86_400_000),
    },
  });
  const cuatroHoras = async (id: string, inicio: Date) => {
    await insertarOcupacion(pgPool, {
      id, salaId: "sa1", inquilinoId: "in1",
      inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + 4 * 3_600_000).toISOString(),
    });
    await db.ocupacion.update({ where: { id }, data: { precioHoraCent: 600_000n, importeCent: 2_400_000n } });
    await asentarIdempotente(db, {
      operadorId: "op1", inquilinoId: "in1", concepto: "cargo_uso", montoCent: 2_400_000n, moneda: "ARS",
      periodo: inicio.toISOString().slice(0, 7), fechaHecho: inicio, clave: `cargo_uso:${id}`, reservaId: id,
    });
  };
  await cuatroHoras("ya", new Date(Date.now() - 6 * 3_600_000));
  for (let n = 0; n < 8; n++) await cuatroHoras(`f${n}`, new Date(Date.now() + (n + 2) * 86_400_000));

  const r = await tarifas.poner(owner, { precioHora: 7100, inquilinoId: "in1", vigenteDesde: hoyLocal() });

  assert.ok(r.ok && r.data.ok);
  assert.equal(r.data.aplicadas, 9, "los nueve, no ocho");
  const suma = await db.asiento.aggregate({ where: { inquilinoId: "in1", concepto: "cargo_uso" }, _sum: { montoCent: true } });
  assert.equal(suma._sum.montoCent, 25_560_000n, "36 horas a 7.100 = 255.600");
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

// ── Los dos silencios: cuando el precio nuevo NO llega ──────────────────────
//
// Caso reportado: se cargan los aumentos de octubre en Precios y Cierre de mes de octubre sigue
// mostrando los importes viejos. El precio se guardaba bien; lo que fallaba era que no llegaba a
// destino y la pantalla no lo decía. Hay dos motivos distintos y los dos se veían igual —"Guardado"
// y nada cambia—, así que los dos tienen que ser detectables desde el código que arma la pantalla.

test("un precio GENERAL no le llega a quien tiene precio propio", async () => {
  // No es un bug: el propio le gana por ser más específico, y así tiene que ser. El bug era que
  // pasara en silencio.
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: null });
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: "in1" });
  await reservar(13, "in1");
  await reservar(15, "in2");

  const r = await tarifas.poner(owner, { precioHora: 9000, inquilinoId: null });

  assert.ok(r.ok && r.data.ok);
  assert.equal(r.data.aplicadas, 1, "solo in2, que sigue el general");
  assert.equal(await precioDe("in1"), 600_000n, "in1 conserva SU precio");
  assert.equal(await precioDe("in2"), 900_000n);
});

test("subirle el precio propio a esa persona sí le llega", async () => {
  // La salida del caso de arriba, para que el test diga también qué hay que hacer.
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: null });
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: "in1" });
  await reservar(13, "in1");

  const r = await tarifas.poner(owner, { precioHora: 9000, inquilinoId: "in1" });

  assert.ok(r.ok && r.data.ok && r.data.aplicadas === 1);
  assert.equal(await precioDe("in1"), 900_000n);
});

test("'Todos menos…' sube a todos de una, con el importe de cada uno", async () => {
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: null });
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: "in1" });
  await reservar(13, "in1");
  await reservar(15, "in2");

  const r = await tarifas.ponerLote(owner, {
    precioHora: 9000,
    excepciones: [{ inquilinoId: "in1", precioHora: 7000 }],
  });

  assert.ok(r.ok && r.data.ok);
  assert.equal(await precioDe("in1"), 700_000n, "el que tenía precio propio también se actualizó");
  assert.equal(await precioDe("in2"), 900_000n);
});

test("el mes ya liquidado se informa aparte, no se confunde con 'no hacía falta'", async () => {
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: "in1" });
  await reservar(13, "in1");
  const periodo = new Intl.DateTimeFormat("en-CA", { timeZone: TZ_SEDE, year: "numeric", month: "2-digit" })
    .format(new Date(`${DIA}T13:00:00.000Z`)).slice(0, 7);
  const c = await cierreCon(db).todos(owner, { periodo, venceEl: `${periodo}-28` });
  assert.ok(c.ok && c.data.cerradas === 1);

  const r = await tarifas.poner(owner, { precioHora: 9000, inquilinoId: "in1" });
  assert.ok(r.ok && r.data.ok && r.data.aplicadas === 0, "no se puede tocar un papel emitido");

  const { reajustables, selladas } = await desajusteDelCentro({ operadorId: "op1" }, db);
  assert.equal(reajustables.length, 0);
  assert.equal(selladas.length, 1, "pero la pantalla tiene que poder decir POR QUÉ no se aplicó");
  assert.equal(selladas[0]!.inquilinoId, "in1");
  assert.equal(selladas[0]!.reservas, 1);
  assert.equal(selladas[0]!.deCent, 600_000n);
  assert.equal(selladas[0]!.aCent, 900_000n);
});

test("un centro al día no reporta nada sellado", async () => {
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: "in1" });
  await reservar(13, "in1");

  const { reajustables, selladas } = await desajusteDelCentro({ operadorId: "op1" }, db);
  assert.equal(reajustables.length, 0);
  assert.equal(selladas.length, 0, "sin desfasaje no hay nada que avisar");
});

// ── Tarifas viejas POR CONSULTORIO ──────────────────────────────────────────
//
// El caso reportado, y el más difícil de ver desde la pantalla: se carga el precio nuevo de una
// profesional, la lista de precios lo muestra, y sus reservas siguen cotizando al viejo. Para
// siempre, sin aviso.
//
// La causa es una tarifa vieja (sala + profesional) que quedó abierta de cuando el precio podía
// depender del consultorio. Es MÁS específica que una de profesional, así que gana; y como el
// formulario ya no puede crear ni editar una tarifa por sala, no había ninguna forma de sacarla
// desde la app. El precio nuevo se guardaba y no servía para nada.

/** Una tarifa por sala de las que ya no se pueden crear, como las que quedaron en la base. */
async function tarifaLegacyPorSala(precioHora: number, inquilinoId: string | null) {
  await db.tarifa.create({
    data: {
      operadorId: "op1", salaId: "sa1", inquilinoId, nombre: "legacy",
      precioHoraCent: BigInt(precioHora) * 100n,
      vigenteDesde: new Date(Date.now() - 90 * 86_400_000),
    },
  });
}

test("el precio nuevo de la profesional le gana a su tarifa vieja por consultorio", async () => {
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: null });
  await tarifaLegacyPorSala(6000, "in1");
  await reservar(13, "in1");
  assert.equal(await precioDe("in1"), 600_000n, "nace con la vieja, que es la que gana");

  const r = await tarifas.poner(owner, { precioHora: 7100, inquilinoId: "in1" });

  assert.ok(r.ok && r.data.ok);
  assert.equal(r.data.porSala, 1, "tiene que decir que sacó una tarifa por consultorio");
  assert.equal(r.data.aplicadas, 1);
  assert.equal(await precioDe("in1"), 710_000n, "la reserva queda al precio nuevo");
  assert.equal(await cargoDe("in1"), 710_000n);
});

test("el precio general le gana a una tarifa vieja de solo consultorio", async () => {
  // La misma trampa sin dueño: una tarifa de sala sin profesional también le gana al general.
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: null });
  await tarifaLegacyPorSala(6000, null);
  await reservar(13, "in1");

  const r = await tarifas.poner(owner, { precioHora: 9100, inquilinoId: null });

  assert.ok(r.ok && r.data.ok && r.data.porSala === 1);
  assert.equal(await precioDe("in1"), 910_000n);
});

test("el precio general NO pisa el precio propio de un profesional", async () => {
  // El barrido nuevo es más amplio, y esta es la línea que no puede cruzar: la precedencia entre
  // general y precio propio es correcta y es la que el operador espera.
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: null });
  await tarifas.poner(owner, { precioHora: 6500, inquilinoId: "in1" });
  await reservar(13, "in1");

  await tarifas.poner(owner, { precioHora: 9100, inquilinoId: null });

  assert.equal(await precioDe("in1"), 650_000n, "sigue con el suyo");
  const suyas = await db.tarifa.count({ where: { inquilinoId: "in1", vigenteHasta: null } });
  assert.equal(suyas, 1, "su tarifa propia sigue abierta");
});

test("'Todos menos…' también saca las tarifas viejas por consultorio", async () => {
  // El caso real completo: general nuevo con excepciones, sobre una base que tiene legacy.
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: null });
  await tarifaLegacyPorSala(6000, "in1");
  await reservar(13, "in1");
  await reservar(15, "in2");

  const r = await tarifas.ponerLote(owner, {
    precioHora: 9100,
    excepciones: [{ inquilinoId: "in1", precioHora: 7100 }],
  });

  assert.ok(r.ok && r.data.ok);
  assert.equal(await precioDe("in1"), 710_000n, "Laila al precio nuevo, no al de la tarifa vieja");
  assert.equal(await precioDe("in2"), 910_000n);
  assert.equal(await db.tarifa.count({ where: { salaId: { not: null }, vigenteHasta: null } }), 0);
});

test("cerrar una tarifa vieja no borra nada: el historial queda", async () => {
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: null });
  await tarifaLegacyPorSala(6000, "in1");

  await tarifas.poner(owner, { precioHora: 7100, inquilinoId: "in1" });

  const legacy = await db.tarifa.findFirstOrThrow({ where: { nombre: "legacy" }, select: { vigenteHasta: true } });
  assert.ok(legacy.vigenteHasta !== null, "se cierra, no se borra: el resumen de meses viejos se sigue explicando");
});

// ── "Rige desde" ────────────────────────────────────────────────────────────
//
// Un aumento casi nunca empieza en el minuto en que uno se sienta a cargarlo: se carga el 30 de
// septiembre y vale desde el 1 de octubre, que es la unidad con la que este centro factura. Sin
// fecha, el precio arrancaba en el instante del guardado y partía el día al medio.

const diaLocal = (offsetDias: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ_SEDE, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + offsetDias * 86_400_000));

/** Una reserva en una fecha dada, al precio viejo ya estampado. */
async function reservaEn(id: string, inicio: Date, precioCent: bigint) {
  await insertarOcupacion(pgPool, {
    id, salaId: "sa1", inquilinoId: "in1",
    inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + 3_600_000).toISOString(),
  });
  await db.ocupacion.update({ where: { id }, data: { precioHoraCent: precioCent, importeCent: precioCent } });
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId: "in1", concepto: "cargo_uso", montoCent: precioCent, moneda: "ARS",
    periodo: inicio.toISOString().slice(0, 7), fechaHecho: inicio, clave: `cargo_uso:${id}`, reservaId: id,
  });
}

test("un precio que rige desde MAÑANA no toca lo de hoy", async () => {
  await db.tarifa.create({
    data: {
      operadorId: "op1", salaId: null, inquilinoId: "in1", nombre: "viejo",
      precioHoraCent: 600_000n, vigenteDesde: new Date(Date.now() - 120 * 86_400_000),
    },
  });
  await reservaEn("hoyTemprano", new Date(Date.now() - 4 * 3_600_000), 600_000n);
  await reservaEn("pasadoManana", new Date(Date.now() + 2 * 86_400_000), 600_000n);

  const r = await tarifas.poner(owner, { precioHora: 7100, inquilinoId: "in1", vigenteDesde: diaLocal(1) });

  assert.ok(r.ok && r.data.ok);
  assert.equal(r.data.aplicadas, 1, "solo la de pasado mañana");
  const hoy = await db.ocupacion.findUniqueOrThrow({ where: { id: "hoyTemprano" }, select: { precioHoraCent: true } });
  const dsp = await db.ocupacion.findUniqueOrThrow({ where: { id: "pasadoManana" }, select: { precioHoraCent: true } });
  assert.equal(hoy.precioHoraCent, 600_000n, "lo anterior a la fecha de vigencia no se toca");
  assert.equal(dsp.precioHoraCent, 710_000n);
});

test("un precio que rige desde AYER alcanza lo de hoy a la mañana", async () => {
  // Cargar el 30/9 con vigencia desde el 1/10 y mirarlo el 1/10: el turno de la mañana entra.
  await db.tarifa.create({
    data: {
      operadorId: "op1", salaId: null, inquilinoId: "in1", nombre: "viejo",
      precioHoraCent: 600_000n, vigenteDesde: new Date(Date.now() - 120 * 86_400_000),
    },
  });
  await reservaEn("hoyTemprano", new Date(Date.now() - 4 * 3_600_000), 600_000n);
  await reservaEn("anteayer", new Date(Date.now() - 2 * 86_400_000), 600_000n);

  const r = await tarifas.poner(owner, { precioHora: 7100, inquilinoId: "in1", vigenteDesde: diaLocal(-1) });

  assert.ok(r.ok && r.data.ok);
  const hoy = await db.ocupacion.findUniqueOrThrow({ where: { id: "hoyTemprano" }, select: { precioHoraCent: true } });
  const ant = await db.ocupacion.findUniqueOrThrow({ where: { id: "anteayer" }, select: { precioHoraCent: true } });
  assert.equal(hoy.precioHoraCent, 710_000n, "ocurrió después de la vigencia: precio nuevo");
  assert.equal(ant.precioHoraCent, 600_000n, "ocurrió antes: no se toca");
});

test("sin fecha, rige desde ahora: el comportamiento de siempre", async () => {
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: "in1" });
  await reservar(13);

  const r = await tarifas.poner(owner, { precioHora: 7000, inquilinoId: "in1" });

  assert.ok(r.ok && r.data.ok && r.data.aplicadas === 1);
  assert.equal(await precioDe(), 700_000n);
});

test("'Todos menos…' usa UNA sola fecha para el general y las excepciones", async () => {
  // Dos marcas de tiempo distintas dejarían una ventana con media decisión aplicada.
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: null });
  await reservar(13, "in1");
  await reservar(15, "in2");

  const r = await tarifas.ponerLote(owner, {
    precioHora: 9100,
    excepciones: [{ inquilinoId: "in1", precioHora: 7100 }],
    vigenteDesde: diaLocal(-1),
  });

  assert.ok(r.ok && r.data.ok);
  const abiertas = await db.tarifa.findMany({ where: { vigenteHasta: null }, select: { vigenteDesde: true } });
  const distintas = new Set(abiertas.map((t) => t.vigenteDesde.getTime()));
  assert.equal(distintas.size, 1, "todas las del lote arrancan en el mismo instante");
});
