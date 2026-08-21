// tests/integracion/despreciar.test.ts — sacarle la plata a quien no factura.
//
// El precio se estampa al nacer la reserva y no se vuelve a tocar (§8.8). Esa regla es correcta,
// pero deja un caso sin salida: a alguien se le venía cobrando, se corrige la ficha, y las horas
// ya cargadas siguen con su valor y sus cargos. El profesional queda apareciendo en Cobranza con
// plata que nadie le va a reclamar.
//
// Esto lo limpia. Y lo que hay que probar es el límite: que NO se lleve puesto un mes ya cerrado.
// Un cargo con liquidación salió en un papel que el profesional recibió; borrarlo cambiaría un
// documento emitido, y eso no se hace desde un botón.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { despreciarCon, plataPendienteDe } from "../../src/servicios/plata/despreciar.ts";
import { cerrarPeriodo } from "../../src/servicios/plata/liquidacion.ts";
import { asentarIdempotente } from "../../src/servicios/plata/ledger.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { insertarOcupacion, nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });
const despreciar = despreciarCon(db);

const owner: Actor = { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null };
const profesional: Actor = { usuarioId: "u2", operadorId: "op1", rol: "inquilino_titular", inquilinoId: "in1" };
const PERIODO = "2026-08";
const F = new Date("2026-08-12T12:00:00Z");

/** Una hora distinta por reserva: dos en el mismo slot chocan contra el constraint de exclusión. */
let hora = 12;

/** Una reserva con precio estampado y su cargo, como las que quedaron de antes. */
async function conPrecio(id: string, inquilinoId = "in1", montoCent = 800_000n) {
  const h = String(++hora).padStart(2, "0");
  await insertarOcupacion(pgPool, {
    id, salaId: "sa1", inquilinoId,
    inicio: `2026-08-12T${h}:00:00Z`, fin: `2026-08-12T${h}:45:00Z`,
  });
  await pgPool.query(`UPDATE "Ocupacion" SET "precioHoraCent" = $2, "importeCent" = $2 WHERE id = $1`, [id, montoCent]);
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId, concepto: "cargo_uso", montoCent,
    moneda: "ARS", periodo: PERIODO, fechaHecho: F, clave: `cargo_uso:${id}`, reservaId: id,
  });
}

const noFactura = (id: string) => pgPool.query(`UPDATE "Inquilino" SET "facturable" = false WHERE id = $1`, [id]);

before(async () => {
  await reiniciarEsquema(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Operador","Usuario" CASCADE');
  await seedBase(pgPool);
  hora = 12;
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

// ── Lo que limpia ───────────────────────────────────────────────────────────

test("saca el precio de las reservas y borra los cargos sueltos", async () => {
  await conPrecio("oc1");
  await conPrecio("oc2");
  await noFactura("in1");

  const r = await despreciar(owner, { inquilinoId: "in1" });
  assert.ok(r.ok && r.data.ok);
  assert.equal(r.data.reservas, 2);
  assert.equal(r.data.cargos, 2);

  const o = await db.ocupacion.findUniqueOrThrow({ where: { id: "oc1" }, select: { precioHoraCent: true, importeCent: true, tarifaId: true } });
  // NULL y no cero: "no se cotiza" y "salió $0" son cosas distintas, y meses después nadie las
  // podría distinguir si guardáramos un 0.
  assert.equal(o.precioHoraCent, null);
  assert.equal(o.importeCent, null);
  assert.equal(o.tarifaId, null);
  assert.equal(await db.asiento.count({ where: { operadorId: "op1", inquilinoId: "in1" } }), 0);
});

test("la reserva sigue existiendo: se le saca el precio, no la hora", async () => {
  await conPrecio("oc1");
  await noFactura("in1");
  await despreciar(owner, { inquilinoId: "in1" });

  const o = await db.ocupacion.findUniqueOrThrow({ where: { id: "oc1" }, select: { estado: true, salaId: true } });
  assert.equal(o.estado, "confirmada", "el turno se sigue usando: ocupa el consultorio igual");
  assert.equal(o.salaId, "sa1");
});

// ── El límite que importa ───────────────────────────────────────────────────

test("NO toca un cargo ya liquidado: eso salió en un papel", async () => {
  await conPrecio("oc1");
  const cerrada = await cerrarPeriodo({
    operadorId: "op1", inquilinoId: "in1", periodo: PERIODO, alicuotaDecimas: 0,
    venceEl: new Date("2026-09-10T12:00:00Z"), receptorRazonSocial: "Dra Perez", receptorCondIva: "no informada",
  }, db);
  assert.ok(cerrada.ok);
  // Y una posterior al cierre, que sí se puede limpiar.
  await conPrecio("oc2");
  await noFactura("in1");

  const r = await despreciar(owner, { inquilinoId: "in1" });
  assert.ok(r.ok && r.data.ok);
  assert.equal(r.data.cargos, 1, "solo el que no estaba sellado");
  assert.equal(r.data.sellados, 1, "y se informa el que quedó");

  const sellado = await db.asiento.findFirst({ where: { operadorId: "op1", clave: "cargo_uso:oc1" } });
  assert.ok(sellado, "el cargo liquidado sigue en pie");
  assert.equal(sellado.montoCent, 800_000n, "y con su importe intacto");
});

test("la liquidación emitida no cambia de total", async () => {
  await conPrecio("oc1");
  await cerrarPeriodo({
    operadorId: "op1", inquilinoId: "in1", periodo: PERIODO, alicuotaDecimas: 0,
    venceEl: new Date("2026-09-10T12:00:00Z"), receptorRazonSocial: "Dra Perez", receptorCondIva: "no informada",
  }, db);
  await noFactura("in1");
  await despreciar(owner, { inquilinoId: "in1" });

  const liq = await db.liquidacion.findFirstOrThrow({ where: { operadorId: "op1", inquilinoId: "in1" } });
  assert.equal(liq.totalCent, 800_000n, "el papel que recibió dice lo que dice");
});

// ── Las puertas cerradas ────────────────────────────────────────────────────

test("a quien SÍ factura no se le toca nada", async () => {
  await conPrecio("oc1");
  // Sin destildar la casilla, esto sería "borrarle la plata a un profesional".
  const r = await despreciar(owner, { inquilinoId: "in1" });
  assert.ok(r.ok);
  assert.equal(r.data.ok === false && r.data.error, "SI_FACTURA");

  const o = await db.ocupacion.findUniqueOrThrow({ where: { id: "oc1" }, select: { importeCent: true } });
  assert.equal(o.importeCent, 800_000n);
  assert.equal(await db.asiento.count({ where: { operadorId: "op1", inquilinoId: "in1" } }), 1);
});

test("un profesional no puede hacerlo, ni sobre su propia ficha", async () => {
  await conPrecio("oc1");
  await noFactura("in1");

  const r = await despreciar(profesional, { inquilinoId: "in1" });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error, "SIN_PERMISO");
  assert.equal(await db.asiento.count({ where: { operadorId: "op1", inquilinoId: "in1" } }), 1);
});

test("la ficha de otro centro no se toca por id", async () => {
  const r = await despreciar(owner, { inquilinoId: "no-existe" });
  assert.ok(r.ok);
  assert.equal(r.data.ok === false && r.data.error, "NO_ENCONTRADO");
});

test("no toca al profesional de al lado", async () => {
  await conPrecio("oc1", "in1");
  await conPrecio("oc2", "in2");
  await noFactura("in1");

  await despreciar(owner, { inquilinoId: "in1" });

  const o = await db.ocupacion.findUniqueOrThrow({ where: { id: "oc2" }, select: { importeCent: true } });
  assert.equal(o.importeCent, 800_000n);
  assert.equal(await db.asiento.count({ where: { operadorId: "op1", inquilinoId: "in2" } }), 1);
});

// ── Lo que se muestra antes ─────────────────────────────────────────────────

test("el resumen separa lo borrable de lo que ya salió en un papel", async () => {
  await conPrecio("oc1");
  await cerrarPeriodo({
    operadorId: "op1", inquilinoId: "in1", periodo: PERIODO, alicuotaDecimas: 0,
    venceEl: new Date("2026-09-10T12:00:00Z"), receptorRazonSocial: "Dra Perez", receptorCondIva: "no informada",
  }, db);
  await conPrecio("oc2");
  await noFactura("in1");

  const p = await plataPendienteDe({ operadorId: "op1", inquilinoId: "in1" }, db);
  assert.equal(p.reservas, 2);
  assert.equal(p.cargos, 1);
  assert.equal(p.cargosCent, 800_000n);
  assert.equal(p.cargosSellados, 1);
  assert.equal(p.cargosSelladosCent, 800_000n);
});

test("sin nada pegado, el resumen da todo en cero", async () => {
  await noFactura("in1");
  const p = await plataPendienteDe({ operadorId: "op1", inquilinoId: "in1" }, db);
  assert.equal(p.reservas, 0);
  assert.equal(p.cargos, 0);
  assert.equal(p.cargosCent, 0n);
});
