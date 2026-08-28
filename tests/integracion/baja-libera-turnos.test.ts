// tests/integracion/baja-libera-turnos.test.ts — dar de baja libera lo que viene, no lo que pasó.
//
// El reporte fue concreto: se da de baja a alguien que tenía turnos en septiembre y el cierre de
// mes le sigue ofreciendo liquidarle el mes entero. La causa era que la baja solo cambiaba una
// marca: sus horas seguían reservadas —ocupando un consultorio que no se le podía alquilar a
// nadie— y sus cargos seguían vivos.
//
// La línea que se prueba acá es la que separa las dos mitades del problema:
//  · Lo FUTURO se libera. No va a venir, así que la hora vuelve a estar disponible y el cargo se
//    devuelve.
//  · Lo PASADO no se toca. Usó el espacio y lo debe; la baja saca a alguien de la operación, no le
//    perdona lo que debe.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { inquilinosCon } from "../../src/servicios/config/inquilinos.ts";
import { cierreCon, pendientesDeCierre } from "../../src/servicios/plata/cierre.ts";
import { cancelarOcupacion } from "../../src/servicios/reservas/cancelar.ts";
import { asentarIdempotente } from "../../src/servicios/plata/ledger.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { insertarOcupacion, nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });
const { cambiarEstado } = inquilinosCon(db);

const owner: Actor = { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null };
const HOY = new Date("2026-08-25T12:00:00Z");

/** Una reserva con su cargo, como la crea la agenda. */
async function reserva(id: string, cuando: string, montoCent: bigint) {
  await insertarOcupacion(pgPool, {
    id, salaId: "sa1", inquilinoId: "in1",
    inicio: `${cuando}T13:00:00Z`, fin: `${cuando}T14:00:00Z`,
  });
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId: "in1", concepto: "cargo_uso", montoCent,
    moneda: "ARS", periodo: cuando.slice(0, 7), fechaHecho: new Date(`${cuando}T13:00:00Z`),
    clave: `cargo_uso:${id}`, reservaId: id,
  });
}

const estadoDe = async (id: string) =>
  (await db.ocupacion.findUnique({ where: { id }, select: { estado: true } }))?.estado;

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Asiento","Liquidacion","Ocupacion" CASCADE');
  await pgPool.query(`UPDATE "Inquilino" SET "estado"='activo'`);
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

test("la baja cancela los turnos FUTUROS y devuelve sus cargos", async () => {
  await reserva("f1", "2026-09-10", 100_000n);
  await reserva("f2", "2026-09-17", 100_000n);

  const r = await cambiarEstado(owner, { inquilinoId: "in1", estado: "baja" });
  assert.ok(r.ok && r.data.ok, "tenía que dar de baja");
  assert.equal(r.data.canceladas, 2);

  assert.equal(await estadoDe("f1"), "cancelada");
  assert.equal(await estadoDe("f2"), "cancelada");

  // El cargo no se borra: se compensa. El libro sigue explicando qué pasó.
  const neto = await db.asiento.aggregate({ where: { inquilinoId: "in1", periodo: "2026-09" }, _sum: { montoCent: true } });
  assert.equal(neto._sum.montoCent, 0n, "lo cobrado por horas que no se van a usar tiene que volver a cero");
});

test("NO toca lo que ya pasó: eso se le sigue cobrando", async () => {
  await reserva("p1", "2026-08-03", 80_000n); // ya ocurrió
  await reserva("f1", "2026-09-10", 100_000n); // todavía no

  const r = await cambiarEstado(owner, { inquilinoId: "in1", estado: "baja" });
  assert.ok(r.ok && r.data.ok);
  assert.equal(r.data.canceladas, 1, "solo el futuro");

  assert.equal(await estadoDe("p1"), "confirmada", "el turno usado queda como está");
  const agosto = await db.asiento.aggregate({ where: { inquilinoId: "in1", periodo: "2026-08" }, _sum: { montoCent: true } });
  assert.equal(agosto._sum.montoCent, 80_000n, "la deuda de lo usado no se perdona");
});

test("después de la baja, el cierre ya no ofrece liquidarle el mes que viene", async () => {
  await reserva("f1", "2026-09-10", 100_000n);

  const antes = await pendientesDeCierre({ operadorId: "op1", periodo: "2026-09" }, db);
  assert.equal(antes.length, 1, "antes figuraba");
  assert.ok(antes[0]!.pendienteCent > 0n);

  await cambiarEstado(owner, { inquilinoId: "in1", estado: "baja" });

  const despues = await pendientesDeCierre({ operadorId: "op1", periodo: "2026-09" }, db);
  const suyo = despues.find((f) => f.inquilinoId === "in1");
  assert.equal(suyo?.pendienteCent ?? 0n, 0n, "ya no hay nada que liquidarle de septiembre");
});

test("pero el mes que SÍ usó se le sigue pudiendo liquidar", async () => {
  await reserva("p1", "2026-08-03", 80_000n);
  await cambiarEstado(owner, { inquilinoId: "in1", estado: "baja" });

  const filas = await pendientesDeCierre({ operadorId: "op1", periodo: "2026-08" }, db);
  const suyo = filas.find((f) => f.inquilinoId === "in1");
  assert.equal(suyo?.pendienteCent, 80_000n, "sin esto, dar de baja borraría plata que se debe");
});

test("suspender NO cancela nada: es una pausa, no una salida", async () => {
  await reserva("f1", "2026-09-10", 100_000n);
  const r = await cambiarEstado(owner, { inquilinoId: "in1", estado: "suspendido" });
  assert.ok(r.ok && r.data.ok);
  assert.equal(r.data.canceladas, undefined);
  assert.equal(await estadoDe("f1"), "confirmada");
});

test("volver a activarlo no revive los turnos, y eso es a propósito", async () => {
  // Cancelar libera la hora, y liberar significa que otro se la pudo llevar. Devolverla sola
  // pisaría lo que se agendó en el medio.
  await reserva("f1", "2026-09-10", 100_000n);
  await cambiarEstado(owner, { inquilinoId: "in1", estado: "baja" });
  await cambiarEstado(owner, { inquilinoId: "in1", estado: "activo" });
  assert.equal(await estadoDe("f1"), "cancelada");
});

// ── El agujero que apareció investigando esto ───────────────────────────────
// No es de la baja: le pasa a CUALQUIER turno cancelado a mano. Cancelar suma una nota de crédito
// que deja el neto del libro en cero, pero `FACTURABLES` no la incluye, así que el cierre no la
// veía: reclamaba el cargo original y emitía la liquidación por el importe entero. El profesional
// recibía un papel cobrándole una hora que había cancelado.

test("un turno cancelado NO se factura, aunque no haya ninguna baja de por medio", async () => {
  await reserva("o1", "2026-09-10", 100_000n);
  const c = await cancelarOcupacion({ ocupacionId: "o1" }, { operadorId: "op1" }, db);
  assert.ok(c.ok);

  const neto = await db.asiento.aggregate({ where: { inquilinoId: "in1", periodo: "2026-09" }, _sum: { montoCent: true } });
  assert.equal(neto._sum.montoCent, 0n, "el libro ya lo tenía bien");

  const filas = await pendientesDeCierre({ operadorId: "op1", periodo: "2026-09" }, db);
  assert.equal(filas.find((f) => f.inquilinoId === "in1")?.pendienteCent ?? 0n, 0n, "la pantalla no puede ofrecer cobrarlo");

  const { todos } = cierreCon(db);
  await todos(owner, { periodo: "2026-09", venceEl: "2026-10-07" });
  const liq = await db.liquidacion.findFirst({ where: { periodo: "2026-09" } });
  assert.equal(liq, null, "y no se emite ningún papel por una hora que no se usó");
});

test("cancelar UNO de varios turnos descuenta solo ese", async () => {
  await reserva("o1", "2026-09-10", 100_000n);
  await reserva("o2", "2026-09-17", 100_000n);
  await reserva("o3", "2026-09-24", 100_000n);
  await cancelarOcupacion({ ocupacionId: "o2" }, { operadorId: "op1" }, db);

  const filas = await pendientesDeCierre({ operadorId: "op1", periodo: "2026-09" }, db);
  assert.equal(filas.find((f) => f.inquilinoId === "in1")?.pendienteCent, 200_000n, "quedan dos horas, no tres");

  const { todos } = cierreCon(db);
  await todos(owner, { periodo: "2026-09", venceEl: "2026-10-07" });
  const liq = await db.liquidacion.findFirst({ where: { periodo: "2026-09" }, select: { totalCent: true } });
  assert.equal(liq?.totalCent, 200_000n, "lo que la pantalla anunció es lo que se emite");
});
