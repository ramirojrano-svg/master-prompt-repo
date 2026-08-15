// tests/integracion/cobros.test.ts — registrar que alguien pagó (§5.7.1).
//
// Lo que se protege es plata real: que cargar dos veces el mismo comprobante NO cuente dos pagos
// (pasa siempre que se concilia el resumen del banco más de una vez), que anular deje rastro en
// vez de borrar, y que un cobro de fin de mes asentado el día 2 del siguiente caiga en el mes en
// que entró la plata y no en el que se cargó.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { cobrosCon, cobrosDelMes } from "../../src/servicios/plata/cobros.ts";
import { saldoCorriente } from "../../src/servicios/plata/ledger.ts";
import { prisma } from "../../src/db/prisma.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: `${URL_DB}?connection_limit=20&pool_timeout=20` });

const OWNER = { usuarioId: "u1", operadorId: "op1", rol: "owner" as const, inquilinoId: null };
const { registrar: registrarCobro, anular: anularCobro } = cobrosCon(db);

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Asiento" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

const saldo = () => saldoCorriente(db, { operadorId: "op1", inquilinoId: "in1" });
const pagos = () => db.asiento.findMany({ where: { concepto: "pago" }, select: { montoCent: true, periodo: true, medio: true, referencia: true, fechaHecho: true } });

test("un cobro baja el saldo: es plata a favor del profesional", async () => {
  const r = await registrarCobro(OWNER, { inquilinoId: "in1", monto: 50_000, medio: "transferencia", fecha: "2026-08-10" });
  assert.ok(r.ok && r.data.ok && !r.data.duplicado);

  // En el libro el pago va NEGATIVO: resta de lo que la persona debe.
  assert.equal(await saldo(), -5_000_000n);
  const [p] = await pagos();
  assert.equal(p!.medio, "transferencia");
  assert.equal(p!.periodo, "2026-08");
});

test("el mismo comprobante cargado dos veces es UN cobro, no dos", async () => {
  // Es el caso real: se concilia el resumen a mitad de mes y otra vez al cerrarlo.
  const uno = { inquilinoId: "in1", monto: 50_000, medio: "transferencia" as const, referencia: "OP-99887766", fecha: "2026-08-10" };
  const a = await registrarCobro(OWNER, uno);
  const b = await registrarCobro(OWNER, uno);

  assert.ok(a.ok && a.data.ok && !a.data.duplicado);
  assert.ok(b.ok && b.data.ok && b.data.duplicado, "la segunda carga tiene que avisar que ya estaba");
  assert.equal((await pagos()).length, 1);
  assert.equal(await saldo(), -5_000_000n, "el saldo no puede bajar dos veces por el mismo pago");
});

test("dos comprobantes distintos son dos cobros aunque el importe sea igual", async () => {
  const base = { inquilinoId: "in1", monto: 50_000, medio: "transferencia" as const, fecha: "2026-08-10" };
  await registrarCobro(OWNER, { ...base, referencia: "OP-1" });
  await registrarCobro(OWNER, { ...base, referencia: "OP-2" });
  assert.equal((await pagos()).length, 2);
  assert.equal(await saldo(), -10_000_000n);
});

test("sin comprobante, dos cobros iguales se asientan los dos", async () => {
  // Sin referencia no hay forma de distinguir dos pagos iguales de uno cargado dos veces, y ante
  // la duda es mejor duplicar —se anula— que comerse un cobro que sí entró.
  const base = { inquilinoId: "in1", monto: 50_000, medio: "mercado_pago" as const, fecha: "2026-08-10" };
  await registrarCobro(OWNER, base);
  await registrarCobro(OWNER, base);
  assert.equal((await pagos()).length, 2);
});

test("el mismo número en medios distintos son cobros distintos", async () => {
  // Los numeradores de Mercado Pago y del banco son independientes: que coincidan es casualidad.
  const base = { inquilinoId: "in1", monto: 10_000, referencia: "1234", fecha: "2026-08-10" };
  await registrarCobro(OWNER, { ...base, medio: "transferencia" });
  await registrarCobro(OWNER, { ...base, medio: "mercado_pago" });
  assert.equal((await pagos()).length, 2);
});

test("el cobro cae en el mes en que ENTRÓ la plata, no en el que se cargó", async () => {
  // Se carga el 2 de septiembre una transferencia del 31 de agosto: es plata de agosto.
  await registrarCobro(OWNER, { inquilinoId: "in1", monto: 50_000, medio: "transferencia", fecha: "2026-08-31" });
  const [p] = await pagos();
  assert.equal(p!.periodo, "2026-08");
  assert.ok(p!.fechaHecho.toISOString().startsWith("2026-08-31"));
});

test("anular deja el contraasiento y el saldo vuelve a donde estaba", async () => {
  await registrarCobro(OWNER, { inquilinoId: "in1", monto: 50_000, medio: "transferencia", referencia: "OP-1", fecha: "2026-08-10" });
  const antes = await saldo();
  assert.equal(antes, -5_000_000n);

  const [cobro] = await cobrosDelMes({ operadorId: "op1", inquilinoId: "in1", periodo: "2026-08" }, db);
  const r = await anularCobro(OWNER, { asientoId: cobro!.id, motivo: "cargado al profesional equivocado" });
  assert.ok(r.ok && r.data.ok);

  assert.equal(await saldo(), 0n, "el contraasiento devuelve la deuda que el pago había bajado");
  // El pago NO se borra: el libro es append-only y el resumen que ya se mostró sigue explicándose.
  assert.equal((await pagos()).length, 1);
  const rev = await db.asiento.findFirstOrThrow({ where: { revierteAId: cobro!.id }, select: { montoCent: true, periodo: true, motivo: true } });
  assert.equal(rev.montoCent, 5_000_000n);
  assert.equal(rev.periodo, "2026-08", "la anulación pertenece al mes del cobro original");
  assert.equal(rev.motivo, "cargado al profesional equivocado");
});

test("anular dos veces no devuelve la plata dos veces", async () => {
  await registrarCobro(OWNER, { inquilinoId: "in1", monto: 50_000, medio: "transferencia", referencia: "OP-1", fecha: "2026-08-10" });
  const [cobro] = await cobrosDelMes({ operadorId: "op1", inquilinoId: "in1", periodo: "2026-08" }, db);

  await anularCobro(OWNER, { asientoId: cobro!.id, motivo: "error de carga" });
  const segunda = await anularCobro(OWNER, { asientoId: cobro!.id, motivo: "error de carga" });

  assert.ok(segunda.ok && !segunda.data.ok && segunda.data.error === "YA_ANULADO");
  assert.equal(await saldo(), 0n);
});

test("un cobro de un mes ya cerrado no se puede anular", async () => {
  await registrarCobro(OWNER, { inquilinoId: "in1", monto: 50_000, medio: "transferencia", referencia: "OP-1", fecha: "2026-08-10" });
  const [cobro] = await cobrosDelMes({ operadorId: "op1", inquilinoId: "in1", periodo: "2026-08" }, db);
  // Sellarlo es lo que hace emitir la liquidación del período.
  await db.asiento.update({ where: { id: cobro!.id }, data: { liquidacionId: "liq-cerrada" } });

  const r = await anularCobro(OWNER, { asientoId: cobro!.id, motivo: "tarde" });
  assert.ok(r.ok && !r.data.ok && r.data.error === "MES_CERRADO");
  assert.equal(await saldo(), -5_000_000n, "el mes cerrado no se movió");
});

test("el listado muestra el importe en positivo y marca los anulados", async () => {
  await registrarCobro(OWNER, { inquilinoId: "in1", monto: 30_000, medio: "mercado_pago", referencia: "MP-1", fecha: "2026-08-05" });
  await registrarCobro(OWNER, { inquilinoId: "in1", monto: 20_000, medio: "transferencia", referencia: "TR-1", fecha: "2026-08-20" });

  let lista = await cobrosDelMes({ operadorId: "op1", inquilinoId: "in1", periodo: "2026-08" }, db);
  assert.equal(lista.length, 2);
  // Más reciente primero, y en positivo: "pagó $20.000" con signo menos se lee al revés.
  assert.equal(lista[0]!.referencia, "TR-1");
  assert.equal(lista[0]!.montoCent, 2_000_000n);
  assert.ok(lista.every((c) => !c.anulado));

  await anularCobro(OWNER, { asientoId: lista[0]!.id, motivo: "duplicado del banco" });
  lista = await cobrosDelMes({ operadorId: "op1", inquilinoId: "in1", periodo: "2026-08" }, db);
  assert.equal(lista.find((c) => c.referencia === "TR-1")!.anulado, true);
  assert.equal(lista.find((c) => c.referencia === "MP-1")!.anulado, false);
});

test("un profesional de otro centro no existe acá", async () => {
  const r = await registrarCobro(OWNER, { inquilinoId: "no-existe", monto: 1_000, medio: "transferencia" });
  assert.ok(r.ok && !r.data.ok && r.data.error === "INQUILINO_INEXISTENTE");
});

test("un profesional no puede registrar cobros", async () => {
  // Registrar un pago es de la administración: si el que debe puede asentar que pagó, el saldo
  // deja de significar nada.
  const inquilino = { usuarioId: "u2", operadorId: "op1", rol: "inquilino_titular" as const, inquilinoId: "in1" };
  const r = await registrarCobro(inquilino, { inquilinoId: "in1", monto: 50_000, medio: "transferencia" });
  assert.ok(!r.ok, "tiene que rechazarse por permisos");
});
