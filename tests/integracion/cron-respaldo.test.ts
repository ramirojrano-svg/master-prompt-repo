// tests/integracion/cron-respaldo.test.ts — la puerta del respaldo automático.
//
// El trabajo lo prueba respaldo-mensual.test.ts. Acá se prueba la PUERTA, igual que en la de
// liquidaciones: que no se pueda empujar sin la llave, y que sin llave configurada se niegue a
// correr en vez de quedar abierta por omisión.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../../src/db/prisma.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });

// La ruta usa el cliente de siempre, que lee DATABASE_URL al construirse. Se apunta a la base de
// pruebas ANTES de importarla — por eso la importación es diferida.
process.env.DATABASE_URL = URL_DB;
const { GET } = await import("../../app/api/cron/respaldo/route.ts");

const SECRETO = "un-secreto-largo-de-prueba";
const pedido = (auth?: string, qs = "") =>
  new Request(`https://ejemplo/api/cron/respaldo${qs}`, { headers: auth ? { authorization: auth } : {} });

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Auditoria"');
  process.env.CRON_SECRET = SECRETO;
});
after(async () => {
  delete process.env.CRON_SECRET;
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

test("sin secreto configurado la ruta se NIEGA a correr", async () => {
  delete process.env.CRON_SECRET;
  assert.equal((await GET(pedido(`Bearer ${SECRETO}`))).status, 503);
});

test("sin cabecera de autorización responde 401", async () => {
  assert.equal((await GET(pedido())).status, 401);
});

test("con un secreto equivocado responde 401", async () => {
  assert.equal((await GET(pedido("Bearer otra-cosa"))).status, 401);
});

test("el valor pelado, sin 'Bearer', tampoco entra", async () => {
  assert.equal((await GET(pedido(SECRETO))).status, 401);
});

test("con el secreto correcto corre y contesta qué hizo", async () => {
  const r = await GET(pedido(`Bearer ${SECRETO}`));
  assert.equal(r.status, 200);
  const cuerpo = await r.json();
  assert.equal(cuerpo.ok, true);
  assert.ok(Array.isArray(cuerpo.centros));
});

test("la corrida queda registrada, para poder contestar si el respaldo llegó a dispararse", async () => {
  await GET(pedido(`Bearer ${SECRETO}`));
  const filas = await db.auditoria.findMany({ where: { usuarioId: "cron", permiso: "datos.exportar" } });
  assert.ok(filas.length >= 1);
});
