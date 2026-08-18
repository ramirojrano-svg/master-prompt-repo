// tests/integracion/accesos.test.ts — darle acceso a un profesional y resetearle la clave.
//
// Lo que se protege: que restablecer MATE las sesiones abiertas (si no, resetearle la contraseña a
// alguien que se fue no lo saca: sigue adentro con la cookie que ya tenía), que un email que ya
// trabaja en el centro no termine atado a dos fichas, y que la clave nueva ENTRE de verdad —
// probada con la misma función que corre el login, no mirando que el hash cambió.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { accesoDeInquilino, accesosCon } from "../../src/servicios/config/accesos.ts";
import { autorizar } from "../../src/lib/auth-core.ts";
import { hashPassword } from "../../src/lib/password.ts";
import { prisma } from "../../src/db/prisma.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: `${URL_DB}?connection_limit=20&pool_timeout=20` });

const OWNER = { usuarioId: "u1", operadorId: "op1", rol: "owner" as const, inquilinoId: null };
const { crear, restablecer } = accesosCon(db);

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "UsuarioOperador", "Usuario" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

const CLAVE = "una-clave-larga";

test("crear el acceso deja al profesional pudiendo entrar", async () => {
  const r = await crear(OWNER, { inquilinoId: "in1", email: "Dra.Perez@Email.com ", password: CLAVE });
  assert.ok(r.ok && r.data.ok, "debería crearse");
  // El email se normaliza: nadie escribe su mail dos veces igual.
  assert.equal(r.data.ok && r.data.email, "dra.perez@email.com");

  // Lo que importa no es que exista la fila: es que ENTRE. Se prueba por el camino del login.
  const u = await autorizar(db, { email: "dra.perez@email.com", password: CLAVE });
  assert.ok(u, "la clave nueva tiene que abrir");

  const acceso = await accesoDeInquilino({ operadorId: "op1", inquilinoId: "in1" }, db);
  assert.deepEqual(acceso, { email: "dra.perez@email.com", activo: true });
});

test("el acceso queda atado a SU ficha, no suelto en el centro", async () => {
  await crear(OWNER, { inquilinoId: "in1", email: "a@e.com", password: CLAVE });
  const uo = await db.usuarioOperador.findFirstOrThrow({ select: { rol: true, inquilinoId: true, activo: true } });
  assert.equal(uo.rol, "inquilino_titular");
  assert.equal(uo.inquilinoId, "in1");
  assert.equal(uo.activo, true);
});

test("no se crea dos veces para el mismo profesional", async () => {
  await crear(OWNER, { inquilinoId: "in1", email: "a@e.com", password: CLAVE });
  const r = await crear(OWNER, { inquilinoId: "in1", email: "otro@e.com", password: CLAVE });
  assert.ok(r.ok && !r.data.ok && r.data.error === "YA_TIENE_ACCESO");
  assert.equal(await db.usuarioOperador.count(), 1);
});

test("un email que ya trabaja en el centro no puede atarse a otra ficha", async () => {
  // Serían dos profesionales entrando con el mismo login: al resolver el actor, uno de los dos
  // gana y el otro queda invisible.
  await crear(OWNER, { inquilinoId: "in1", email: "a@e.com", password: CLAVE });
  const r = await crear(OWNER, { inquilinoId: "in2", email: "a@e.com", password: CLAVE });
  assert.ok(r.ok && !r.data.ok && r.data.error === "EMAIL_DE_OTRO");
  assert.equal(await db.usuarioOperador.count(), 1);
});

test("restablecer cambia la clave: la vieja deja de abrir y la nueva abre", async () => {
  await crear(OWNER, { inquilinoId: "in1", email: "a@e.com", password: CLAVE });

  const r = await restablecer(OWNER, { inquilinoId: "in1", password: "otra-clave-larga" });
  assert.ok(r.ok && r.data.ok);

  assert.equal(await autorizar(db, { email: "a@e.com", password: CLAVE }), null, "la vieja no abre más");
  assert.ok(await autorizar(db, { email: "a@e.com", password: "otra-clave-larga" }), "la nueva sí");
});

test("EL PUNTO: restablecer INVALIDA las sesiones abiertas", async () => {
  // Sin esto, resetear la clave de alguien que se fue del centro no lo saca: sigue adentro con la
  // cookie que ya tenía. `sessionVersion` sube y el callback de Auth.js descarta ese token (§9).
  await crear(OWNER, { inquilinoId: "in1", email: "a@e.com", password: CLAVE });
  const antes = await db.usuario.findFirstOrThrow({ where: { email: "a@e.com" }, select: { sessionVersion: true } });

  await restablecer(OWNER, { inquilinoId: "in1", password: "otra-clave-larga" });

  const despues = await db.usuario.findFirstOrThrow({ where: { email: "a@e.com" }, select: { sessionVersion: true } });
  assert.equal(despues.sessionVersion, antes.sessionVersion + 1, "la versión de sesión tiene que subir");
});

test("restablecer a alguien sin acceso lo dice, no falla raro", async () => {
  const r = await restablecer(OWNER, { inquilinoId: "in2", password: "otra-clave-larga" });
  assert.ok(r.ok && !r.data.ok && r.data.error === "SIN_ACCESO");
});

test("restablecer NO toca una identidad que también vive en otro centro", async () => {
  // El agujero que cierra este test: `Usuario` es una identidad GLOBAL, y restablecer escribía
  // sobre ella sin mirar dónde más vivía. Con el alta de centros abierta, cualquiera podía darse
  // de alta un centro propio, enganchar el email de una persona de otro centro como profesional
  // suyo —el chequeo de EMAIL_DE_OTRO solo mira adentro del centro propio— y después
  // "restablecerle" la clave, quedándose con su cuenta ALLÁ.
  await pgPool.query(`INSERT INTO "Operador"("id","nombre","slug") VALUES('op2','Otro','otro') ON CONFLICT DO NOTHING`);
  const suya = "la-clave-de-la-victima";
  await pgPool.query(`INSERT INTO "Usuario"("id","email","nombre","passwordHash") VALUES('uv','victima@e.com','Victima',$1)`, [
    await hashPassword(suya),
  ]);
  await pgPool.query(`INSERT INTO "UsuarioOperador"("usuarioId","operadorId","rol","activo") VALUES('uv','op2','owner',true)`);

  // Engancharla como profesional del centro propio SIGUE siendo válido: una persona puede alquilar
  // en dos centros con una sola identidad. Lo que no pasa es que le pisen la contraseña.
  const c = await crear(OWNER, { inquilinoId: "in1", email: "victima@e.com", password: "otra-clave-larga" });
  assert.ok(c.ok && c.data.ok, "enganchar una identidad existente sigue permitido");
  assert.ok(await autorizar(db, { email: "victima@e.com", password: suya }), "crear no le toca la clave");

  const r = await restablecer(OWNER, { inquilinoId: "in1", password: "la-del-atacante" });
  assert.ok(r.ok && !r.data.ok && r.data.error === "CUENTA_COMPARTIDA", "restablecer tiene que negarse");

  // Lo que de verdad importa: la víctima sigue entrando con LO SUYO, y el atacante no entra.
  assert.ok(await autorizar(db, { email: "victima@e.com", password: suya }), "la clave de la víctima sigue abriendo");
  assert.ok(!(await autorizar(db, { email: "victima@e.com", password: "la-del-atacante" })), "la del atacante no abre");
});

test("un profesional de otro centro no existe acá", async () => {
  const r = await crear(OWNER, { inquilinoId: "no-existe", email: "a@e.com", password: CLAVE });
  assert.ok(r.ok && !r.data.ok && r.data.error === "INQUILINO_INEXISTENTE");
});

test("una clave corta se rechaza antes de tocar la base", async () => {
  const r = await crear(OWNER, { inquilinoId: "in1", email: "a@e.com", password: "corta" });
  assert.ok(!r.ok, "tiene que rebotar en el esquema");
  assert.equal(await db.usuarioOperador.count(), 0);
});

test("un profesional no puede darse acceso ni resetear claves", async () => {
  // Es la puerta de entrada al centro: si el que alquila puede abrirla, no es una puerta.
  const inquilino = { usuarioId: "u9", operadorId: "op1", rol: "inquilino_titular" as const, inquilinoId: "in1" };
  assert.ok(!(await crear(inquilino, { inquilinoId: "in2", email: "x@e.com", password: CLAVE })).ok);
  assert.ok(!(await restablecer(inquilino, { inquilinoId: "in1", password: CLAVE })).ok);
});
