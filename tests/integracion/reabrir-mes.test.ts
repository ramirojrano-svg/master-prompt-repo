// tests/integracion/reabrir-mes.test.ts — deshacer el cierre de un mes.
//
// Nace de un error real: se cerró septiembre entero —veintiocho liquidaciones— antes de que
// septiembre existiera, y deshacerlo requirió SQL a mano contra la base de producción. Lo que se
// prueba acá no es que funcione un día bueno, sino que NO haga daño:
//
//  · Que devuelva los cargos INTACTOS, no que los borre.
//  · Que no toque otros meses.
//  · Que se niegue si el papel ya salió del centro (mail enviado, o plata cobrada).
//  · Que un profesional no pueda usarlo.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { cierreCon, pendientesDeCierre } from "../../src/servicios/plata/cierre.ts";
import { asentarIdempotente } from "../../src/servicios/plata/ledger.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });
const { todos, reabrir, reabrirUna, cobrar } = cierreCon(db);

const owner: Actor = { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null };
const profesional: Actor = { usuarioId: "u2", operadorId: "op1", rol: "inquilino_titular", inquilinoId: "in1" };

const MES = "2026-09";
const OTRO = "2026-08";
const VENCE = "2026-10-07";

function cargo(inquilinoId: string, montoCent: bigint, clave: string, periodo = MES, concepto: "cargo_uso" | "pago" = "cargo_uso") {
  return asentarIdempotente(db, {
    operadorId: "op1", inquilinoId, concepto, montoCent, moneda: "ARS", periodo,
    fechaHecho: new Date(`${periodo}-05T12:00:00Z`), clave,
  });
}

/** El escenario del error: dos profesionales con cargos, y el mes cerrado. */
async function mesCerrado() {
  await cargo("in1", 100_000n, "c1");
  await cargo("in2", 200_000n, "c2");
  const r = await todos(owner, { periodo: MES, venceEl: VENCE });
  assert.ok(r.ok && r.data.cerradas === 2, "el escenario tiene que arrancar con el mes cerrado");
}

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Asiento","Liquidacion","Auditoria" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

// ── El caso bueno ───────────────────────────────────────────────────────────

test("reabrir borra los papeles y devuelve los cargos, sin perder plata", async () => {
  await mesCerrado();

  const r = await reabrir(owner, { periodo: MES });
  assert.ok(r.ok && r.data.ok, "tenía que reabrir");
  assert.equal(r.data.liquidaciones, 2);
  assert.equal(r.data.cargos, 2);
  assert.equal(r.data.totalCent, 300_000n);

  // Los papeles ya no están…
  assert.equal(await db.liquidacion.count({ where: { periodo: MES } }), 0);
  // …pero los cargos SÍ, y sueltos: es lo que hace que esto no sea un borrado.
  const asientos = await db.asiento.findMany({ where: { periodo: MES } });
  assert.equal(asientos.length, 2, "los cargos no se borran");
  assert.ok(asientos.every((a) => a.liquidacionId === null), "y quedan sin sellar");
  assert.equal(asientos.reduce((s, a) => s + a.montoCent, 0n), 300_000n, "la plata queda igual");
});

test("después de reabrir, la pantalla vuelve a ofrecer el mes como pendiente", async () => {
  await mesCerrado();
  await reabrir(owner, { periodo: MES });

  const filas = await pendientesDeCierre({ operadorId: "op1", periodo: MES }, db);
  assert.equal(filas.length, 2);
  assert.ok(filas.every((f) => f.liquidacion === null), "ninguna puede figurar cerrada");
  assert.ok(filas.every((f) => f.pendientes > 0), "y todas vuelven a tener cargos por cerrar");
});

test("se puede volver a cerrar después de reabrir", async () => {
  await mesCerrado();
  await reabrir(owner, { periodo: MES });

  const r = await todos(owner, { periodo: MES, venceEl: VENCE });
  assert.ok(r.ok && r.data.cerradas === 2, "el mes se tiene que poder cerrar de nuevo");
});

test("no toca los otros meses", async () => {
  await cargo("in1", 500_000n, "viejo", OTRO);
  await todos(owner, { periodo: OTRO, venceEl: "2026-09-07" });
  await mesCerrado();

  await reabrir(owner, { periodo: MES });

  assert.equal(await db.liquidacion.count({ where: { periodo: OTRO } }), 1, "agosto sigue cerrado");
  const viejo = await db.asiento.findFirst({ where: { periodo: OTRO } });
  assert.ok(viejo?.liquidacionId, "y su cargo sigue sellado");
});

// ── Los frenos ──────────────────────────────────────────────────────────────

test("se niega si alguna liquidación YA se mandó por mail", async () => {
  await mesCerrado();
  const una = await db.liquidacion.findFirst({ where: { periodo: MES }, select: { id: true } });
  await db.liquidacion.update({ where: { id: una!.id }, data: { avisadaEl: new Date() } });

  const r = await reabrir(owner, { periodo: MES });
  assert.ok(r.ok && !r.data.ok);
  assert.equal(r.data.error, "YA_AVISADAS");
  // Y NO borró nada: un freno que igual rompe no es un freno.
  assert.equal(await db.liquidacion.count({ where: { periodo: MES } }), 2);
});

test("se niega si ya entró un pago de ese mes", async () => {
  await mesCerrado();
  // Un pago NO queda pegado a la liquidación: el cierre no lo sella. Por eso el freno mira los
  // pagos DEL PERÍODO — mirar los que cuelgan del papel daría cero siempre.
  await cargo("in1", -50_000n, "pago1", MES, "pago");

  const r = await reabrir(owner, { periodo: MES });
  assert.ok(r.ok && !r.data.ok);
  assert.equal(r.data.error, "CON_PAGOS");
  assert.equal(await db.liquidacion.count({ where: { periodo: MES } }), 2, "no borró nada");
});

test("un mes que no está cerrado no se puede reabrir", async () => {
  await cargo("in1", 100_000n, "c1");
  const r = await reabrir(owner, { periodo: MES });
  assert.ok(r.ok && !r.data.ok);
  assert.equal(r.data.error, "NADA_QUE_REABRIR");
});

// ── Permisos ────────────────────────────────────────────────────────────────

test("un profesional NO puede reabrir un mes", async () => {
  await mesCerrado();
  const r = await reabrir(profesional, { periodo: MES });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error, "SIN_PERMISO");
  assert.equal(await db.liquidacion.count({ where: { periodo: MES } }), 2, "no tocó nada");
});

test("queda registrado quién reabrió y qué mes", async () => {
  await mesCerrado();
  await reabrir(owner, { periodo: MES });
  const fila = await db.auditoria.findFirst({
    where: { permiso: "periodo.cerrar", resumen: { contains: "reabrir" } },
  });
  assert.ok(fila, "sin registro, deshacer un cierre sería invisible");
  assert.match(fila!.resumen ?? "", /reabrir 2026-09/);
});

// ── Reabrir UNO solo ────────────────────────────────────────────────────────
// Cerrar de a uno es lo normal —se baja por la lista apretando "Cerrar"—, y equivocarse de fila en
// una lista de treinta y seis es cuestión de tiempo. Sin esto había que deshacer el mes ENTERO y
// volver a cerrar a los otros treinta y cinco.

test("reabrir UNA deja al resto cerrado", async () => {
  await mesCerrado(); // in1 e in2
  const suya = await db.liquidacion.findFirst({ where: { inquilinoId: "in1", periodo: MES }, select: { id: true } });

  const r = await reabrirUna(owner, { liquidacionId: suya!.id });
  assert.ok(r.ok && r.data.ok, "tenía que reabrir");
  assert.equal(r.data.cargos, 1);

  assert.equal(await db.liquidacion.count({ where: { inquilinoId: "in1", periodo: MES } }), 0, "la suya ya no está");
  assert.equal(await db.liquidacion.count({ where: { inquilinoId: "in2", periodo: MES } }), 1, "la del otro NO se toca");

  const suyos = await db.asiento.findMany({ where: { inquilinoId: "in1", periodo: MES } });
  assert.ok(suyos.every((a) => a.liquidacionId === null), "sus cargos vuelven a estar sueltos");
});

test("después de reabrir una, esa persona vuelve a figurar pendiente", async () => {
  await mesCerrado();
  const suya = await db.liquidacion.findFirst({ where: { inquilinoId: "in1", periodo: MES }, select: { id: true } });
  await reabrirUna(owner, { liquidacionId: suya!.id });

  const filas = await pendientesDeCierre({ operadorId: "op1", periodo: MES }, db);
  const uno = filas.find((f) => f.inquilinoId === "in1");
  const otro = filas.find((f) => f.inquilinoId === "in2");
  assert.equal(uno?.liquidacion, null, "vuelve a estar sin cerrar");
  assert.ok((uno?.pendientes ?? 0) > 0, "y con cargos por cerrar");
  assert.ok(otro?.liquidacion, "el otro sigue cerrado");
});

test("no reabre una que ya se mandó por mail", async () => {
  await mesCerrado();
  const suya = await db.liquidacion.findFirst({ where: { inquilinoId: "in1", periodo: MES }, select: { id: true } });
  await db.liquidacion.update({ where: { id: suya!.id }, data: { avisadaEl: new Date() } });

  const r = await reabrirUna(owner, { liquidacionId: suya!.id });
  assert.ok(r.ok && !r.data.ok);
  assert.equal(r.data.error, "YA_AVISADA");
  assert.equal(await db.liquidacion.count({ where: { id: suya!.id } }), 1, "no borró nada");
});

test("no reabre una que ya tiene un pago de ese profesional", async () => {
  await mesCerrado();
  await cargo("in1", -50_000n, "pago1", MES, "pago");
  const suya = await db.liquidacion.findFirst({ where: { inquilinoId: "in1", periodo: MES }, select: { id: true } });

  const r = await reabrirUna(owner, { liquidacionId: suya!.id });
  assert.ok(r.ok && !r.data.ok);
  assert.equal(r.data.error, "CON_PAGOS");
});

test("el pago de OTRO profesional no bloquea la que se quiere reabrir", async () => {
  await mesCerrado();
  await cargo("in2", -50_000n, "pago2", MES, "pago"); // paga in2
  const suya = await db.liquidacion.findFirst({ where: { inquilinoId: "in1", periodo: MES }, select: { id: true } });

  const r = await reabrirUna(owner, { liquidacionId: suya!.id });
  assert.ok(r.ok && r.data.ok, "el freno es por persona, no por mes");
});

test("un profesional no puede reabrir una liquidación", async () => {
  await mesCerrado();
  const suya = await db.liquidacion.findFirst({ where: { inquilinoId: "in1", periodo: MES }, select: { id: true } });
  const r = await reabrirUna(profesional, { liquidacionId: suya!.id });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error, "SIN_PERMISO");
  assert.equal(await db.liquidacion.count({ where: { id: suya!.id } }), 1);
});

// ── Cobrada de un toque ─────────────────────────────────────────────────────
//
// Cerrar el mes y cobrarlo no son lo mismo: cerrar es emitir el papel, cobrar es que la plata
// llegó. Fusionarlos —dar por pagado al cerrar— dejaría a la cuenta corriente sin lo único que
// hace, que es saber quién debe. Lo que sí se puede es que decir "me pagó todo" sea un toque en
// vez de cuatro campos.

test("dar por cobrada asienta el pago por el total de la liquidación", async () => {
  await mesCerrado();
  const suya = await db.liquidacion.findFirstOrThrow({
    where: { inquilinoId: "in1", periodo: MES },
    select: { id: true, totalCent: true },
  });

  const r = await cobrar(owner, { liquidacionId: suya.id });

  assert.ok(r.ok && r.data.ok);
  const pago = await db.asiento.findFirstOrThrow({
    where: { inquilinoId: "in1", concepto: "pago" },
    select: { montoCent: true, periodo: true },
  });
  assert.equal(pago.montoCent, -suya.totalCent, "a favor del profesional, por el total");
  assert.equal(pago.periodo, MES, "el pago pertenece al mes de la liquidación, no al de hoy");
});

test("apretar dos veces no carga dos pagos", async () => {
  // Es un botón en un celular: apretarlo de más tiene que no hacer nada.
  await mesCerrado();
  const suya = await db.liquidacion.findFirstOrThrow({ where: { inquilinoId: "in1", periodo: MES }, select: { id: true } });

  const a = await cobrar(owner, { liquidacionId: suya.id });
  const b = await cobrar(owner, { liquidacionId: suya.id });

  assert.ok(a.ok && a.data.ok);
  assert.ok(b.ok && !b.data.ok && b.data.error === "YA_COBRADA");
  assert.equal(await db.asiento.count({ where: { inquilinoId: "in1", concepto: "pago" } }), 1);
});

test("la fila queda marcada como cobrada y la del de al lado no", async () => {
  await mesCerrado();
  const suya = await db.liquidacion.findFirstOrThrow({ where: { inquilinoId: "in1", periodo: MES }, select: { id: true, totalCent: true } });
  await cobrar(owner, { liquidacionId: suya.id });

  const filas = await pendientesDeCierre({ operadorId: "op1", periodo: MES }, db);
  const uno = filas.find((f) => f.inquilinoId === "in1")!;
  const dos = filas.find((f) => f.inquilinoId === "in2")!;
  assert.equal(uno.pagadoCent, suya.totalCent, "in1 figura cobrado");
  assert.equal(dos.pagadoCent, 0n, "in2 sigue debiendo: cerrar no es cobrar");
});

test("cobrar no cierra a nadie ni reabre nada: son actos distintos", async () => {
  await mesCerrado();
  const antes = await db.liquidacion.count({ where: { periodo: MES } });
  const suya = await db.liquidacion.findFirstOrThrow({ where: { inquilinoId: "in1", periodo: MES }, select: { id: true } });

  await cobrar(owner, { liquidacionId: suya.id });

  assert.equal(await db.liquidacion.count({ where: { periodo: MES } }), antes);
});

test("una liquidación ya cobrada no se puede reabrir", async () => {
  // El freno que ya existía, ahora alcanzado por el camino nuevo: hay plata aplicada contra ese
  // papel, y borrarlo dejaría un pago colgando de un documento que no existe.
  await mesCerrado();
  const suya = await db.liquidacion.findFirstOrThrow({ where: { inquilinoId: "in1", periodo: MES }, select: { id: true } });
  await cobrar(owner, { liquidacionId: suya.id });

  const r = await reabrirUna(owner, { liquidacionId: suya.id });
  assert.ok(r.ok && !r.data.ok && r.data.error === "CON_PAGOS");
});

test("un profesional no puede dar por cobrada una liquidación", async () => {
  await mesCerrado();
  const suya = await db.liquidacion.findFirstOrThrow({ where: { inquilinoId: "in1", periodo: MES }, select: { id: true } });

  const r = await cobrar(profesional, { liquidacionId: suya.id });
  assert.equal(r.ok, false);
  assert.equal(await db.asiento.count({ where: { concepto: "pago" } }), 0);
});
