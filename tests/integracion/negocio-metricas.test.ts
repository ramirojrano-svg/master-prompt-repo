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
import { detalleProfesional, reporteMensual } from "../../src/servicios/reportes/mensual.ts";
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

// ── La ficha del profesional ────────────────────────────────────────────────
//
// Los mismos dos números, en la pantalla donde se los mira de a uno para cobrarle. Estaban
// calculados por signo mucho después de que Negocio se arreglara: se arregló un archivo y los
// otros tres siguieron mintiendo. Un profesional al que se le canceló un turno y se le anuló un
// cobro aparecía con "Pagó" inflado y SALDO NEGATIVO —el centro debiéndole plata a él— cuando en
// realidad era él el que debía.

const fichaDe = () => detalleProfesional({ actor: owner, inquilinoId: "in1", periodo: P }, db);
const cobros = cobrosCon(db);

test("un cobro anulado no sigue contando como pagado en la ficha", async () => {
  await reserva("r1", 120_000n);
  await cobros.registrar(owner, { inquilinoId: "in1", monto: 1200, medio: "transferencia", fecha: `${P}-01` });
  const pago = await db.asiento.findFirstOrThrow({ where: { concepto: "pago" }, select: { id: true } });
  await cobros.anular(owner, { asientoId: pago.id, motivo: "nunca entró" });

  const d = (await fichaDe())!;
  assert.equal(d.totales.pagadoCent, 0n, "el cobro se anuló: no pagó nada");
  assert.equal(d.totales.facturadoCent, 120_000n, "la anulación no es una venta nueva");
});

test("un turno cancelado no figura como plata que el profesional pagó", async () => {
  await reserva("r1", 120_000n);
  await reserva("r2", 120_000n, "11");
  await cancelarOcupacion({ ocupacionId: "r2", motivo: "se enfermó" }, { operadorId: "op1", moneda: "ARS" }, db);

  const d = (await fichaDe())!;
  assert.equal(d.totales.pagadoCent, 0n, "una nota de crédito no es un pago");
  assert.equal(d.totales.facturadoCent, 120_000n, "el turno cancelado deja de facturarse");
});

test("cancelar un turno y anular el cobro no deja el saldo del mes en negativo", async () => {
  // El caso exacto que se vio en producción: la ficha decía que el centro le debía plata a él.
  await reserva("r1", 120_000n);
  await reserva("r2", 120_000n, "11");
  await cancelarOcupacion({ ocupacionId: "r2", motivo: "se enfermó" }, { operadorId: "op1", moneda: "ARS" }, db);
  await cobros.registrar(owner, { inquilinoId: "in1", monto: 1200, medio: "transferencia", fecha: `${P}-01` });
  const pago = await db.asiento.findFirstOrThrow({ where: { concepto: "pago" }, select: { id: true } });
  await cobros.anular(owner, { asientoId: pago.id, motivo: "rebotó" });

  const d = (await fichaDe())!;
  assert.equal(d.totales.pagadoCent, 0n);
  assert.equal(d.totales.facturadoCent, 120_000n);
  assert.ok(d.totales.saldoCent >= 0n, `el saldo no puede quedar negativo, quedó ${d.totales.saldoCent}`);
});

test("un cobro que SÍ quedó firme sigue contando como pagado", async () => {
  // El arreglo no puede haber apagado el caso normal, que es el 99% de las veces.
  await reserva("r1", 120_000n);
  await cobros.registrar(owner, { inquilinoId: "in1", monto: 1200, medio: "transferencia", fecha: `${P}-01` });

  const d = (await fichaDe())!;
  assert.equal(d.totales.pagadoCent, 120_000n);
  assert.equal(d.totales.facturadoCent, 120_000n);
});

test("la ficha y el reporte mensual dicen lo mismo del mismo profesional", async () => {
  // Dos pantallas con el mismo número calculado en dos consultas distintas es el error más caro
  // de explicar, porque las dos parecen correctas.
  await reserva("r1", 120_000n);
  await reserva("r2", 120_000n, "11");
  await cancelarOcupacion({ ocupacionId: "r2", motivo: "x" }, { operadorId: "op1", moneda: "ARS" }, db);
  await cobros.registrar(owner, { inquilinoId: "in1", monto: 500, medio: "efectivo", fecha: `${P}-05` });

  const d = (await fichaDe())!;
  const r = (await reporteMensual({ actor: owner, periodo: P }, db))!;
  const fila = r.profesionales.find((p) => p.id === "in1")!;
  assert.equal(fila.facturadoCent, d.totales.facturadoCent);
  assert.equal(fila.pagadoCent, d.totales.pagadoCent);
});
