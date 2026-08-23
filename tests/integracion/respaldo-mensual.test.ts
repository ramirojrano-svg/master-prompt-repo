// tests/integracion/respaldo-mensual.test.ts — el respaldo que corre solo.
//
// Como el envío de liquidaciones, actúa sin que nadie apriete nada. Lo que se prueba no es que
// funcione un día bueno, sino que:
//
//  · No corra el día equivocado (solo el primero del mes).
//  · Respalde el mes ANTERIOR, el que ya cerró.
//  · Le mande al administrador del centro, a la casilla que figura en la base.
//  · Los adjuntos sean los dos CSV, con su BOM, y lleguen en base64.
//  · Si no hay administrador con casilla, no invente un destinatario.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { respaldoMensual } from "../../src/servicios/reportes/respaldo-mensual.ts";
import { asentarIdempotente } from "../../src/servicios/plata/ledger.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Mensaje, ResultadoEnvio } from "../../src/lib/email.ts";
import { insertarOcupacion, nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });

// El respaldo corre el primero; el mes que respalda es el anterior.
const PRIMERO = "2026-09-01";
const MES_RESPALDADO = "2026-08";

function buzon(resultado: ResultadoEnvio = { ok: true, via: "smtp" }) {
  const enviados: Mensaje[] = [];
  return { enviados, mandar: async (m: Mensaje) => { enviados.push(m); return resultado; } };
}

/** El administrador del centro: un Usuario con una membresía owner. Es a quien llega el respaldo. */
async function conAdministrador(email: string) {
  await pgPool.query(`INSERT INTO "Usuario"("id","email","nombre") VALUES('u1',$1,'Dueño') ON CONFLICT DO NOTHING`, [email]);
  await pgPool.query(
    `INSERT INTO "UsuarioOperador"("usuarioId","operadorId","rol","activo") VALUES('u1','op1','owner',true)
     ON CONFLICT ("usuarioId","operadorId") DO UPDATE SET "rol"='owner',"activo"=true`,
  );
}

/** Un cargo y una reserva de AGOSTO: es lo que tiene que aparecer en los dos CSV. */
async function movimientoDeAgosto(id: string, inquilinoId: string, montoCent: bigint) {
  await insertarOcupacion(pgPool, {
    id, salaId: "sa1", inquilinoId,
    inicio: `2026-08-0${id.slice(-1)}T13:00:00Z`, fin: `2026-08-0${id.slice(-1)}T14:00:00Z`,
  });
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId, concepto: "cargo_uso", montoCent,
    moneda: "ARS", periodo: MES_RESPALDADO, fechaHecho: new Date(`2026-08-0${id.slice(-1)}T13:00:00Z`),
    clave: `cargo_uso:${id}`, reservaId: id,
  });
}

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

// ── Cuándo corre ────────────────────────────────────────────────────────────

test("no corre un día cualquiera del mes", async () => {
  await conAdministrador("dueno@example.com");
  const b = buzon();
  const r = await respaldoMensual({ operadorId: "op1", hoy: "2026-09-15" }, db, b.mandar);
  assert.deepEqual(r, { corrio: false, motivo: "no_es_el_dia" });
  assert.equal(b.enviados.length, 0);
});

test("el último día del mes tampoco: ese es del envío de liquidaciones, no de este", async () => {
  await conAdministrador("dueno@example.com");
  const b = buzon();
  const r = await respaldoMensual({ operadorId: "op1", hoy: "2026-08-31" }, db, b.mandar);
  assert.equal("corrio" in r && r.motivo, "no_es_el_dia");
  assert.equal(b.enviados.length, 0);
});

// ── El caso bueno ────────────────────────────────────────────────────────────

test("el primero de mes respalda el mes anterior y le manda al administrador", async () => {
  await conAdministrador("dueno@example.com");
  await movimientoDeAgosto("oc1", "in1", 800_000n);
  const b = buzon();

  const r = await respaldoMensual({ operadorId: "op1", hoy: PRIMERO }, db, b.mandar);
  assert.ok(!("corrio" in r), "tenía que correr");
  assert.equal(r.periodo, MES_RESPALDADO);
  assert.equal(r.destino, "dueno@example.com");
  assert.equal(r.enviado, true);

  assert.equal(b.enviados.length, 1);
  const m = b.enviados[0]!;
  assert.equal(m.para, "dueno@example.com");
  assert.equal(m.adjuntos?.length, 2, "van los dos CSV: movimientos y turnos");
  const nombres = m.adjuntos!.map((x) => x.nombre).sort();
  assert.deepEqual(nombres, [`emoapp-movimientos-${MES_RESPALDADO}.csv`, `emoapp-turnos-${MES_RESPALDADO}.csv`]);
});

test("los adjuntos llevan los datos reales del mes, con BOM y en base64", async () => {
  await conAdministrador("dueno@example.com");
  await movimientoDeAgosto("oc1", "in1", 800_000n);
  const b = buzon();

  await respaldoMensual({ operadorId: "op1", hoy: PRIMERO }, db, b.mandar);
  const movimientos = b.enviados[0]!.adjuntos!.find((x) => x.nombre.includes("movimientos"))!;
  const texto = Buffer.from(movimientos.contenidoBase64, "base64").toString("utf8");

  assert.ok(texto.startsWith("﻿"), "arranca con BOM, o Excel rompe los acentos");
  assert.ok(texto.includes("Dra Perez"), "el nombre del profesional está en el CSV");
  assert.ok(texto.includes("8000.00"), "y el importe del cargo");
});

// ── Lo que no puede pasar ─────────────────────────────────────────────────────

test("sin administrador con casilla no se inventa un destinatario", async () => {
  // Hay datos, pero nadie a quien mandarle: no hay membresía owner.
  await movimientoDeAgosto("oc1", "in1", 800_000n);
  const b = buzon();
  const r = await respaldoMensual({ operadorId: "op1", hoy: PRIMERO }, db, b.mandar);
  assert.deepEqual(r, { corrio: false, motivo: "sin_administrador" });
  assert.equal(b.enviados.length, 0);
});

test("forzar saltea el chequeo del día: es lo que permite una prueba controlada", async () => {
  await conAdministrador("dueno@example.com");
  await movimientoDeAgosto("oc1", "in1", 800_000n);
  const b = buzon();
  const r = await respaldoMensual({ operadorId: "op1", hoy: "2026-09-15", forzar: true }, db, b.mandar);
  assert.ok(!("corrio" in r) && r.enviado, "con forzar corre cualquier día");
  assert.equal(b.enviados.length, 1);
});

test("si el mail rebota, el resultado lo dice y no aparenta que salió", async () => {
  await conAdministrador("dueno@example.com");
  await movimientoDeAgosto("oc1", "in1", 800_000n);
  const b = buzon({ ok: false, motivo: "rechazado", detalle: "casilla llena" });
  const r = await respaldoMensual({ operadorId: "op1", hoy: PRIMERO }, db, b.mandar);
  assert.ok(!("corrio" in r));
  assert.equal(r.enviado, false);
  assert.equal(r.motivo, "rechazado");
});
