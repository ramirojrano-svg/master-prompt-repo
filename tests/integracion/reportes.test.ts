// tests/integracion/reportes.test.ts — el panel de datos (§6.8) contra Postgres de verdad.
// Lo que se prueba acá es lo que hace inútil a un reporte: que un filtro esconda una fila, que
// el detalle no sume el total, o que el denominador de la ocupación sea inventado.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { reporteMensual } from "../../src/servicios/reportes/mensual.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { insertarOcupacion, nuevoPool, reiniciarEsquema, seedBase, TZ_SEDE, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });

const owner: Actor = { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null };
const PERIODO = "2026-05"; // mayo 2026: 31 días, 21 hábiles

// Horario L-V 08:00-22:00 (840′ por día hábil) para las dos salas del seed base.
const HORARIO = JSON.stringify({
  "0": [], "6": [],
  "1": [{ desde: "08:00", hasta: "22:00" }],
  "2": [{ desde: "08:00", hasta: "22:00" }],
  "3": [{ desde: "08:00", hasta: "22:00" }],
  "4": [{ desde: "08:00", hasta: "22:00" }],
  "5": [{ desde: "08:00", hasta: "22:00" }],
});

async function asiento(inquilinoId: string, montoCent: bigint, periodo: string, clave: string, concepto = "cargo_uso") {
  await pgPool.query(
    `INSERT INTO "Asiento"("id","operadorId","inquilinoId","concepto","montoCent","moneda","periodo","fechaHecho","clave")
     VALUES ($1,'op1',$2,$3,$4,'ARS',$5,$6,$7)`,
    [clave, inquilinoId, concepto, montoCent.toString(), periodo, `${periodo}-15T12:00:00Z`, clave],
  );
}

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
  await pgPool.query(`UPDATE "Sala" SET "horarioJson"=$1::jsonb`, [HORARIO]);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Ocupacion", "Asiento" CASCADE');
  await pgPool.query(`UPDATE "Sala" SET "activa"=true, "archivadaEl"=NULL`);
  await pgPool.query(`UPDATE "Inquilino" SET "estado"='activo'`);
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

test("un período inválido no rompe la pantalla: devuelve null", async () => {
  assert.equal(await reporteMensual({ actor: owner, periodo: "2026-13" }, db), null);
  assert.equal(await reporteMensual({ actor: owner, periodo: "mayo" }, db), null);
});

test("un mes sin nada devuelve ceros, no NaN ni división por cero", async () => {
  const r = await reporteMensual({ actor: owner, periodo: PERIODO }, db);
  assert.ok(r);
  assert.equal(r.totales.facturadoCent, 0n);
  assert.equal(r.totales.ocupacionPct, 0);
  assert.equal(r.sinDetallarCent, 0n);
  assert.equal(r.profesionales.length, 2, "los profesionales aparecen aunque no hayan reservado");
  assert.ok(r.totales.aperturaMin > 0, "las salas abrieron igual: el denominador existe");
});

test("horas y plata por profesional, agregadas en SQL", async () => {
  // in1: 2 h el 4/5 + 1 h 30 el 5/5 · in2: 1 h el 4/5
  await insertarOcupacion(pgPool, { id: "o1", salaId: "sa1", inquilinoId: "in1", inicio: "2026-05-04T13:00:00Z", fin: "2026-05-04T15:00:00Z" });
  await insertarOcupacion(pgPool, { id: "o2", salaId: "sa1", inquilinoId: "in1", inicio: "2026-05-05T13:00:00Z", fin: "2026-05-05T14:30:00Z" });
  await insertarOcupacion(pgPool, { id: "o3", salaId: "sa2", inquilinoId: "in2", inicio: "2026-05-04T13:00:00Z", fin: "2026-05-04T14:00:00Z" });
  await asiento("in1", 2_800_000n, PERIODO, "a1");
  await asiento("in2", 800_000n, PERIODO, "a2");
  await asiento("in1", -1_000_000n, PERIODO, "a3", "pago");

  const r = await reporteMensual({ actor: owner, periodo: PERIODO }, db);
  assert.ok(r);
  const in1 = r.profesionales.find((p) => p.id === "in1")!;
  assert.equal(in1.reservas, 2);
  assert.equal(in1.minutos, 210, "2 h + 1 h 30");
  assert.equal(in1.facturadoCent, 2_800_000n);
  assert.equal(in1.pagadoCent, 1_000_000n, "lo que pagó se muestra aparte, no neteado");
  assert.equal(in1.saldoCent, 1_800_000n);

  assert.equal(r.totales.facturadoCent, 3_600_000n);
  assert.equal(r.totales.cobradoCent, 1_000_000n);
  assert.equal(r.totales.minutos, 270);
  assert.equal(r.totales.profesionalesConActividad, 2);
});

test("el detalle SUMA EXACTO el total facturado (§6.8)", async () => {
  await asiento("in1", 1_234_567n, PERIODO, "a1");
  await asiento("in2", 765_433n, PERIODO, "a2");
  const r = await reporteMensual({ actor: owner, periodo: PERIODO }, db);
  assert.ok(r);
  const suma = r.profesionales.reduce((acc, p) => acc + p.facturadoCent, 0n);
  assert.equal(suma, r.totales.facturadoCent);
  assert.equal(r.sinDetallarCent, 0n);
});

test("la deuda NO se netea con los que tienen saldo a favor (§5.6)", async () => {
  await asiento("in1", 1_000_000n, PERIODO, "a1"); // debe $10.000
  await asiento("in2", -400_000n, PERIODO, "a2", "pago"); // pagó de más: $4.000 a favor
  const r = await reporteMensual({ actor: owner, periodo: PERIODO }, db);
  assert.ok(r);
  assert.equal(r.totales.deudaCent, 1_000_000n, "la deuda es $10.000, no $6.000");
  assert.equal(r.profesionales.find((p) => p.id === "in2")?.saldoCent, -400_000n);
});

test("el saldo es ACUMULADO, no el del mes: la deuda vieja no se borra al cambiar de página", async () => {
  await asiento("in1", 500_000n, "2026-04", "viejo");
  await asiento("in1", 300_000n, PERIODO, "nuevo");
  const r = await reporteMensual({ actor: owner, periodo: PERIODO }, db);
  assert.ok(r);
  const in1 = r.profesionales.find((p) => p.id === "in1")!;
  assert.equal(in1.facturadoCent, 300_000n, "facturado del mes: solo mayo");
  assert.equal(in1.saldoCent, 800_000n, "saldo: todo lo que debe hasta hoy");
});

test("el profesional DE BAJA con historia sigue apareciendo (§3.6)", async () => {
  await pgPool.query(`UPDATE "Inquilino" SET "estado"='baja' WHERE "id"='in2'`);
  await insertarOcupacion(pgPool, { id: "o1", salaId: "sa1", inquilinoId: "in2", inicio: "2026-05-04T13:00:00Z", fin: "2026-05-04T14:00:00Z" });
  await asiento("in2", 800_000n, PERIODO, "a1");

  const r = await reporteMensual({ actor: owner, periodo: PERIODO }, db);
  assert.ok(r);
  const in2 = r.profesionales.find((p) => p.id === "in2");
  assert.ok(in2, "un filtro por estado lo habría hecho desaparecer con su plata adentro");
  assert.equal(in2.activo, false);
  assert.equal(in2.facturadoCent, 800_000n);
});

test("la sala ARCHIVADA con actividad sigue en el reporte", async () => {
  await pgPool.query(`UPDATE "Sala" SET "activa"=false, "archivadaEl"=now() WHERE "id"='sa2'`);
  await insertarOcupacion(pgPool, { id: "o1", salaId: "sa2", inquilinoId: "in1", inicio: "2026-05-04T13:00:00Z", fin: "2026-05-04T14:00:00Z" });

  const r = await reporteMensual({ actor: owner, periodo: PERIODO }, db);
  assert.ok(r);
  const sa2 = r.salas.find((s) => s.id === "sa2");
  assert.ok(sa2, "archivada con reservas: aparece igual");
  assert.equal(sa2.activa, false);
  assert.equal(sa2.minutos, 60);
  assert.equal(sa2.aperturaMin, 0, "ya no abre: sin denominador, sin porcentaje inventado");
  assert.equal(sa2.ocupacionPct, 0);
});

test("el denominador de la ocupación es lo que la sala ABRIÓ ese mes, no 24×31", async () => {
  await insertarOcupacion(pgPool, { id: "o1", salaId: "sa1", inquilinoId: "in1", inicio: "2026-05-04T13:00:00Z", fin: "2026-05-04T14:00:00Z" });
  const r = await reporteMensual({ actor: owner, periodo: PERIODO }, db);
  assert.ok(r);
  const sa1 = r.salas.find((s) => s.id === "sa1")!;
  // Mayo 2026: 21 días hábiles × 840′ = 17.640′.
  assert.equal(sa1.aperturaMin, 21 * 840);
  assert.equal(sa1.ocupacionPct, 0, "una hora sobre 294 h redondea a 0%: el número honesto");
  assert.notEqual(sa1.aperturaMin, 31 * 24 * 60);
});

test("los MANTENIMIENTOS y los holds no cuentan como horas vendidas", async () => {
  await insertarOcupacion(pgPool, { id: "o1", salaId: "sa1", inquilinoId: null, tipo: "mantenimiento", inicio: "2026-05-04T13:00:00Z", fin: "2026-05-04T17:00:00Z", bloqueaProfesional: false });
  await insertarOcupacion(pgPool, { id: "o2", salaId: "sa1", inquilinoId: "in1", tipo: "hold", inicio: "2026-05-05T13:00:00Z", fin: "2026-05-05T14:00:00Z", bloqueaProfesional: false, expiraAt: "2026-05-05T13:10:00Z" });
  const r = await reporteMensual({ actor: owner, periodo: PERIODO }, db);
  assert.ok(r);
  assert.equal(r.totales.minutos, 0, "ninguna de las dos es una hora vendida");
  assert.equal(r.totales.reservas, 0);
});

test("una reserva CANCELADA no factura", async () => {
  await insertarOcupacion(pgPool, { id: "o1", salaId: "sa1", inquilinoId: "in1", estado: "cancelada", inicio: "2026-05-04T13:00:00Z", fin: "2026-05-04T14:00:00Z" });
  const r = await reporteMensual({ actor: owner, periodo: PERIODO }, db);
  assert.ok(r);
  assert.equal(r.totales.minutos, 0);
});

test("un NO SHOW sí cuenta: la sala estuvo bloqueada igual", async () => {
  await insertarOcupacion(pgPool, { id: "o1", salaId: "sa1", inquilinoId: "in1", estado: "no_show", inicio: "2026-05-04T13:00:00Z", fin: "2026-05-04T14:00:00Z" });
  const r = await reporteMensual({ actor: owner, periodo: PERIODO }, db);
  assert.ok(r);
  assert.equal(r.totales.minutos, 60);
});

test("el mes se corta en la zona de la SEDE: la reserva de las 23:00 del 31 es de ESE mes", async () => {
  // 2026-05-31 23:00 AR = 2026-06-01 02:00 UTC. Cortando en UTC caería en junio.
  await insertarOcupacion(pgPool, { id: "o1", salaId: "sa1", inquilinoId: "in1", inicio: "2026-06-01T02:00:00Z", fin: "2026-06-01T03:00:00Z" });
  const mayo = await reporteMensual({ actor: owner, periodo: "2026-05" }, db);
  const junio = await reporteMensual({ actor: owner, periodo: "2026-06" }, db);
  assert.equal(mayo?.totales.minutos, 60, `en ${TZ_SEDE} eso todavía es 31 de mayo`);
  assert.equal(junio?.totales.minutos, 0);
});

test("otro operador no ve un solo peso de este (aislamiento explícito)", async () => {
  await pgPool.query(`INSERT INTO "Operador"("id","nombre","slug") VALUES('op9','Otro','otro9')`);
  await pgPool.query(`INSERT INTO "Sede"("id","operadorId","nombre","zonaHoraria") VALUES('se9','op9','S9','${TZ_SEDE}')`);
  await asiento("in1", 5_000_000n, PERIODO, "a1");

  const ajeno: Actor = { usuarioId: "u9", operadorId: "op9", rol: "owner", inquilinoId: null };
  const r = await reporteMensual({ actor: ajeno, periodo: PERIODO }, db);
  assert.ok(r);
  assert.equal(r.totales.facturadoCent, 0n);
  assert.equal(r.profesionales.length, 0);
  await pgPool.query(`DELETE FROM "Operador" WHERE "id"='op9'`);
});
