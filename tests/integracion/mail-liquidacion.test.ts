// tests/integracion/mail-liquidacion.test.ts — la cuenta del mes, en la casilla del profesional.
//
// Un mail no se deshace. Lo que puede salir mal acá no lanza ningún error: un importe de otro mes,
// el nombre del de al lado, o —lo peor— que salga a la dirección equivocada. Por eso el sender se
// inyecta y los tests miran el contenido, no que "no explote".

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { enviarLiquidacionCon } from "../../src/servicios/plata/mail-liquidacion.ts";
import { cobroCon } from "../../src/servicios/config/cobro.ts";
import { cerrarPeriodo } from "../../src/servicios/plata/liquidacion.ts";
import { asentarIdempotente } from "../../src/servicios/plata/ledger.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Mensaje, ResultadoEnvio } from "../../src/lib/email.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { insertarOcupacion, nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });

const owner: Actor = { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null };
const profesional: Actor = { usuarioId: "u2", operadorId: "op1", rol: "inquilino_titular", inquilinoId: "in1" };
const PERIODO = "2026-08";

/** Un buzón de mentira: guarda lo que se le manda en vez de salir a la red. */
function buzon(resultado: ResultadoEnvio = { ok: true, via: "smtp" }) {
  const enviados: Mensaje[] = [];
  const mandar = async (m: Mensaje) => { enviados.push(m); return resultado; };
  return { enviados, mandar };
}

async function sesionYCierre() {
  await insertarOcupacion(pgPool, {
    id: "oc1", salaId: "sa1", inquilinoId: "in1",
    inicio: "2026-08-12T13:00:00Z", fin: "2026-08-12T16:00:00Z",
  });
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId: "in1", concepto: "cargo_uso", montoCent: 2_400_000n,
    moneda: "ARS", periodo: PERIODO, fechaHecho: new Date("2026-08-12T13:00:00Z"),
    clave: "cargo_uso:oc1", reservaId: "oc1",
  });
  const r = await cerrarPeriodo({
    operadorId: "op1", inquilinoId: "in1", periodo: PERIODO, alicuotaDecimas: 0,
    venceEl: new Date("2026-09-07T12:00:00Z"), receptorRazonSocial: "Dra Perez", receptorCondIva: "no informada",
  }, db);
  assert.ok(r.ok);
  return r.liquidacionId;
}

const conEmail = (email: string) => pgPool.query(`UPDATE "Inquilino" SET "email" = $1 WHERE id = 'in1'`, [email]);

before(async () => {
  await reiniciarEsquema(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Operador","Usuario" CASCADE');
  await seedBase(pgPool);
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

// ── A quién le llega ────────────────────────────────────────────────────────

test("sale al email de la ficha del profesional", async () => {
  const id = await sesionYCierre();
  await conEmail("perez@example.com");
  const b = buzon();

  const r = await enviarLiquidacionCon(db, b.mandar)(owner, { liquidacionId: id });
  assert.ok(r.ok && r.data.ok);
  assert.equal(r.data.para, "perez@example.com");
  assert.equal(b.enviados.length, 1);
  assert.equal(b.enviados[0]!.para, "perez@example.com");
});

test("sin email cargado NO se manda a ningún lado", async () => {
  const id = await sesionYCierre();
  const b = buzon();

  const r = await enviarLiquidacionCon(db, b.mandar)(owner, { liquidacionId: id });
  assert.ok(r.ok);
  assert.equal(r.data.ok === false && r.data.error, "SIN_EMAIL");
  // Mandarlo a la casilla del administrador sería peor que no mandarlo: quedaría marcado como
  // enviado y el profesional no se enteró de nada.
  assert.equal(b.enviados.length, 0);
});

test("un profesional no puede mandar liquidaciones", async () => {
  const id = await sesionYCierre();
  await conEmail("perez@example.com");
  const b = buzon();

  const r = await enviarLiquidacionCon(db, b.mandar)(profesional, { liquidacionId: id });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error, "SIN_PERMISO");
  assert.equal(b.enviados.length, 0);
});

test("la liquidación de otro centro no se manda por id", async () => {
  await sesionYCierre();
  const b = buzon();
  const r = await enviarLiquidacionCon(db, b.mandar)(owner, { liquidacionId: "no-existe" });
  assert.ok(r.ok);
  assert.equal(r.data.ok === false && r.data.error, "NO_ENCONTRADA");
  assert.equal(b.enviados.length, 0);
});

test("si el correo no está configurado se dice, y no se marca como enviado", async () => {
  const id = await sesionYCierre();
  await conEmail("perez@example.com");
  const b = buzon({ ok: false, motivo: "sin_configurar" });

  const r = await enviarLiquidacionCon(db, b.mandar)(owner, { liquidacionId: id });
  assert.ok(r.ok);
  assert.equal(r.data.ok === false && r.data.error, "SIN_CONFIGURAR");
});

// ── Qué dice el mail ────────────────────────────────────────────────────────

test("el mail lleva el total, el vencimiento y las horas del mes", async () => {
  const id = await sesionYCierre();
  await conEmail("perez@example.com");
  const b = buzon();
  await enviarLiquidacionCon(db, b.mandar)(owner, { liquidacionId: id });

  const m = b.enviados[0]!;
  assert.match(m.asunto, /agosto de 2026/);
  for (const cuerpo of [m.texto, m.html]) {
    assert.ok(cuerpo.includes("24.000"), "el total tiene que estar en los dos cuerpos");
    assert.ok(cuerpo.includes("3 h"), "y las horas del mes");
    assert.ok(/7 de septiembre/.test(cuerpo), "y el vencimiento");
  }
});

test("el mail lleva los datos para transferir, si están cargados", async () => {
  const id = await sesionYCierre();
  await conEmail("perez@example.com");
  await cobroCon(db)(owner, {
    titular: "Ramiro Julian Raño", cuit: "20-39770377-0", cbu: "0000177500099146760167",
    alias: "ramirorano.astropay", banco: "Astropay", nota: null, diaVencimiento: 7,
  });
  const b = buzon();
  await enviarLiquidacionCon(db, b.mandar)(owner, { liquidacionId: id });

  const m = b.enviados[0]!;
  assert.ok(m.texto.includes("ramirorano.astropay"));
  assert.ok(m.texto.includes("0000177500099146760167"));
  assert.ok(m.html.includes("ramirorano.astropay"));
});

test("sin datos de cobro cargados no aparece un bloque vacío", async () => {
  const id = await sesionYCierre();
  await conEmail("perez@example.com");
  const b = buzon();
  await enviarLiquidacionCon(db, b.mandar)(owner, { liquidacionId: id });

  assert.equal(b.enviados[0]!.texto.includes("Para transferir"), false);
});

test("el detalle día por día viaja en el mail", async () => {
  const id = await sesionYCierre();
  await conEmail("perez@example.com");
  const b = buzon();
  await enviarLiquidacionCon(db, b.mandar)(owner, { liquidacionId: id });

  // El horario de la sesión, que es lo que el profesional contrasta con su agenda.
  assert.match(b.enviados[0]!.texto, /\d{2}:\d{2} a \d{2}:\d{2}/);
  assert.ok(b.enviados[0]!.texto.includes("Sala 1"));
});

test("un nombre con < o & no rompe el HTML del mail", async () => {
  const id = await sesionYCierre();
  await pgPool.query(`UPDATE "Liquidacion" SET "receptorRazonSocial" = 'Perez & <b>Asoc</b>' WHERE id = $1`, [id]);
  await conEmail("perez@example.com");
  const b = buzon();
  await enviarLiquidacionCon(db, b.mandar)(owner, { liquidacionId: id });

  const html = b.enviados[0]!.html;
  assert.ok(html.includes("Perez &amp; &lt;b&gt;Asoc&lt;/b&gt;"), "escapado");
  assert.equal(html.includes("<b>Asoc</b>"), false, "y no inyectado como etiqueta");
});
