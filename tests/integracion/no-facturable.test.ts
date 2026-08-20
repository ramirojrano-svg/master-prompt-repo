// tests/integracion/no-facturable.test.ts — el que no factura queda AFUERA del circuito de plata.
//
// El caso real: un profesional que usa consultorio y no genera ingresos. Se le destildó "factura"
// en la ficha y se lo sacó de Negocio… pero solo de Negocio. Todo lo demás siguió cobrándole: al
// reservar heredaba la tarifa general —no tiene una propia—, se le estampaba valor por hora y se
// le asentaba un cargo, y esos cargos aparecían en Cierre de mes y en Cobranza como plata a
// reclamar. La casilla decía una cosa y la app hacía otra.
//
// Cada test de acá fija una de las puertas por las que se le colaba un cargo.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { crearOcupacion, type CtxReserva } from "../../src/servicios/reservas/crear.ts";
import { expandirSerie } from "../../src/servicios/reservas/expandir-serie.ts";
import { pendientesDeCierre } from "../../src/servicios/plata/cierre.ts";
import { cobranzaDelMes } from "../../src/servicios/plata/cobranza.ts";
import { recotizarCon, pendientesPorProfesional } from "../../src/servicios/plata/recotizar.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { insertarOcupacion, nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });

const owner: Actor = { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null };
const PERIODO = "2026-08";
const PRECIO_HORA = 700_000n; // $7.000

const HORARIO = ((): CtxReserva["horario"] => {
  const abierto = [{ desde: "06:00", hasta: "23:00" }];
  return { 0: abierto, 1: abierto, 2: abierto, 3: abierto, 4: abierto, 5: abierto, 6: abierto };
})();

const POLITICA: CtxReserva["politica"] = {
  pasoMin: 30, duracionMinMin: 15, duracionMaxMin: 720, bufferMin: 0,
  bufferMismoInquilino: 0, antelacionMinMin: 0, horizonteDias: 3650,
};

function ctx(inquilinoId: string): CtxReserva {
  return {
    operadorId: "op1", inquilinoId, politica: POLITICA, horario: HORARIO,
    bloqueaProfesional: true, ahora: new Date("2026-08-01T00:00:00Z"),
  };
}

/** Una reserva de una hora el 12 de agosto. `hZ` es la hora UTC, para no pisarse entre tests. */
function req(hZ: number) {
  return {
    salaId: "sa1",
    fecha: "2026-08-12",
    inicioISO: `2026-08-12T${String(hZ).padStart(2, "0")}:00:00.000Z`,
    duracionMin: 60,
  };
}

async function asientosDe(inquilinoId: string) {
  const { rows } = await pgPool.query(`SELECT * FROM "Asiento" WHERE "inquilinoId" = $1`, [inquilinoId]);
  return rows;
}

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
  // in1 factura (el default). in2 NO: es el caso de Rubén.
  await pgPool.query(`UPDATE "Inquilino" SET "facturable" = false WHERE id = 'in2'`);
  // Una tarifa GENERAL, sin dueño: es la que hereda todo el que no tiene una propia. Es
  // exactamente el mecanismo por el que al que no factura se le terminaba cobrando.
  await pgPool.query(
    `INSERT INTO "Tarifa"("id","operadorId","nombre","precioHoraCent","vigenteDesde")
     VALUES('ta1','op1','General',$1,'2020-01-01T00:00:00Z')`,
    [PRECIO_HORA.toString()],
  );
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Ocupacion","Asiento","Liquidacion" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

// ── Puerta 1: la reserva suelta ─────────────────────────────────────────────

test("una reserva del que SÍ factura estampa precio y asienta el cargo", async () => {
  const r = await crearOcupacion(req(12), ctx("in1"), db);
  assert.ok(r.ok, "la reserva debería crearse");

  const o = await db.ocupacion.findUniqueOrThrow({ where: { id: r.id }, select: { precioHoraCent: true, importeCent: true } });
  assert.equal(o.precioHoraCent, PRECIO_HORA);
  assert.equal(o.importeCent, PRECIO_HORA);
  assert.equal((await asientosDe("in1")).length, 1);
});

test("la MISMA reserva del que no factura no estampa precio ni asienta nada", async () => {
  const r = await crearOcupacion(req(12), ctx("in2"), db);
  assert.ok(r.ok, "no facturar no impide reservar: usa el consultorio igual");

  const o = await db.ocupacion.findUniqueOrThrow({ where: { id: r.id }, select: { precioHoraCent: true, importeCent: true } });
  assert.equal(o.precioHoraCent, null, "un valor por hora es la promesa de un cobro que no va a existir");
  assert.equal(o.importeCent, null);
  assert.equal((await asientosDe("in2")).length, 0);
});

// ── Puerta 2: la serie semanal ──────────────────────────────────────────────

test("una serie del que no factura crea los turnos y ningún cargo", async () => {
  const r = await expandirSerie(
    { salaId: "sa1", hora: "10:00", duracionMin: 60, fechaInicio: "2026-08-05", repeticion: "semanal", cantidad: 3, modo: "parcial" },
    ctx("in2"),
    db,
  );
  assert.ok(r.ok, "la serie debería crearse");
  assert.equal(r.creadas.length, 3);
  // Acá el error se multiplica: son tres cargos, y en la vida real cincuenta.
  assert.equal((await asientosDe("in2")).length, 0);
});

// ── Puerta 3: el botón "ponerles el precio vigente" ─────────────────────────

test("recotizar no alcanza al que no factura", async () => {
  // Dos reservas viejas sin precio, una de cada uno.
  await insertarOcupacion(pgPool, { id: "oc1", salaId: "sa1", inquilinoId: "in1", inicio: "2026-08-12T13:00:00Z", fin: "2026-08-12T14:00:00Z" });
  await insertarOcupacion(pgPool, { id: "oc2", salaId: "sa1", inquilinoId: "in2", inicio: "2026-08-12T15:00:00Z", fin: "2026-08-12T16:00:00Z" });

  const r = await recotizarCon(db)(owner, {});
  assert.ok(r.ok && r.data.ok);
  assert.equal(r.data.cotizadas, 1, "solo la del que factura");

  const sinTocar = await db.ocupacion.findUniqueOrThrow({ where: { id: "oc2" }, select: { importeCent: true } });
  assert.equal(sinTocar.importeCent, null);
  assert.equal((await asientosDe("in2")).length, 0);
});

test("tampoco aparece en el desglose de 'reservas sin precio'", async () => {
  await insertarOcupacion(pgPool, { id: "oc2", salaId: "sa1", inquilinoId: "in2", inicio: "2026-08-12T15:00:00Z", fin: "2026-08-12T16:00:00Z" });
  // Si figurara acá, el cartel naranja lo seguiría reclamando para siempre y no habría forma de
  // sacarlo: ponerle precio es justamente lo que no se quiere.
  const filas = await pendientesPorProfesional("op1", db);
  assert.equal(filas.find((f) => f.inquilinoId === "in2"), undefined);
});

// ── Puerta 4: las pantallas de plata ────────────────────────────────────────

/** Cargos ya asentados: el estado en el que quedó la base ANTES de estos arreglos. */
async function cargoViejo(inquilinoId: string, clave: string) {
  await pgPool.query(
    `INSERT INTO "Asiento"("id","operadorId","inquilinoId","concepto","montoCent","moneda","periodo","fechaHecho","clave")
     VALUES($1,'op1',$2,'cargo_uso',$3,'ARS',$4,'2026-08-12T12:00:00Z',$5)`,
    [`as-${clave}`, inquilinoId, PRECIO_HORA.toString(), PERIODO, clave],
  );
}

test("Cierre de mes no lo lista, aunque tenga cargos asentados de antes", async () => {
  await cargoViejo("in1", "c:1");
  await cargoViejo("in2", "c:2");

  const filas = await pendientesDeCierre({ operadorId: "op1", periodo: PERIODO }, db);
  assert.ok(filas.find((f) => f.inquilinoId === "in1"), "el que factura sigue estando");
  assert.equal(filas.find((f) => f.inquilinoId === "in2"), undefined, "emitirle una liquidación sería fabricar una deuda");
});

test("Cobranza no lo lista ni lo suma a los totales", async () => {
  await cargoViejo("in1", "c:1");
  await cargoViejo("in2", "c:2");

  const c = await cobranzaDelMes({ operadorId: "op1", periodo: PERIODO }, db);
  assert.ok(c);
  assert.equal(c.filas.find((f) => f.inquilinoId === "in2"), undefined);
  // El total tampoco puede arrastrarlo: si lo sumara, el número de arriba no cerraría con la lista.
  assert.equal(c.totales.emitidoCent, PRECIO_HORA);
});

test("volver a tildar 'factura' lo devuelve al circuito", async () => {
  await cargoViejo("in2", "c:2");
  await pgPool.query(`UPDATE "Inquilino" SET "facturable" = true WHERE id = 'in2'`);

  // No es una decisión de una sola dirección: si fue un error destildarla, se corrige tildándola.
  const filas = await pendientesDeCierre({ operadorId: "op1", periodo: PERIODO }, db);
  assert.ok(filas.find((f) => f.inquilinoId === "in2"));

  await pgPool.query(`UPDATE "Inquilino" SET "facturable" = false WHERE id = 'in2'`);
});
