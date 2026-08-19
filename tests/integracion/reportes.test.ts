// tests/integracion/reportes.test.ts — el panel de datos (§6.8) contra Postgres de verdad.
// Lo que se prueba acá es lo que hace inútil a un reporte: que un filtro esconda una fila, que
// el detalle no sume el total, o que el denominador de la ocupación sea inventado.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { detalleProfesional, reporteMensual } from "../../src/servicios/reportes/mensual.ts";
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
  await pgPool.query('TRUNCATE "Ocupacion", "Asiento", "Tarifa" CASCADE');
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

test("los BLOQUEOS y los holds no cuentan como horas vendidas", async () => {
  await insertarOcupacion(pgPool, { id: "o1", salaId: "sa1", inquilinoId: null, tipo: "bloqueo", inicio: "2026-05-04T13:00:00Z", fin: "2026-05-04T17:00:00Z", bloqueaProfesional: false });
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

// ── Detalle de un profesional ───────────────────────────────────────────────
test("el detalle dice cuántas horas usó, qué días y a qué hora", async () => {
  // Lunes 4/5 de 10 a 12, lunes 11/5 de 10 a 11, jueves 7/5 de 15 a 16:30 (horas AR).
  await insertarOcupacion(pgPool, { id: "o1", salaId: "sa1", inquilinoId: "in1", inicio: "2026-05-04T13:00:00Z", fin: "2026-05-04T15:00:00Z" });
  await insertarOcupacion(pgPool, { id: "o2", salaId: "sa1", inquilinoId: "in1", inicio: "2026-05-11T13:00:00Z", fin: "2026-05-11T14:00:00Z" });
  await insertarOcupacion(pgPool, { id: "o3", salaId: "sa2", inquilinoId: "in1", inicio: "2026-05-07T18:00:00Z", fin: "2026-05-07T19:30:00Z" });

  const d = await detalleProfesional({ actor: owner, periodo: PERIODO, inquilinoId: "in1" }, db);
  assert.ok(d);
  assert.equal(d.totales.reservas, 3);
  assert.equal(d.totales.minutos, 120 + 60 + 90);
  assert.equal(d.totales.diasDistintos, 3);

  assert.equal(d.turnos[0]!.fecha, "2026-05-04");
  assert.equal(d.turnos[0]!.horaTexto, "10:00 – 12:00", "la hora es la del CENTRO, no UTC");
  assert.equal(d.turnos[0]!.salaNombre, "Sala 1");
  // Vienen ordenados por fecha: 4/5, 7/5, 11/5 — no en el orden en que se insertaron.
  assert.equal(d.turnos[1]!.fecha, "2026-05-07");
  assert.equal(d.turnos[1]!.horaTexto, "15:00 – 16:30");

  const lunes = d.porDiaSemana.find((x) => x.dia === 1)!;
  assert.equal(lunes.reservas, 2, "los dos lunes se agrupan: 'siempre los lunes' se ve de una");
  assert.equal(lunes.minutos, 180);
  assert.equal(d.porDiaSemana.find((x) => x.dia === 4)!.minutos, 90, "el jueves");
  assert.equal(d.porDiaSemana.find((x) => x.dia === 3)!.reservas, 0, "el miércoles no vino");

  assert.equal(d.porFranja.find((f) => f.franja === "mañana")!.minutos, 180);
  assert.equal(d.porFranja.find((f) => f.franja === "tarde")!.minutos, 90);
  assert.equal(d.porFranja.find((f) => f.franja === "noche")!.minutos, 0);
});

test("el detalle suma los importes ESTAMPADOS y los compara con el libro", async () => {
  await insertarOcupacion(pgPool, { id: "o1", salaId: "sa1", inquilinoId: "in1", inicio: "2026-05-04T13:00:00Z", fin: "2026-05-04T14:00:00Z" });
  await pgPool.query(`UPDATE "Ocupacion" SET "importeCent"=800000 WHERE "id"='o1'`);
  await asiento("in1", 800_000n, PERIODO, "a1");
  await asiento("in1", 150_000n, PERIODO, "a2", "penalidad_noshow"); // no es una hora de consultorio
  await asiento("in1", -500_000n, PERIODO, "a3", "pago");

  const d = await detalleProfesional({ actor: owner, periodo: PERIODO, inquilinoId: "in1" }, db);
  assert.ok(d);
  assert.equal(d.totales.importeCent, 800_000n, "lo que suman los turnos");
  assert.equal(d.totales.facturadoCent, 950_000n, "lo que dice el libro (turno + penalidad)");
  assert.equal(d.totales.pagadoCent, 500_000n);
  assert.equal(d.totales.saldoCent, 450_000n);
});

// ── Reservas que nacieron sin tarifa ────────────────────────────────────────
// Se carga la agenda antes que los precios, que es el orden natural: primero se ve si la app
// sirve, después se configura la plata. Esas reservas quedan con el importe en NULL, y antes eso
// significaba que sumaban CERO al mes: la pantalla mostraba "36 h en 7 reservas × $8.000 la hora"
// y arriba un total que correspondía a UNA sola. Dos números contradictorios en la misma tarjeta.

async function tarifaGeneral(precioHoraCent: number) {
  await pgPool.query(
    `INSERT INTO "Tarifa"("id","operadorId","salaId","inquilinoId","nombre","precioHoraCent","vigenteDesde")
     VALUES('tGen','op1',NULL,NULL,'General',$1, now() - interval '1 day')`,
    [precioHoraCent],
  );
}

test("EL CASO DEL MES ROTO: 1 reserva con precio y 6 sin, el total son las 7", async () => {
  await tarifaGeneral(800_000);

  // La que nació con precio: 6 h el 4/5.
  await insertarOcupacion(pgPool, { id: "o1", salaId: "sa1", inquilinoId: "in1", inicio: "2026-05-04T11:00:00Z", fin: "2026-05-04T17:00:00Z" });
  await pgPool.query(`UPDATE "Ocupacion" SET "importeCent"=4800000, "precioHoraCent"=800000 WHERE "id"='o1'`);

  // Seis de 5 h que nacieron antes de que hubiera tarifa: importe NULL en la base.
  for (let i = 0; i < 6; i++) {
    const dia = String(11 + i).padStart(2, "0");
    await insertarOcupacion(pgPool, {
      id: `o${i + 2}`, salaId: "sa1", inquilinoId: "in1",
      inicio: `2026-05-${dia}T17:00:00Z`, fin: `2026-05-${dia}T22:00:00Z`,
    });
  }

  const d = await detalleProfesional({ actor: owner, periodo: PERIODO, inquilinoId: "in1" }, db);
  assert.ok(d);
  assert.equal(d.totales.reservas, 7);
  assert.equal(d.totales.minutos, 6 * 60 + 6 * 5 * 60, "6 h + 30 h = 36 h");

  // 36 h × $8.000 = $288.000. Antes daba $48.000: solo la que tenía precio estampado.
  assert.equal(d.totales.importeCent, 28_800_000n, "el total tiene que ser el de TODAS las reservas");
  assert.equal(d.totales.estimadas, 6, "seis todavía no tienen el cargo asentado");

  // Ninguna puede quedar sin importe: era el guioncito de la columna.
  assert.ok(d.turnos.every((t) => t.importeCent > 0n), "ningún turno puede valer 0");
  assert.ok(d.turnos.every((t) => !t.sinTarifa), "hay tarifa vigente: ninguno queda 'a definir'");

  // Y el precio por hora es UNO SOLO, que es lo que la tarjeta muestra al lado del total.
  assert.deepEqual([...new Set(d.turnos.map((t) => t.precioHoraCent))], [800_000n]);
});

test("el precio ESTAMPADO manda: un cambio de tarifa no reescribe lo ya facturado (§8.8)", async () => {
  await tarifaGeneral(800_000); // hoy la hora vale $8.000
  // Pero esta reserva nació cuando valía $5.000, y eso quedó estampado.
  await insertarOcupacion(pgPool, { id: "o1", salaId: "sa1", inquilinoId: "in1", inicio: "2026-05-04T13:00:00Z", fin: "2026-05-04T14:00:00Z" });
  await pgPool.query(`UPDATE "Ocupacion" SET "importeCent"=500000, "precioHoraCent"=500000 WHERE "id"='o1'`);

  const d = await detalleProfesional({ actor: owner, periodo: PERIODO, inquilinoId: "in1" }, db);
  assert.equal(d!.turnos[0]!.importeCent, 500_000n, "vale lo que valía cuando se creó");
  assert.equal(d!.turnos[0]!.estimado, false);
  assert.equal(d!.totales.estimadas, 0);
});

test("sin NINGUNA tarifa el importe no se inventa: queda 'a definir', no $0", async () => {
  // Nada de tarifas cargadas: el centro todavía no le puso precio a nada.
  await insertarOcupacion(pgPool, { id: "o1", salaId: "sa1", inquilinoId: "in1", inicio: "2026-05-04T13:00:00Z", fin: "2026-05-04T14:00:00Z" });

  const d = await detalleProfesional({ actor: owner, periodo: PERIODO, inquilinoId: "in1" }, db);
  assert.equal(d!.turnos[0]!.sinTarifa, true, "hay que poder distinguirlo de una hora que sale $0");
  assert.equal(d!.turnos[0]!.importeCent, 0n);
  assert.equal(d!.totales.importeCent, 0n, "no se suma nada que no se sepa cuánto vale");
});

test("una reserva SIN CONSULTORIO también se cotiza: se cobra igual que si lo hubiera usado", async () => {
  await tarifaGeneral(800_000);
  await insertarOcupacion(pgPool, { id: "o1", salaId: null, inquilinoId: "in1", inicio: "2026-05-04T13:00:00Z", fin: "2026-05-04T16:00:00Z" });

  const d = await detalleProfesional({ actor: owner, periodo: PERIODO, inquilinoId: "in1" }, db);
  assert.equal(d!.turnos[0]!.salaNombre, "Sin consultorio");
  assert.equal(d!.turnos[0]!.importeCent, 2_400_000n, "3 h × $8.000");
});

test("un mes sin turnos igual muestra el saldo acumulado", async () => {
  await asiento("in1", 300_000n, "2026-04", "viejo");
  const d = await detalleProfesional({ actor: owner, periodo: PERIODO, inquilinoId: "in1" }, db);
  assert.ok(d);
  assert.equal(d.totales.reservas, 0);
  assert.equal(d.totales.facturadoCent, 0n, "este mes no facturó nada");
  assert.equal(d.totales.saldoCent, 300_000n, "pero la deuda vieja sigue ahí");
});

test("un profesional de OTRO operador no existe acá (pertenencia, no findUnique)", async () => {
  await pgPool.query(`INSERT INTO "Operador"("id","nombre","slug") VALUES('op8','Otro','otro8')`);
  await pgPool.query(`INSERT INTO "Inquilino"("id","operadorId","nombre") VALUES('inAjeno8','op8','Ajeno')`);
  const d = await detalleProfesional({ actor: owner, periodo: PERIODO, inquilinoId: "inAjeno8" }, db);
  assert.equal(d, null);
  await pgPool.query(`DELETE FROM "Operador" WHERE "id"='op8'`);
});

test("un período inválido en el detalle devuelve null, no una pantalla rota", async () => {
  assert.equal(await detalleProfesional({ actor: owner, periodo: "2026-99", inquilinoId: "in1" }, db), null);
});
