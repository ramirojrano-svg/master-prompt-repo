// tests/integracion/cron-liquidaciones.test.ts — la puerta de la tarea automática.
//
// Es una URL que, del otro lado, manda treinta y seis correos. Si queda abierta alcanza con
// adivinar su nombre para disparar los avisos del mes cuando a alguien se le ocurra.
//
// El servicio que hace el trabajo ya tiene sus once pruebas. Acá se prueba la PUERTA: que no se
// pueda empujar sin la llave, y que sin llave configurada se niegue a correr en vez de quedar
// abierta por omisión.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { purgarAuditoria } from "../../src/lib/auditoria.ts";
import { prisma } from "../../src/db/prisma.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });

// La ruta usa el cliente de siempre, que lee DATABASE_URL al construirse. Se apunta a la base de
// pruebas ANTES de importarla — por eso la importación es diferida y no está arriba con el resto.
process.env.DATABASE_URL = URL_DB;
const { GET } = await import("../../app/api/cron/liquidaciones/route.ts");

const SECRETO = "un-secreto-largo-de-prueba";
const pedido = (auth?: string) =>
  new Request("https://ejemplo/api/cron/liquidaciones", { headers: auth ? { authorization: auth } : {} });

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
  // Fail-closed. Abierta por omisión sería una URL que manda mails a treinta y seis personas y
  // solo hace falta saber su nombre.
  delete process.env.CRON_SECRET;
  const r = await GET(pedido(`Bearer ${SECRETO}`));
  assert.equal(r.status, 503);
});

test("sin cabecera de autorización responde 401", async () => {
  assert.equal((await GET(pedido())).status, 401);
});

test("con un secreto equivocado responde 401", async () => {
  assert.equal((await GET(pedido("Bearer otra-cosa"))).status, 401);
});

test("un secreto con el prefijo mal tampoco entra", async () => {
  // El valor pelado, sin "Bearer", es el error de configuración más común: tiene que fallar.
  assert.equal((await GET(pedido(SECRETO))).status, 401);
});

test("con el secreto correcto corre y contesta qué hizo", async () => {
  const r = await GET(pedido(`Bearer ${SECRETO}`));
  assert.equal(r.status, 200);
  const cuerpo = await r.json();
  assert.equal(cuerpo.ok, true);
  assert.ok(Array.isArray(cuerpo.centros));
});

test("la corrida queda registrada aunque no sea el día", async () => {
  // El día que alguien pregunte "¿por qué no salieron los avisos?", lo primero que hay que poder
  // contestar es si el cron llegó a correr.
  await GET(pedido(`Bearer ${SECRETO}`));
  const filas = await db.auditoria.findMany({ where: { usuarioId: "cron" } });
  assert.ok(filas.length >= 1, "sin registro, un cron que no corre es indistinguible de uno que sí");
});

// ── Retención ───────────────────────────────────────────────────────────────

test("la purga borra lo viejo y respeta lo reciente", async () => {
  const viejo = new Date("2024-01-01T12:00:00Z");
  const reciente = new Date();
  for (const [id, creadoEl] of [["a", viejo], ["b", reciente]] as const) {
    await pgPool.query(
      `INSERT INTO "Auditoria"("id","operadorId","usuarioId","rol","permiso","resultado","creadoEl")
       VALUES ($1,'op1','u1','owner','datos.exportar','ok',$2)`,
      [id, creadoEl],
    );
  }

  const borrados = await purgarAuditoria(db);
  assert.equal(borrados, 1);
  assert.ok(await db.auditoria.findUnique({ where: { id: "b" } }), "lo reciente no se toca");
  assert.equal(await db.auditoria.findUnique({ where: { id: "a" } }), null);
});
