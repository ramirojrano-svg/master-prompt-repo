// tests/integracion/alta-auth.test.ts — alta de operador (país->zona) y autorización.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { altaOperador } from "../../src/servicios/operador/alta.ts";
import { autorizar } from "../../src/lib/auth-core.ts";
import { prisma } from "../../src/db/prisma.ts";
import { nuevoPool, reiniciarEsquema, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });

function alta(over: Partial<Parameters<typeof altaOperador>[0]> = {}) {
  return altaOperador(
    { nombreOperador: "Centro Palermo", slug: "palermo", pais: "AR", nombreSede: "Central", email: "duenio@centro.test", nombreUsuario: "Dueño", password: "clave-fuerte-1", ...over },
    db,
  );
}

before(async () => {
  await reiniciarEsquema(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Operador","Usuario" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

test("alta crea operador + sede (zona derivada del país) + usuario dueño", async () => {
  const r = await alta();
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.zonaHoraria, "America/Argentina/Buenos_Aires");

  const sede = await db.sede.findFirstOrThrow({ where: { operadorId: r.operadorId }, select: { zonaHoraria: true } });
  assert.equal(sede.zonaHoraria, "America/Argentina/Buenos_Aires"); // estampada, no default de esquema

  const uo = await db.usuarioOperador.findFirstOrThrow({ where: { operadorId: r.operadorId }, select: { rol: true } });
  assert.equal(uo.rol, "owner");
});

test("el país deriva la zona correcta (MX => America/Mexico_City)", async () => {
  const r = await alta({ pais: "MX", slug: "mx1", email: "mx@centro.test" });
  assert.ok(r.ok && r.zonaHoraria === "America/Mexico_City");
});

test("país no soportado => PAIS_INVALIDO, sin crear nada", async () => {
  assert.deepEqual(await alta({ pais: "US" }), { ok: false, error: "PAIS_INVALIDO" });
  const n = await db.operador.count();
  assert.equal(n, 0);
});

test("slug repetido => SLUG_TOMADO", async () => {
  await alta();
  const r = await alta({ email: "otro@centro.test" });
  assert.deepEqual(r, { ok: false, error: "SLUG_TOMADO" });
});

test("email repetido => EMAIL_TOMADO", async () => {
  await alta();
  const r = await alta({ slug: "otro-slug" });
  assert.deepEqual(r, { ok: false, error: "EMAIL_TOMADO" });
});

test("autorizar: credenciales correctas devuelven el usuario; incorrectas => null", async () => {
  await alta();
  const ok = await autorizar(db, { email: "duenio@centro.test", password: "clave-fuerte-1" });
  assert.ok(ok && ok.email === "duenio@centro.test");

  assert.equal(await autorizar(db, { email: "duenio@centro.test", password: "mal" }), null);
  assert.equal(await autorizar(db, { email: "noexiste@centro.test", password: "clave-fuerte-1" }), null);
});

test("autorizar normaliza el email (mayúsculas/espacios)", async () => {
  await alta();
  const ok = await autorizar(db, { email: "  Duenio@Centro.Test ", password: "clave-fuerte-1" });
  assert.ok(ok, "el email se normaliza igual que en el alta");
});
