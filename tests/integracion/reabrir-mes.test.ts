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
const { todos, reabrir } = cierreCon(db);

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
