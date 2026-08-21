// tests/integracion/freno.test.ts — el freno de la fuerza bruta.
//
// El login y el pedido de recuperación son las dos únicas puertas abiertas a internet sin sesión.
// Lo que se prueba acá es que el freno agarre al que insiste Y que suelte al que se equivocó:
// un freno que no suelta deja afuera a la persona real, que es el daño que se estaba evitando.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { anotarFallo, esperaDe, FALLOS_LIBRES, limpiarFallos, OLVIDO_MIN, puedeIntentar } from "../../src/lib/freno.ts";
import { autorizar } from "../../src/lib/auth-core.ts";
import { hashPassword } from "../../src/lib/password.ts";
import { prisma } from "../../src/db/prisma.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });

const AHORA = new Date("2026-08-21T12:00:00Z");
const luego = (min: number) => new Date(AHORA.getTime() + min * 60_000);

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "IntentoFallido"');
  await pgPool.query('DELETE FROM "Usuario"');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

// ── La cuenta ───────────────────────────────────────────────────────────────

test("los primeros fallos no frenan a nadie", async () => {
  // Equivocarse un par de veces es normal. Frenar ahí molestaría a la persona real sin detener a
  // nadie: quien ataca no manda cinco intentos, manda cinco mil.
  for (let i = 0; i < FALLOS_LIBRES; i++) await anotarFallo("login:ana@x.com", db, AHORA);
  assert.deepEqual(await puedeIntentar("login:ana@x.com", db, AHORA), { pasa: true });
});

test("pasado el margen, frena", async () => {
  for (let i = 0; i < FALLOS_LIBRES + 1; i++) await anotarFallo("login:ana@x.com", db, AHORA);
  const v = await puedeIntentar("login:ana@x.com", db, AHORA);
  assert.equal(v.pasa, false);
  assert.ok(v.pasa === false && v.segundos > 0);
});

test("la espera crece con cada intento y tiene techo", async () => {
  // 1, 2, 4, 8… hasta media hora. Un error de tipeo cuesta un minuto; insistir cuesta días.
  assert.equal(esperaDe(FALLOS_LIBRES), 0);
  assert.equal(esperaDe(FALLOS_LIBRES + 1), 1);
  assert.equal(esperaDe(FALLOS_LIBRES + 2), 2);
  assert.equal(esperaDe(FALLOS_LIBRES + 3), 4);
  assert.equal(esperaDe(FALLOS_LIBRES + 20), 30, "el techo evita dejar a alguien afuera para siempre");
});

test("cumplida la espera, vuelve a pasar", async () => {
  for (let i = 0; i < FALLOS_LIBRES + 1; i++) await anotarFallo("login:ana@x.com", db, AHORA);
  assert.equal((await puedeIntentar("login:ana@x.com", db, AHORA)).pasa, false);
  assert.equal((await puedeIntentar("login:ana@x.com", db, luego(2))).pasa, true);
});

test("los fallos viejos se olvidan en vez de acumularse", async () => {
  // Alguien que se equivoca una vez por mes no puede terminar bloqueado el día que se equivoca
  // por sexta vez en un año.
  for (let i = 0; i < FALLOS_LIBRES; i++) await anotarFallo("login:ana@x.com", db, AHORA);
  await anotarFallo("login:ana@x.com", db, luego(OLVIDO_MIN + 1));
  const fila = await db.intentoFallido.findUniqueOrThrow({ where: { clave: "login:ana@x.com" } });
  assert.equal(fila.fallos, 1, "la cuenta arranca de cero");
  assert.equal(fila.bloqueadoHasta, null);
});

test("acertar borra la cuenta", async () => {
  // Sin esto, quien falla cuatro veces y acierta a la quinta arrastra los cuatro y el próximo
  // error lo bloquea sin motivo.
  for (let i = 0; i < FALLOS_LIBRES; i++) await anotarFallo("login:ana@x.com", db, AHORA);
  await limpiarFallos("login:ana@x.com", db);
  assert.equal(await db.intentoFallido.findUnique({ where: { clave: "login:ana@x.com" } }), null);
});

test("cada clave cuenta por separado", async () => {
  // Frenar a uno no puede dejar afuera a los otros treinta y cinco.
  for (let i = 0; i < FALLOS_LIBRES + 1; i++) await anotarFallo("login:ana@x.com", db, AHORA);
  assert.equal((await puedeIntentar("login:ana@x.com", db, AHORA)).pasa, false);
  assert.equal((await puedeIntentar("login:beto@x.com", db, AHORA)).pasa, true);
});

// ── En el login de verdad ───────────────────────────────────────────────────

async function unUsuario(email: string, clave: string) {
  await db.usuario.create({ data: { email, nombre: "Ana", passwordHash: await hashPassword(clave) } });
}

test("el login frena tras insistir, y con la clave correcta", async () => {
  await unUsuario("ana@x.com", "clave-correcta-8");

  for (let i = 0; i < FALLOS_LIBRES + 1; i++) {
    assert.equal(await autorizar(db, { email: "ana@x.com", password: "mala" }), null);
  }
  // Este es EL test: acertar la clave después de insistir no tiene que servir de nada.
  assert.equal(await autorizar(db, { email: "ana@x.com", password: "clave-correcta-8" }), null);
});

test("un login exitoso limpia lo anterior", async () => {
  await unUsuario("ana@x.com", "clave-correcta-8");
  for (let i = 0; i < FALLOS_LIBRES - 1; i++) await autorizar(db, { email: "ana@x.com", password: "mala" });

  assert.ok(await autorizar(db, { email: "ana@x.com", password: "clave-correcta-8" }));
  assert.equal(await db.intentoFallido.findUnique({ where: { clave: "login:ana@x.com" } }), null);
});

test("un email desconocido también cuenta: si no, el freno se esquiva solo", async () => {
  await autorizar(db, { email: "nadie@x.com", password: "x" });
  const fila = await db.intentoFallido.findUniqueOrThrow({ where: { clave: "login:nadie@x.com" } });
  assert.equal(fila.fallos, 1);
});

test("el email se normaliza: MAYÚSCULAS y espacios no dan una cuenta nueva", async () => {
  // Si no, probar "Ana@X.com" esquivaría el freno puesto sobre "ana@x.com".
  await autorizar(db, { email: "ana@x.com", password: "x" });
  await autorizar(db, { email: "  ANA@X.COM  ", password: "x" });
  const fila = await db.intentoFallido.findUniqueOrThrow({ where: { clave: "login:ana@x.com" } });
  assert.equal(fila.fallos, 2);
});

test("un email desconocido tarda lo mismo que uno conocido", async () => {
  // El oráculo de tiempo: sin el hash de descarte, la respuesta para una dirección que no existe
  // vuelve enseguida y el reloj dice cuáles son del centro.
  await unUsuario("ana@x.com", "clave-correcta-8");

  const cronometrar = async (email: string) => {
    const t0 = performance.now();
    await autorizar(db, { email, password: "una-clave-cualquiera" });
    return performance.now() - t0;
  };
  // Una vuelta en vacío para no medir el arranque del proceso.
  await cronometrar("ana@x.com");

  const conocido = await cronometrar("ana@x.com");
  await pgPool.query('TRUNCATE "IntentoFallido"');
  const desconocido = await cronometrar("nadie@x.com");

  // El desconocido no puede volver mucho más rápido. Margen amplio porque la máquina de pruebas
  // es ruidosa; lo que se descarta es el orden de magnitud, que era lo que filtraba.
  assert.ok(desconocido > conocido * 0.5, `conocido ${conocido.toFixed(0)}ms vs desconocido ${desconocido.toFixed(0)}ms`);
});
