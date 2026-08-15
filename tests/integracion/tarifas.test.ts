// tests/integracion/tarifas.test.ts — el precio por hora: quién lo cambia, cómo se cierra el
// anterior, y que la reserva ESTAMPE lo que cobró y lo cargue a la cuenta corriente (§8.8).
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { tarifasCon, tarifasVigentes } from "../../src/servicios/config/tarifas.ts";
import { crearOcupacion, type CtxReserva } from "../../src/servicios/reservas/crear.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { nuevoPool, reiniciarEsquema, seedBase, TZ_SEDE, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });
const tarifas = tarifasCon(db);

const owner: Actor = { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null };
const profesional: Actor = { usuarioId: "u4", operadorId: "op1", rol: "inquilino_titular", inquilinoId: "in1" };

const HORARIO = ((): CtxReserva["horario"] => {
  const abierto = [{ desde: "06:00", hasta: "23:00" }];
  return { 0: abierto, 1: abierto, 2: abierto, 3: abierto, 4: abierto, 5: abierto, 6: abierto };
})();

const POLITICA: CtxReserva["politica"] = {
  pasoMin: 30,
  duracionMinMin: 15,
  duracionMaxMin: 720,
  bufferMin: 15,
  bufferMismoInquilino: 0,
  antelacionMinMin: 0,
  horizonteDias: 3650,
};

function ctx(inquilinoId: string): CtxReserva {
  return { operadorId: "op1", inquilinoId, politica: POLITICA, horario: HORARIO, bloqueaProfesional: true };
}

// Acá NO se puede inyectar `ahora`: las tarifas se crean con vigenteDesde = now() real, así que
// el alta tiene que mirar el mismo reloj. Entonces la fecha se calcula a 30 días de hoy en vez de
// clavarse: un test que hoy pasa y en marzo falla por FECHA_PASADA no es un test, es una trampa.
const DIA = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

// 12:00Z = 09:00 AR (o 10:00 según la época del año): siempre dentro del horario 06-23.
function req(salaId: string, hZ: number, durMin = 60) {
  return { salaId, fecha: DIA, inicioISO: `${DIA}T${String(hZ).padStart(2, "0")}:00:00.000Z`, duracionMin: durMin };
}

/** El período que le corresponde, calculado aparte del código bajo prueba. */
function periodoEsperado(iso: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ_SEDE, year: "numeric", month: "2-digit" }).format(new Date(iso));
  return p.slice(0, 7);
}

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Ocupacion", "Tarifa", "Asiento" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

// ── QUIÉN PUEDE ─────────────────────────────────────────────────────────────
test("§6.2 · un PROFESIONAL no toca precios: SIN_PERMISO y cero filas escritas", async () => {
  const r = await tarifas.poner(profesional, { precioHora: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error, "SIN_PERMISO");
  assert.equal(await db.tarifa.count(), 0, "un rechazo de permiso no deja rastro escrito");
});

test("§6.2 · el profesional tampoco se pone su propio precio", async () => {
  const r = await tarifas.poner(profesional, { precioHora: 1, inquilinoId: "in1" });
  assert.equal(r.ok === false && r.error, "SIN_PERMISO");
});

// ── CÓMO CAMBIA UN PRECIO ───────────────────────────────────────────────────
test("cambiar el precio CIERRA el anterior y crea otro: la fila vieja no se toca (§8.8)", async () => {
  const a = await tarifas.poner(owner, { precioHora: 8000 });
  assert.ok(a.ok && a.data.ok);
  const b = await tarifas.poner(owner, { precioHora: 9500 });
  assert.ok(b.ok && b.data.ok);

  const todas = await db.tarifa.findMany({ orderBy: { vigenteDesde: "asc" } });
  assert.equal(todas.length, 2, "no se edita el precio: queda el historial entero");
  assert.equal(todas[0]?.precioHoraCent, 800_000n, "el precio viejo quedó tal cual estaba");
  assert.ok(todas[0]?.vigenteHasta, "el viejo quedó cerrado");
  assert.equal(todas[1]?.precioHoraCent, 950_000n);
  assert.equal(todas[1]?.vigenteHasta, null, "el nuevo es el vigente");

  const vig = await tarifasVigentes("op1", db);
  assert.equal(vig.length, 1);
  assert.equal(vig[0]?.precioHoraCent, 950_000n);
});

test("cerrar el vigente de un alcance no toca los de otro alcance", async () => {
  await tarifas.poner(owner, { precioHora: 8000 }); // general
  await tarifas.poner(owner, { precioHora: 7000, inquilinoId: "in1" }); // de un profesional
  await tarifas.poner(owner, { precioHora: 12000 }); // pisa SOLO la general

  const vig = await tarifasVigentes("op1", db);
  assert.equal(vig.length, 2);
  assert.equal(vig.find((t) => t.inquilinoId === "in1")?.precioHoraCent, 700_000n, "la del profesional siguió intacta");
  assert.equal(vig.find((t) => t.inquilinoId === null)?.precioHoraCent, 1_200_000n);
});

test("cerrarTarifa hace caer el alcance en la que le sigue, sin borrar nada", async () => {
  await tarifas.poner(owner, { precioHora: 8000 });
  const p = await tarifas.poner(owner, { precioHora: 5000, inquilinoId: "in1" });
  assert.ok(p.ok && p.data.ok);
  if (!(p.ok && p.data.ok)) return;

  const c = await tarifas.cerrar(owner, { tarifaId: p.data.id });
  assert.ok(c.ok && c.data.ok);
  assert.equal(await db.tarifa.count(), 2, "cerrar NO borra");

  const r = await crearOcupacion(req("sa1", 12), ctx("in1"), db);
  assert.ok(r.ok);
  if (!r.ok) return;
  const o = await db.ocupacion.findUniqueOrThrow({ where: { id: r.id }, select: { precioHoraCent: true } });
  assert.equal(o.precioHoraCent, 800_000n, "sin la suya, paga la general");
});

test("un id de otro operador no se puede tarifar (pertenencia, no findUnique)", async () => {
  const r = await tarifas.poner(owner, { precioHora: 100, inquilinoId: "inAjeno" });
  assert.ok(r.ok && !r.data.ok);
  assert.equal(r.ok && !r.data.ok && r.data.error, "PROFESIONAL_INEXISTENTE");
  assert.equal(await db.tarifa.count(), 0);
});

test("los pesos con centavos entran sin float roto", async () => {
  const r = await tarifas.poner(owner, { precioHora: 8000.55 });
  assert.ok(r.ok && r.data.ok);
  const t = await db.tarifa.findFirstOrThrow();
  assert.equal(t.precioHoraCent, 800_055n);
});

// ── LO QUE COBRA LA RESERVA ─────────────────────────────────────────────────
test("la reserva ESTAMPA el precio y carga la cuenta corriente", async () => {
  await tarifas.poner(owner, { precioHora: 8000 });

  const r = await crearOcupacion(req("sa1", 12, 90), ctx("in1"), db);
  assert.ok(r.ok);
  if (!r.ok) return;

  const o = await db.ocupacion.findUniqueOrThrow({
    where: { id: r.id },
    select: { tarifaId: true, precioHoraCent: true, importeCent: true },
  });
  assert.equal(o.precioHoraCent, 800_000n);
  assert.equal(o.importeCent, 1_200_000n, "hora y media = $12.000, prorrateado por minutos");
  assert.ok(o.tarifaId, "queda de qué tarifa salió, para poder explicarlo después");

  const asientos = await db.asiento.findMany({ where: { reservaId: r.id } });
  assert.equal(asientos.length, 1);
  assert.equal(asientos[0]?.concepto, "cargo_uso");
  assert.equal(asientos[0]?.montoCent, 1_200_000n, "positivo: el profesional DEBE");
  assert.equal(asientos[0]?.inquilinoId, "in1");
  assert.equal(asientos[0]?.periodo, periodoEsperado(`${DIA}T12:00:00.000Z`), "el mes se corta en la zona de la sede");
});

test("subir el precio HOY no reescribe lo que ya se reservó ayer (§8.8)", async () => {
  await tarifas.poner(owner, { precioHora: 8000 });
  const vieja = await crearOcupacion(req("sa1", 12), ctx("in1"), db);
  assert.ok(vieja.ok);
  if (!vieja.ok) return;

  await tarifas.poner(owner, { precioHora: 20000 });
  const nueva = await crearOcupacion(req("sa1", 15), ctx("in1"), db);
  assert.ok(nueva.ok);
  if (!nueva.ok) return;

  const a = await db.ocupacion.findUniqueOrThrow({ where: { id: vieja.id }, select: { importeCent: true } });
  const b = await db.ocupacion.findUniqueOrThrow({ where: { id: nueva.id }, select: { importeCent: true } });
  assert.equal(a.importeCent, 800_000n, "la de antes sigue valiendo lo de antes");
  assert.equal(b.importeCent, 2_000_000n);

  const suma = await db.asiento.aggregate({ where: { inquilinoId: "in1" }, _sum: { montoCent: true } });
  assert.equal(suma._sum.montoCent, 2_800_000n, "el saldo se deriva del ledger, no de un contador");
});

test("la tarifa del profesional le gana a la general en el cobro real", async () => {
  await tarifas.poner(owner, { precioHora: 8000 });
  await tarifas.poner(owner, { precioHora: 6000, inquilinoId: "in1" });

  const mio = await crearOcupacion(req("sa1", 12), ctx("in1"), db);
  const otro = await crearOcupacion(req("sa2", 12), ctx("in2"), db);
  assert.ok(mio.ok && otro.ok);
  if (!(mio.ok && otro.ok)) return;

  const a = await db.ocupacion.findUniqueOrThrow({ where: { id: mio.id }, select: { importeCent: true } });
  const b = await db.ocupacion.findUniqueOrThrow({ where: { id: otro.id }, select: { importeCent: true } });
  assert.equal(a.importeCent, 600_000n, "in1 tiene precio propio");
  assert.equal(b.importeCent, 800_000n, "in2 paga la general");
});

test("sin ninguna tarifa cargada la reserva se crea igual y NO cobra cero: no cobra nada", async () => {
  const r = await crearOcupacion(req("sa1", 12), ctx("in1"), db);
  assert.ok(r.ok);
  if (!r.ok) return;
  const o = await db.ocupacion.findUniqueOrThrow({ where: { id: r.id }, select: { tarifaId: true, importeCent: true } });
  assert.equal(o.tarifaId, null);
  assert.equal(o.importeCent, null, "null = 'no había precio', distinto de un importe de $0");
  assert.equal(await db.asiento.count(), 0, "un centro que todavía no cargó precios no genera deuda fantasma");
});

test("un HOLD no cobra: todavía no es una reserva", async () => {
  await tarifas.poner(owner, { precioHora: 8000 });
  const r = await crearOcupacion(req("sa1", 12), ctx("in1"), db, {
    tipo: "hold",
    expiraAt: new Date(Date.now() + 10 * 60_000),
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  const o = await db.ocupacion.findUniqueOrThrow({ where: { id: r.id }, select: { importeCent: true } });
  assert.equal(o.importeCent, null);
  assert.equal(await db.asiento.count(), 0);
});
