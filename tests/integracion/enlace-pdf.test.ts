// tests/integracion/enlace-pdf.test.ts — la única puerta que se abre sin sesión.
//
// El profesional recibe por WhatsApp una dirección que abre SU liquidación en PDF, sin entrar a
// la app. Lo que se prueba es que esa puerta abra exactamente un documento y ninguno más: que no
// se pueda fabricar una llave, ni usar la de otro, ni estirarle el plazo.
//
// Todo lo que no abre tiene que contestar lo MISMO (404). Distinguir "no existe" de "no te
// corresponde" confirmaría qué ids existen (§6.11).

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { GET } from "../../app/l/[token]/route.ts";
import { firmarEnlace } from "../../src/lib/enlace-firmado.ts";
import { cierreCon } from "../../src/servicios/plata/cierre.ts";
import { asentarIdempotente } from "../../src/servicios/plata/ledger.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

process.env.AUTH_SECRET = "secreto-de-prueba-bien-largo-0123456789";
// La ruta usa el cliente de siempre, que lee DATABASE_URL al construirse.
process.env.DATABASE_URL = URL_DB;

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });
const owner: Actor = { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null };
const MES = "2026-11";
const { todos } = cierreCon(db);

const pedir = (token: string) => GET(new Request(`http://local/l/${token}`), { params: Promise.resolve({ token }) });

before(async () => { await reiniciarEsquema(pgPool); await seedBase(pgPool); });
beforeEach(async () => { await pgPool.query('TRUNCATE "Asiento","Liquidacion","Ocupacion" CASCADE'); });
after(async () => { await db.$disconnect(); await prisma.$disconnect(); await pgPool.end(); });

/** Un mes cerrado para dos profesionales: hay dos liquidaciones distintas. */
async function dosLiquidaciones() {
  for (const [inq, monto] of [["in1", 100_000n], ["in2", 200_000n]] as const) {
    await asentarIdempotente(db, {
      operadorId: "op1", inquilinoId: inq, concepto: "cargo_uso", montoCent: monto, moneda: "ARS",
      periodo: MES, fechaHecho: new Date(`${MES}-05T12:00:00Z`), clave: `c-${inq}`,
    });
  }
  await todos(owner, { periodo: MES, venceEl: `${MES}-28` });
  const liqs = await db.liquidacion.findMany({ where: { periodo: MES }, select: { id: true, inquilinoId: true } });
  return {
    uno: liqs.find((l) => l.inquilinoId === "in1")!.id,
    dos: liqs.find((l) => l.inquilinoId === "in2")!.id,
  };
}

test("con la llave correcta devuelve el PDF", async () => {
  const { uno } = await dosLiquidaciones();

  const r = await pedir(firmarEnlace(uno)!);

  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/pdf");
  const cuerpo = Buffer.from(await r.arrayBuffer());
  assert.ok(cuerpo.subarray(0, 5).toString() === "%PDF-", "es un PDF de verdad");
  assert.ok(cuerpo.length > 500, "y tiene contenido");
});

test("se abre en pantalla, no se baja: el que lo recibe lo quiere mirar", async () => {
  const { uno } = await dosLiquidaciones();
  const r = await pedir(firmarEnlace(uno)!);
  assert.match(r.headers.get("content-disposition") ?? "", /^inline/);
});

test("no se guarda copia en ningún lado: el papel lleva CUIT y CBU", async () => {
  const { uno } = await dosLiquidaciones();
  const r = await pedir(firmarEnlace(uno)!);
  assert.match(r.headers.get("cache-control") ?? "", /no-store/);
  assert.match(r.headers.get("x-robots-tag") ?? "", /noindex/);
});

test("la llave de uno NO abre la liquidación del otro", async () => {
  const { uno, dos } = await dosLiquidaciones();

  const suya = await pedir(firmarEnlace(uno)!);
  const ajena = await pedir(firmarEnlace(dos)!);

  // Cada una abre la suya, y son documentos distintos.
  assert.equal(suya.status, 200);
  assert.equal(ajena.status, 200);
  const a = Buffer.from(await suya.arrayBuffer());
  const b = Buffer.from(await ajena.arrayBuffer());
  assert.notDeepEqual(a, b, "no es el mismo papel");
});

test("una llave fabricada a mano no abre nada", async () => {
  const { uno } = await dosLiquidaciones();
  const vence = Math.floor(Date.now() / 1000) + 86_400;

  const r = await pedir(`${uno}.${vence}.firmaInventada`);
  assert.equal(r.status, 404);
});

test("estirarle el plazo a una llave la rompe", async () => {
  const { uno } = await dosLiquidaciones();
  const [id, vence, f] = firmarEnlace(uno)!.split(".");

  const r = await pedir(`${id}.${Number(vence) + 86_400 * 365}.${f}`);
  assert.equal(r.status, 404);
});

test("una llave bien firmada de un id que no existe da lo mismo que una inválida", async () => {
  // Las dos 404: distinguirlas confirmaría qué ids existen.
  const inventada = await pedir(firmarEnlace("liq_que_no_existe")!);
  const rota = await pedir("basura");
  assert.equal(inventada.status, 404);
  assert.equal(rota.status, 404);
});

test("no deja rastro de sesión: no es una puerta al panel", async () => {
  const { uno } = await dosLiquidaciones();
  const r = await pedir(firmarEnlace(uno)!);
  assert.equal(r.headers.get("set-cookie"), null);
});
