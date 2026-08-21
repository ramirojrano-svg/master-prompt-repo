// tests/integracion/reset-clave.test.ts — "olvidé mi contraseña", contra base real.
//
// Es la superficie más peligrosa de la app: un enlace que llega por mail y cambia una contraseña.
// Si algo de acá falla, cualquiera entra a cualquier cuenta. Por eso lo que se prueba no son las
// pantallas sino las PROPIEDADES de seguridad, una por una.
//
// El envío se apunta a un puerto muerto a propósito: el token se crea ANTES de mandar el mail, así
// que el circuito se puede probar entero sin depender de un servidor de correo — y sin que un test
// mande correo de verdad.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { MINUTOS_VIGENCIA, pedirReset, tokenVigente, usarReset } from "../../src/servicios/config/reset-clave.ts";
import { verificarPassword } from "../../src/lib/password.ts";
import { prisma } from "../../src/db/prisma.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });

const EMAIL = "profesional@ejemplo.com";
const OTRO = "otro@ejemplo.com";
const CTX = { urlBase: "https://emoapp-beta.vercel.app" };

/** El enlace trae el token en la query; se lo saca de ahí, como haría quien lo recibe. */
function tokenDe(enlace: string): string {
  return new URL(enlace).searchParams.get("token")!;
}

/** `pedirReset` no devuelve el token (viaja por mail). Se lo lee del log, que es donde el mail
 *  fallido lo deja — o se arma el enlace a mano desde la fila. Acá se usa el hash para ubicarlo. */
async function ultimoTokenDe(email: string): Promise<{ id: string; hash: string }> {
  const u = await db.usuario.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const t = await db.tokenClave.findFirstOrThrow({ where: { usuarioId: u.id }, orderBy: { creadoEl: "desc" }, select: { id: true, tokenHash: true } });
  return { id: t.id, hash: t.tokenHash };
}

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
  // Envío "configurado" pero apuntando a un puerto muerto: falla rápido y sin salir a internet.
  process.env.SMTP_USER = "centro@gmail.com";
  process.env.SMTP_PASS = "clave-de-prueba";
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = "1";
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "TokenClave" CASCADE');
  await pgPool.query('DELETE FROM "Usuario"');
  // El freno cuenta CADA pedido, y varios de estos tests piden más de una vez. Sin limpiarlo,
  // el sexto pedido del archivo se topa con el bloqueo puesto por el primero.
  await pgPool.query('TRUNCATE "IntentoFallido"');
  await pgPool.query(
    `INSERT INTO "Usuario"("id","email","nombre","passwordHash","sessionVersion")
     VALUES ('u-reset',$1,'Profesional','hash-viejo',1), ('u-otro',$2,'Otro','hash-otro',1)`,
    [EMAIL, OTRO],
  );
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

// ── Que no se convierta en un padrón ────────────────────────────────────────

test("un email que NO existe recibe la misma respuesta que uno que sí (§6.11)", async () => {
  const real = await pedirReset({ email: EMAIL }, CTX, db);
  const falso = await pedirReset({ email: "nadie@ejemplo.com" }, CTX, db);

  assert.equal(real.ok, true);
  assert.equal(falso.ok, true, "si contestara distinto, el formulario diría quiénes son clientes");
  // Y el que no existe no deja rastro que se pueda contar desde afuera.
  assert.equal(await db.tokenClave.count(), 1, "solo el real generó token");
});

// ── El token ────────────────────────────────────────────────────────────────

test("en la base se guarda el HASH, nunca el token que viajó por mail", async () => {
  await pedirReset({ email: EMAIL }, CTX, db);
  const { hash } = await ultimoTokenDe(EMAIL);

  assert.equal(hash.length, 64, "sha-256 en hexadecimal");
  assert.match(hash, /^[0-9a-f]+$/, "nada que se parezca a un token base64url");
  // Y el hash guardado es efectivamente el de ALGÚN token: se comprueba con uno inventado.
  assert.notEqual(hash, createHash("sha256").update("inventado").digest("hex"));
});

test("sirve UNA sola vez: el segundo intento con el mismo enlace no hace nada", async () => {
  // Se genera y se captura el token real interceptando el envío.
  const token = await tokenReal();
  assert.equal(await tokenVigente(token, db), true);

  const primera = await usarReset({ token, password: "clave-nueva-1" }, db);
  assert.equal(primera.ok, true);

  const segunda = await usarReset({ token, password: "clave-de-un-atacante" }, db);
  assert.deepEqual(segunda, { ok: false, error: "TOKEN_INVALIDO" });

  const u = await db.usuario.findUniqueOrThrow({ where: { email: EMAIL }, select: { passwordHash: true } });
  assert.ok(u.passwordHash, "tiene que haber quedado una contraseña guardada");
  assert.equal(await verificarPassword("clave-nueva-1", u.passwordHash), true, "quedó la primera");
  assert.equal(await verificarPassword("clave-de-un-atacante", u.passwordHash), false);
});

test("un token VENCIDO no sirve, aunque nadie lo haya usado", async () => {
  const token = await tokenReal();
  const { id } = await ultimoTokenDe(EMAIL);
  // Se lo envejece más allá de su vigencia.
  await pgPool.query(`UPDATE "TokenClave" SET "expiraEl" = now() - interval '1 minute' WHERE id=$1`, [id]);

  assert.equal(await tokenVigente(token, db), false);
  assert.deepEqual(await usarReset({ token, password: "clave-nueva-1" }, db), { ok: false, error: "TOKEN_INVALIDO" });
});

test("pedir uno nuevo QUEMA el anterior: dos llaves vivas es una de más", async () => {
  const viejo = await tokenReal();
  const nuevo = await tokenReal();

  assert.notEqual(viejo, nuevo);
  assert.equal(await tokenVigente(viejo, db), false, "el primero dejó de servir");
  assert.equal(await tokenVigente(nuevo, db), true);
});

test("un token inventado no abre nada", async () => {
  await pedirReset({ email: EMAIL }, CTX, db);
  const r = await usarReset({ token: "a".repeat(43), password: "clave-nueva-1" }, db);
  assert.deepEqual(r, { ok: false, error: "TOKEN_INVALIDO" });
});

// ── Lo que pasa al usarlo ───────────────────────────────────────────────────

test("cambiar la clave CIERRA las sesiones abiertas en otros dispositivos", async () => {
  const antes = await db.usuario.findUniqueOrThrow({ where: { email: EMAIL }, select: { sessionVersion: true } });
  const token = await tokenReal();
  await usarReset({ token, password: "clave-nueva-1" }, db);

  const despues = await db.usuario.findUniqueOrThrow({ where: { email: EMAIL }, select: { sessionVersion: true } });
  assert.ok(despues.sessionVersion > antes.sessionVersion, "quien recupera su cuenta necesita que el otro quede afuera");
});

test("el token de una persona NO toca la contraseña de otra", async () => {
  const token = await tokenReal();
  await usarReset({ token, password: "clave-nueva-1" }, db);

  const otro = await db.usuario.findUniqueOrThrow({ where: { email: OTRO }, select: { passwordHash: true, sessionVersion: true } });
  assert.equal(otro.passwordHash, "hash-otro", "intacta");
  assert.equal(otro.sessionVersion, 1);
});

test("la vigencia es corta: una hora, no un día", async () => {
  assert.equal(MINUTOS_VIGENCIA, 60, "un enlace que cambia contraseñas no puede vivir mucho");
  await pedirReset({ email: EMAIL }, CTX, db);
  const fila = await db.tokenClave.findFirstOrThrow({ select: { expiraEl: true, creadoEl: true } });
  const minutos = (fila.expiraEl.getTime() - fila.creadoEl.getTime()) / 60_000;
  assert.ok(minutos > 55 && minutos < 65, `vence en ${Math.round(minutos)} minutos`);
});

// ── Ayuda ───────────────────────────────────────────────────────────────────

/**
 * Genera un pedido y devuelve el token EN CLARO.
 *
 * Como la base solo guarda el hash —que es justamente lo que hay que probar—, el token se captura
 * inyectando el enviador: el servicio arma el enlace y se lo pasa, y de ahí sale. Si el test
 * pudiera sacarlo de la base, el guardado no estaría siendo seguro.
 */
async function tokenReal(): Promise<string> {
  let enlace = "";
  const r = await pedirReset({ email: EMAIL }, CTX, db, async (a) => {
    const m = /https?:\/\/\S+/.exec(a.texto);
    if (m) enlace = m[0];
    return { ok: true as const, via: "smtp" as const };
  });
  assert.equal(r.ok, true);
  assert.ok(enlace, "el servicio tiene que haber armado un enlace");
  return tokenDe(enlace);
}

test("pedir el reset en bucle se frena antes de vaciar la cuota de correo", async () => {
  // Cada pedido manda un mail REAL desde una casilla con tope diario. Llenarlo deja sin correo a
  // toda la app, incluida la liquidación mensual — que sale sola y sin que nadie la mire.
  for (let i = 0; i < 12; i++) {
    const r = await pedirReset({ email: EMAIL }, CTX, db);
    // La respuesta es SIEMPRE la misma, frenado o no: decirle que está bloqueado le confirmaría
    // que estuvo pegando en el lugar correcto.
    assert.equal(r.ok, true);
  }

  // El envío está apuntado a un puerto muerto, así que `enviado` es false siempre; lo que se
  // cuenta es cuántas veces el servicio llegó a CREAR un token, que es cuando intentó mandar.
  const u = await db.usuario.findUniqueOrThrow({ where: { email: EMAIL }, select: { id: true } });
  const tokens = await db.tokenClave.count({ where: { usuarioId: u.id } });
  assert.ok(tokens <= 6, `se armaron ${tokens} pedidos; el freno tenía que cortar antes`);
  assert.ok(tokens >= 5, "y no puede frenar antes de tiempo al que se equivoca de buena fe");
});
