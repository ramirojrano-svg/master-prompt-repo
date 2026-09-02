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
import { cobrosCon } from "../../src/servicios/plata/cobros.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });
const { todos, reabrir, reabrirUna, cobrar } = cierreCon(db);
const cobros = cobrosCon(db);

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

// ── Cobros anulados ─────────────────────────────────────────────────────────
//
// El caso que llegó a producción. A un profesional que debía $120.000 se le cargaron dos cobros
// por error y se anularon los dos. Quedó con la pantalla trabada por los dos lados:
//
//  · La liquidación no se podía reabrir —"ya entró un pago"— aunque no quedara un peso aplicado.
//  · Y encima le aparecían $240.000 "fuera del cierre", listos para emitirle una SEGUNDA
//    liquidación por plata que no debía: la contrapartida de cada anulación es un `ajuste_debito`,
//    que sí está en FACTURABLES mientras que el `pago` que revierte no lo está, así que del par
//    solo se veía la mitad que suma.

/** Cierra el mes de in1 y le carga N cobros por el total, anulándolos todos. */
async function conCobrosAnulados(cuantos: number) {
  await cargo("in1", 120_000n, "c1");
  await todos(owner, { periodo: MES, venceEl: `${MES}-28` });
  for (let n = 0; n < cuantos; n++) {
    const ref = `comp${n}`;
    await cobros.registrar(owner, { inquilinoId: "in1", monto: 1200, medio: "transferencia", referencia: ref, fecha: `${MES}-01` });
    const p = await db.asiento.findFirstOrThrow({ where: { concepto: "pago", referencia: ref }, select: { id: true } });
    await cobros.anular(owner, { asientoId: p.id, motivo: "nunca entró" });
  }
  return db.liquidacion.findFirstOrThrow({ where: { inquilinoId: "in1", periodo: MES }, select: { id: true } });
}

test("un cobro anulado no bloquea reabrir: no quedó plata aplicada", async () => {
  const liq = await conCobrosAnulados(1);

  const r = await reabrirUna(owner, { liquidacionId: liq.id });

  assert.ok(r.ok && r.data.ok, "el cobro se dio vuelta: no hay nada aplicado contra el papel");
});

test("dos cobros anulados tampoco: es el caso exacto que se vio", async () => {
  const liq = await conCobrosAnulados(2);

  const r = await reabrirUna(owner, { liquidacionId: liq.id });

  assert.ok(r.ok && r.data.ok);
});

test("pero un cobro VIGENTE sigue bloqueando, aunque haya otro anulado al lado", async () => {
  // El freno no se puede haber ablandado: si queda UN peso aplicado, el papel no se borra.
  const liq = await conCobrosAnulados(1);
  await cobros.registrar(owner, { inquilinoId: "in1", monto: 1200, medio: "transferencia", referencia: "firme", fecha: `${MES}-01` });

  const r = await reabrirUna(owner, { liquidacionId: liq.id });

  assert.ok(r.ok && !r.data.ok && r.data.error === "CON_PAGOS");
});

test("la anulación de un cobro NO se ofrece como un cargo nuevo del mes", async () => {
  await conCobrosAnulados(2);

  const filas = await pendientesDeCierre({ operadorId: "op1", periodo: MES }, db);
  const f = filas.find((x) => x.inquilinoId === "in1")!;
  assert.equal(f.pendientes, 0, "no quedó nada por facturar: el cargo ya salió en la liquidación");
  assert.equal(f.pendienteCent, 0n, "los $240.000 de las dos anulaciones no son plata nueva");
});

test("cerrar de nuevo después de anular cobros no emite una segunda liquidación", async () => {
  // La consecuencia cara del bug anterior: el profesional debía $120.000 y se le iban a emitir
  // $240.000 más, con un papel numerado que no se puede deshacer sin dejar rastro.
  await conCobrosAnulados(2);
  const antes = await db.liquidacion.count({ where: { periodo: MES } });

  const r = await todos(owner, { periodo: MES, venceEl: `${MES}-28` });

  assert.ok(r.ok);
  assert.equal(await db.liquidacion.count({ where: { periodo: MES } }), antes, "no hay nada nuevo que liquidar");
});

test("un ajuste de débito GENUINO se sigue facturando", async () => {
  // El arreglo excluye las vueltas atrás, no los ajustes: un débito cargado a mano —una multa, un
  // gasto que se le traslada— tiene que entrar en la liquidación como siempre.
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId: "in1", concepto: "ajuste_debito", montoCent: 50_000n,
    moneda: "ARS", periodo: MES, fechaHecho: new Date(`${MES}-10T12:00:00Z`), clave: "multa1",
  });

  const filas = await pendientesDeCierre({ operadorId: "op1", periodo: MES }, db);
  const f = filas.find((x) => x.inquilinoId === "in1")!;
  assert.equal(f.pendienteCent, 50_000n, "un ajuste que no revierte nada es un cargo como cualquier otro");
});

// ── Los tres números de la cabecera ─────────────────────────────────────────
//
// La pantalla muestra pendiente, cerrado y cobrado, y los tres salen de estas filas. Contestan
// preguntas distintas —qué falta emitir, qué se emitió, qué entró— y confundir dos de ellas es el
// error caro: dar por cobrado lo que solo se emitió.

test("cerrar suma al total cerrado y no al cobrado", async () => {
  await mesCerrado();
  const filas = await pendientesDeCierre({ operadorId: "op1", periodo: MES }, db);

  const cerrado = filas.reduce((a, f) => a + (f.liquidacion?.totalCent ?? 0n), 0n);
  const cobrado = filas.reduce((a, f) => a + f.pagadoCent, 0n);
  const pendiente = filas.reduce((a, f) => a + f.pendienteCent, 0n);

  assert.equal(cerrado, 300_000n, "los dos cargos del escenario, emitidos");
  assert.equal(cobrado, 0n, "emitir no es cobrar");
  assert.equal(pendiente, 0n, "no quedó nada sin emitir");
});

test("cobrar mueve el total cobrado y deja el cerrado quieto", async () => {
  await mesCerrado();
  const suya = await db.liquidacion.findFirstOrThrow({ where: { inquilinoId: "in1", periodo: MES }, select: { id: true, totalCent: true } });
  await cobrar(owner, { liquidacionId: suya.id });

  const filas = await pendientesDeCierre({ operadorId: "op1", periodo: MES }, db);
  const cerrado = filas.reduce((a, f) => a + (f.liquidacion?.totalCent ?? 0n), 0n);
  const cobrado = filas.reduce((a, f) => a + f.pagadoCent, 0n);

  assert.equal(cerrado, 300_000n, "el total emitido está congelado");
  assert.equal(cobrado, suya.totalCent, "solo entró lo de uno");
  assert.equal(cerrado - cobrado, 200_000n, "es lo que la pantalla anuncia como 'faltan'");
});

test("un cobro anulado no queda contado como cobrado", async () => {
  await mesCerrado();
  await cobros.registrar(owner, { inquilinoId: "in1", monto: 1000, medio: "transferencia", referencia: "x1", fecha: `${MES}-05` });
  const p = await db.asiento.findFirstOrThrow({ where: { concepto: "pago", referencia: "x1" }, select: { id: true } });
  await cobros.anular(owner, { asientoId: p.id, motivo: "rebotó" });

  const filas = await pendientesDeCierre({ operadorId: "op1", periodo: MES }, db);
  assert.equal(filas.reduce((a, f) => a + f.pagadoCent, 0n), 0n);
});
