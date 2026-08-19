// tests/integracion/mover-turno.test.ts — arrastrar un turno en la grilla (§4.10.3).
//
// Lo que se protege acá no es "el turno cambió de lugar" —eso es lo fácil— sino las tres cosas
// que se rompen en silencio: que un movimiento fallido NO pierda el turno, que el precio no se
// recotice solo, y que el cargo se MUDE en vez de duplicarse o quedarse en el mes viejo.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { crearOcupacion, type CtxReserva } from "../../src/servicios/reservas/crear.ts";
import { moverOcupacion, type CtxMover } from "../../src/servicios/reservas/mover.ts";
import { marcarNoShow } from "../../src/servicios/reservas/no-show.ts";
import { prisma } from "../../src/db/prisma.ts";
import { insertarOcupacion, nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: `${URL_DB}?connection_limit=20&pool_timeout=20` });

const abierto = [{ desde: "08:00", hasta: "22:00" }];
const HORARIO: CtxMover["horario"] = { 0: abierto, 1: abierto, 2: abierto, 3: abierto, 4: abierto, 5: abierto, 6: abierto };
const POLITICA: CtxReserva["politica"] = { pasoMin: 30, duracionMinMin: 15, duracionMaxMin: 720, bufferMin: 0, bufferMismoInquilino: 0, antelacionMinMin: 0, horizonteDias: 3650 };
const AHORA = new Date("2026-08-01T00:00:00Z");

function ctxCrear(inquilinoId: string): CtxReserva {
  return { operadorId: "op1", inquilinoId, politica: POLITICA, horario: HORARIO, bloqueaProfesional: true, ahora: AHORA };
}
function ctxMover(over: Partial<CtxMover> = {}): CtxMover {
  return { operadorId: "op1", politica: POLITICA, horario: HORARIO, ahora: AHORA, ...over };
}

// 10:00 AR = 13:00Z (Argentina no tiene horario de verano).
function req(salaId: string, fecha: string, horaZ = "13:00", duracionMin = 60) {
  return { salaId, fecha, inicioISO: `${fecha}T${horaZ}:00.000Z`, duracionMin };
}

async function crear(salaId: string, fecha: string, inquilino = "in1", horaZ = "13:00", dur = 60): Promise<string> {
  const r = await crearOcupacion(req(salaId, fecha, horaZ, dur), ctxCrear(inquilino), db);
  assert.ok(r.ok, `no se pudo crear el turno de base: ${r.ok ? "" : r.error}`);
  return r.ok ? r.id : "";
}

async function tarifaGeneral(precioHoraCent: bigint) {
  await pgPool.query(
    `INSERT INTO "Tarifa"("id","operadorId","nombre","precioHoraCent","vigenteDesde") VALUES('ta1','op1','General',$1,'2020-01-01T00:00:00Z')`,
    [precioHoraCent.toString()],
  );
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

test("mover de hora: la vieja queda reubicada y la nueva apunta a ella", async () => {
  const viejo = await crear("sa1", "2026-08-12");

  const r = await moverOcupacion({ ocupacionId: viejo, salaDestinoId: "sa1", fecha: "2026-08-12", hora: "15:00" }, ctxMover(), db);
  assert.ok(r.ok, r.ok ? "" : r.error);

  const vieja = await db.ocupacion.findUniqueOrThrow({ where: { id: viejo }, select: { estado: true, inicio: true } });
  assert.equal(vieja.estado, "reubicada");
  // El histórico NO se reescribe: la fila vieja sigue diciendo la hora en la que estuvo.
  assert.equal(vieja.inicio?.toISOString(), "2026-08-12T13:00:00.000Z");

  const nueva = await db.ocupacion.findUniqueOrThrow({
    where: { id: r.ok ? r.id : "" },
    select: { estado: true, salaId: true, inicio: true, fin: true, reemplazaAId: true },
  });
  assert.equal(nueva.estado, "confirmada");
  assert.equal(nueva.reemplazaAId, viejo);
  assert.equal(nueva.inicio?.toISOString(), "2026-08-12T18:00:00.000Z"); // 15:00 AR
  assert.equal(nueva.fin?.toISOString(), "2026-08-12T19:00:00.000Z"); // la duración se conserva
});

test("mover de sala Y de hora a la vez", async () => {
  const viejo = await crear("sa1", "2026-08-12");
  const r = await moverOcupacion({ ocupacionId: viejo, salaDestinoId: "sa2", fecha: "2026-08-13", hora: "09:00" }, ctxMover(), db);
  assert.ok(r.ok, r.ok ? "" : r.error);

  const nueva = await db.ocupacion.findUniqueOrThrow({ where: { id: r.ok ? r.id : "" }, select: { salaId: true, inicio: true } });
  assert.equal(nueva.salaId, "sa2");
  assert.equal(nueva.inicio?.toISOString(), "2026-08-13T12:00:00.000Z");
});

test("correr media hora DENTRO de la misma sala: no puede chocar consigo mismo", async () => {
  // Es el caso que rompe si la foto de ocupación no excluye la fila que se está moviendo: el
  // turno se solapa con su propia posición anterior y nunca se deja mover.
  const viejo = await crear("sa1", "2026-08-12");
  const r = await moverOcupacion({ ocupacionId: viejo, salaDestinoId: "sa1", fecha: "2026-08-12", hora: "10:30" }, ctxMover(), db);
  assert.ok(r.ok, r.ok ? "" : r.error);
});

test("si el destino está ocupado, el turno NO se mueve y NO se pierde", async () => {
  const viejo = await crear("sa1", "2026-08-12");
  await insertarOcupacion(pgPool, {
    id: "ocupado", salaId: "sa1", inquilinoId: "in2", estado: "confirmada",
    inicio: "2026-08-12T18:00:00Z", fin: "2026-08-12T19:00:00Z",
  });

  const r = await moverOcupacion({ ocupacionId: viejo, salaDestinoId: "sa1", fecha: "2026-08-12", hora: "15:00" }, ctxMover(), db);
  assert.deepEqual(r, { ok: false, error: "SLOT_OCUPADO" });

  // Lo que más importa del caso: el turno original sigue vivo y en su lugar.
  const vieja = await db.ocupacion.findUniqueOrThrow({ where: { id: viejo }, select: { estado: true, inicio: true } });
  assert.equal(vieja.estado, "confirmada");
  assert.equal(vieja.inicio?.toISOString(), "2026-08-12T13:00:00.000Z");
});

test("el mismo profesional no puede quedar en dos salas a la misma hora", async () => {
  const viejo = await crear("sa1", "2026-08-12");
  await insertarOcupacion(pgPool, {
    id: "otra-sala", salaId: "sa2", inquilinoId: "in1", estado: "confirmada",
    inicio: "2026-08-12T18:00:00Z", fin: "2026-08-12T19:00:00Z",
  });

  const r = await moverOcupacion({ ocupacionId: viejo, salaDestinoId: "sa1", fecha: "2026-08-12", hora: "15:00" }, ctxMover(), db);
  assert.deepEqual(r, { ok: false, error: "SOLAPA_INQUILINO" });
  assert.equal((await db.ocupacion.findUniqueOrThrow({ where: { id: viejo }, select: { estado: true } })).estado, "confirmada");
});

test("soltarlo fuera de la apertura de la sala destino da FUERA_DE_HORARIO", async () => {
  const viejo = await crear("sa1", "2026-08-12");
  const r = await moverOcupacion({ ocupacionId: viejo, salaDestinoId: "sa1", fecha: "2026-08-12", hora: "23:00" }, ctxMover(), db);
  assert.deepEqual(r, { ok: false, error: "FUERA_DE_HORARIO" });
});

test("manda el horario de la sala DESTINO, no el de la de origen", async () => {
  // La sala destino abre recién 18:00: soltar a las 09:00 tiene que rebotar aunque la sala de
  // origen a esa hora estuviera abierta.
  const viejo = await crear("sa1", "2026-08-12");
  const tarde = [{ desde: "18:00", hasta: "22:00" }];
  const soloTarde: CtxMover["horario"] = { 0: tarde, 1: tarde, 2: tarde, 3: tarde, 4: tarde, 5: tarde, 6: tarde };

  const r = await moverOcupacion({ ocupacionId: viejo, salaDestinoId: "sa2", fecha: "2026-08-12", hora: "09:00" }, ctxMover({ horario: soloTarde }), db);
  assert.deepEqual(r, { ok: false, error: "FUERA_DE_HORARIO" });
});

test("un turno ya usado o ausente está congelado: no se arrastra", async () => {
  const viejo = await crear("sa1", "2026-08-12");
  assert.deepEqual(await marcarNoShow({ ocupacionId: viejo, motivo: "no vino" }, { operadorId: "op1" }, db), { ok: true });

  const r = await moverOcupacion({ ocupacionId: viejo, salaDestinoId: "sa1", fecha: "2026-08-12", hora: "15:00" }, ctxMover(), db);
  assert.deepEqual(r, { ok: false, error: "CONGELADA" });
});

test("un bloqueo no es un turno de nadie: NO_MOVIBLE", async () => {
  await insertarOcupacion(pgPool, {
    id: "bloq", salaId: "sa1", inquilinoId: null, estado: "confirmada", tipo: "bloqueo",
    inicio: "2026-08-12T13:00:00Z", fin: "2026-08-12T14:00:00Z",
  });
  const r = await moverOcupacion({ ocupacionId: "bloq", salaDestinoId: "sa1", fecha: "2026-08-12", hora: "15:00" }, ctxMover(), db);
  assert.deepEqual(r, { ok: false, error: "NO_MOVIBLE" });
});

test("soltarlo donde ya estaba no escribe nada", async () => {
  const viejo = await crear("sa1", "2026-08-12");
  const r = await moverOcupacion({ ocupacionId: viejo, salaDestinoId: "sa1", fecha: "2026-08-12", hora: "10:00" }, ctxMover(), db);
  assert.deepEqual(r, { ok: false, error: "SIN_CAMBIOS" });
  assert.equal((await db.ocupacion.findUniqueOrThrow({ where: { id: viejo }, select: { estado: true } })).estado, "confirmada");
  assert.equal(await db.ocupacion.count(), 1); // no nació ninguna fila
});

test("un turno de otro centro no existe acá", async () => {
  const r = await moverOcupacion({ ocupacionId: "no-existe", salaDestinoId: "sa1", fecha: "2026-08-12", hora: "15:00" }, ctxMover(), db);
  assert.deepEqual(r, { ok: false, error: "NO_ENCONTRADA" });
});

test("EL PRECIO VIAJA: mover no recotiza", async () => {
  await tarifaGeneral(800_000n); // $8.000 la hora
  const viejo = await crear("sa1", "2026-08-12");
  const antes = await db.ocupacion.findUniqueOrThrow({ where: { id: viejo }, select: { tarifaId: true, precioHoraCent: true, importeCent: true } });
  assert.equal(antes.importeCent, 800_000n);

  const r = await moverOcupacion({ ocupacionId: viejo, salaDestinoId: "sa2", fecha: "2026-08-13", hora: "15:00" }, ctxMover(), db);
  assert.ok(r.ok, r.ok ? "" : r.error);

  const nueva = await db.ocupacion.findUniqueOrThrow({ where: { id: r.ok ? r.id : "" }, select: { tarifaId: true, precioHoraCent: true, importeCent: true } });
  assert.deepEqual(nueva, antes, "el turno movido tiene que conservar el precio que ya tenía");
});

test("EL CARGO SE MUDA: sigue habiendo UN solo asiento, apuntando al turno nuevo", async () => {
  await tarifaGeneral(800_000n);
  const viejo = await crear("sa1", "2026-08-12");
  assert.equal(await db.asiento.count({ where: { concepto: "cargo_uso" } }), 1);

  const r = await moverOcupacion({ ocupacionId: viejo, salaDestinoId: "sa1", fecha: "2026-08-13", hora: "15:00" }, ctxMover(), db);
  assert.ok(r.ok, r.ok ? "" : r.error);
  const nuevoId = r.ok ? r.id : "";

  const cargos = await db.asiento.findMany({ where: { concepto: "cargo_uso" }, select: { clave: true, reservaId: true, montoCent: true, fechaHecho: true } });
  assert.equal(cargos.length, 1, "mover un turno no puede cobrarlo dos veces");
  assert.equal(cargos[0]!.reservaId, nuevoId);
  assert.equal(cargos[0]!.clave, `cargo_uso:${nuevoId}`);
  assert.equal(cargos[0]!.montoCent, 800_000n);
  assert.equal(cargos[0]!.fechaHecho.toISOString(), "2026-08-13T18:00:00.000Z");
});

test("cruzando de mes, el cargo se va al mes NUEVO (si no, la hora y la plata quedan en meses distintos)", async () => {
  await tarifaGeneral(800_000n);
  const viejo = await crear("sa1", "2026-08-31");
  assert.equal((await db.asiento.findFirstOrThrow({ where: { concepto: "cargo_uso" }, select: { periodo: true } })).periodo, "2026-08");

  const r = await moverOcupacion({ ocupacionId: viejo, salaDestinoId: "sa1", fecha: "2026-09-01", hora: "10:00" }, ctxMover(), db);
  assert.ok(r.ok, r.ok ? "" : r.error);

  assert.equal((await db.asiento.findFirstOrThrow({ where: { concepto: "cargo_uso" }, select: { periodo: true } })).periodo, "2026-09");
});

test("si el mes ya se liquidó, el turno no se mueve y nada cambia", async () => {
  await tarifaGeneral(800_000n);
  const viejo = await crear("sa1", "2026-08-12");
  // Sellar el asiento es lo que hace el cierre de mes: después de eso la plata no se toca.
  await pgPool.query(`
    INSERT INTO "Liquidacion"("id","operadorId","inquilinoId","periodo","numero","estado",
      "subtotalCent","netoCent","ivaCent","alicuota","totalCent","venceEl",
      "receptorRazonSocial","receptorCondIva")
    VALUES('li1','op1','in1','2026-08',1,'emitida',800000,800000,0,0,800000,
      '2026-09-10T00:00:00Z','Dra Perez','monotributo')`);
  await pgPool.query(`UPDATE "Asiento" SET "liquidacionId"='li1' WHERE "concepto"='cargo_uso'`);

  const r = await moverOcupacion({ ocupacionId: viejo, salaDestinoId: "sa1", fecha: "2026-08-13", hora: "15:00" }, ctxMover(), db);
  assert.deepEqual(r, { ok: false, error: "MES_CERRADO" });

  assert.equal((await db.ocupacion.findUniqueOrThrow({ where: { id: viejo }, select: { estado: true } })).estado, "confirmada");
  assert.equal(await db.ocupacion.count(), 1);
});
