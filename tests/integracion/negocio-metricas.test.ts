// tests/integracion/negocio-metricas.test.ts — que Negocio diga la verdad.
//
// Es la pantalla con la que se toman decisiones sobre el centro: cuánto se facturó, cuánto entró,
// cuánto se gastó y si el mes cerró bien. Un número mal acá no se nota —no hay error, no hay
// pantalla rota, solo un resultado distinto del real— y se descubre tarde, comparando contra el
// banco.
//
// Lo que se prueba es la PROPAGACIÓN: que un cambio hecho en cualquier otra pantalla llegue acá
// con el signo y la columna correctos. Cada caso de abajo estuvo mal alguna vez.
//
// El error de fondo era clasificar por SIGNO en vez de por concepto, y el signo miente justo en
// las vueltas atrás: una nota de crédito es negativa y caía en "cobrado" (plata que nadie pagó),
// y la anulación de un cobro es positiva y caía en "facturado" (una venta que nunca existió).

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { rentabilidad } from "../../src/servicios/reportes/rentabilidad.ts";
import { reporteMensual } from "../../src/servicios/reportes/mensual.ts";
import { cancelarOcupacion } from "../../src/servicios/reservas/cancelar.ts";
import { cobrosCon } from "../../src/servicios/plata/cobros.ts";
import { gastosCon } from "../../src/servicios/plata/gastos.ts";
import { asentarIdempotente } from "../../src/servicios/plata/ledger.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { insertarOcupacion, nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });
const owner: Actor = { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null };
const profesional: Actor = { usuarioId: "u2", operadorId: "op1", rol: "inquilino_titular", inquilinoId: "in1" };
const P = "2026-09";

/** Un turno con su cargo, como lo crea la agenda. */
async function reserva(id: string, montoCent: bigint, dia = "10", inquilinoId = "in1") {
  await insertarOcupacion(pgPool, {
    id, salaId: "sa1", inquilinoId,
    inicio: `${P}-${dia}T13:00:00Z`, fin: `${P}-${dia}T14:00:00Z`,
  });
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId, concepto: "cargo_uso", montoCent,
    moneda: "ARS", periodo: P, fechaHecho: new Date(`${P}-${dia}T13:00:00Z`),
    clave: `cargo_uso:${id}`, reservaId: id,
  });
}

const negocio = () => rentabilidad({ actor: owner, periodo: P }, db);

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Asiento","Liquidacion","Ocupacion","Gasto" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

// ── Lo que llega desde la AGENDA ────────────────────────────────────────────

test("agendar un turno suma a lo facturado, y no a lo cobrado", async () => {
  await reserva("o1", 100_000n);
  const n = await negocio();
  assert.equal(n?.facturadoCent, 100_000n);
  assert.equal(n?.cobradoCent, 0n, "reservar no es pagar");
  assert.equal(n?.resultadoDevengadoCent, 100_000n);
});

test("cancelar el turno lo saca de lo facturado Y NO lo cuenta como cobrado", async () => {
  await reserva("o1", 100_000n);
  await cancelarOcupacion({ ocupacionId: "o1" }, { operadorId: "op1" }, db);

  const n = await negocio();
  assert.equal(n?.facturadoCent, 0n, "la hora no se usó: no se facturó");
  assert.equal(n?.cobradoCent, 0n, "y NADIE pagó nada. La nota de crédito no es plata que entró");
  assert.equal(n?.resultadoDevengadoCent, 0n);
});

test("cancelar uno de tres deja los otros dos en pie", async () => {
  await reserva("o1", 100_000n, "10");
  await reserva("o2", 100_000n, "17");
  await reserva("o3", 100_000n, "24");
  await cancelarOcupacion({ ocupacionId: "o2" }, { operadorId: "op1" }, db);

  assert.equal((await negocio())?.facturadoCent, 200_000n);
});

test("un turno cancelado tampoco cuenta como hora vendida", async () => {
  await reserva("o1", 100_000n);
  const antes = await reporteMensual({ actor: owner, periodo: P }, db);
  await cancelarOcupacion({ ocupacionId: "o1" }, { operadorId: "op1" }, db);
  const despues = await reporteMensual({ actor: owner, periodo: P }, db);

  assert.ok((antes?.totales.minutos ?? 0) > 0, "antes contaba");
  assert.equal(despues?.totales.minutos, 0, "una hora cancelada no se vendió");
});

// ── Lo que llega desde COBROS ───────────────────────────────────────────────

test("registrar un cobro suma a lo cobrado y NO toca lo facturado", async () => {
  await reserva("o1", 100_000n);
  const { registrar } = cobrosCon(db);
  await registrar(owner, { inquilinoId: "in1", monto: "1000", medio: "transferencia", fecha: `${P}-15` });

  const n = await negocio();
  assert.equal(n?.facturadoCent, 100_000n, "cobrar no factura de nuevo");
  assert.equal(n?.cobradoCent, 100_000n);
});

test("anular un cobro lo saca de lo cobrado y NO lo suma a lo facturado", async () => {
  await reserva("o1", 100_000n);
  const { registrar, anular } = cobrosCon(db);
  await registrar(owner, { inquilinoId: "in1", monto: "1000", medio: "transferencia", fecha: `${P}-15` });
  const pago = await db.asiento.findFirst({ where: { concepto: "pago" }, select: { id: true } });
  await anular(owner, { asientoId: pago!.id, motivo: "se arrepintió" });

  const n = await negocio();
  assert.equal(n?.cobradoCent, 0n, "la plata volvió");
  assert.equal(n?.facturadoCent, 100_000n, "anular un pago NO es una venta nueva");
});

// ── Lo que llega desde GASTOS ───────────────────────────────────────────────

test("un gasto baja el resultado, y anularlo lo devuelve", async () => {
  await reserva("o1", 100_000n);
  const { cargar, anular } = gastosCon(db);
  const g = await cargar(owner, { rubro: "limpieza", detalle: "trapos y lavandina", monto: 300, fecha: `${P}-05` });
  assert.ok(g.ok && g.data.ok, "el gasto tenía que entrar");

  const conGasto = await negocio();
  assert.equal(conGasto?.gastosCent, 30_000n);
  assert.equal(conGasto?.resultadoDevengadoCent, 70_000n, "facturado menos gastos");

  const fila = await db.gasto.findFirst({ select: { id: true } });
  await anular(owner, { gastoId: fila!.id, motivo: "cargado por error" });

  const sinGasto = await negocio();
  assert.equal(sinGasto?.gastosCent, 0n, "un gasto anulado no se gastó");
  assert.equal(sinGasto?.resultadoDevengadoCent, 100_000n);
});

// ── Aislamiento ─────────────────────────────────────────────────────────────

test("lo de un mes no se mezcla con el de al lado", async () => {
  await reserva("o1", 100_000n);
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId: "in1", concepto: "cargo_uso", montoCent: 999_000n,
    moneda: "ARS", periodo: "2026-08", fechaHecho: new Date("2026-08-10T13:00:00Z"), clave: "otro_mes",
  });
  assert.equal((await negocio())?.facturadoCent, 100_000n, "agosto no puede aparecer en septiembre");
});

test("el profesional no ve los números del centro", async () => {
  await reserva("o1", 100_000n);
  assert.equal(await rentabilidad({ actor: profesional, periodo: P }, db), null);
});

test("la historia de seis meses termina en el mes pedido y coincide con él", async () => {
  await reserva("o1", 100_000n);
  const n = await negocio();
  assert.equal(n?.historia.length, 6);
  assert.equal(n?.historia.at(-1)?.periodo, P, "el último del corte es el que se está mirando");
  assert.equal(n?.historia.at(-1)?.facturadoCent, n?.facturadoCent, "y tiene que decir lo mismo que el encabezado");
});
