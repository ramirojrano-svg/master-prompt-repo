// tests/integracion/google.test.ts — la puerta de "Entrar con Google".
//
// El riesgo de este login no es que falle: es que ADMITA de más. Con Google el usuario no elige
// contraseña ni nadie lo da de alta — se presenta con una cuenta y la app decide. Si esa decisión
// es "tiene un Gmail válido", entonces cualquiera del planeta entra a la agenda del centro.
//
// Lo que se fija acá: entra SOLO quien ya tiene acceso activo, dado por el administrador.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { accesoPorProveedor } from "../../src/lib/auth-core.ts";
import { accesosCon } from "../../src/servicios/config/accesos.ts";
import { prisma } from "../../src/db/prisma.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });

const OWNER = { usuarioId: "u1", operadorId: "op1", rol: "owner" as const, inquilinoId: null };
const { crear } = accesosCon(db);
const MAIL = "dra.perez@email.com";

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

/** Le da acceso a un profesional, que es la única forma de existir en el centro. */
const darDeAlta = () => crear(OWNER, { inquilinoId: "in1", email: MAIL, password: "una-clave-larga" });

test("quien ya tiene acceso entra con Google", async () => {
  await darDeAlta();
  assert.equal(await accesoPorProveedor(db, { email: MAIL, email_verified: true }), true);
});

test("EL PUNTO: una cuenta de Google desconocida NO entra", async () => {
  // Sin esto, tener un Gmail sería la credencial del centro.
  assert.equal(await accesoPorProveedor(db, { email: "cualquiera@gmail.com", email_verified: true }), false);
});

test("Google no da de alta: el rechazado no queda creado", async () => {
  await accesoPorProveedor(db, { email: "cualquiera@gmail.com", email_verified: true });
  assert.equal(await db.usuario.count(), 0, "no se crea nadie al rechazar");
});

test("un email sin verificar no entra, aunque sea el correcto", async () => {
  // El proveedor puede tener registrado un email que la persona no probó que sea suyo: aceptarlo
  // es dejar entrar a quien escribió el mail de otro en su propia cuenta.
  await darDeAlta();
  assert.equal(await accesoPorProveedor(db, { email: MAIL, email_verified: false }), false);
  assert.equal(await accesoPorProveedor(db, { email: MAIL }), false, "ausente se trata como sin verificar");
});

test("el acceso dado de baja deja de abrir", async () => {
  // Es el caso que importa el día que alguien se va del centro: se le desactiva el acceso y tiene
  // que quedar afuera también por Google, no solo por contraseña.
  await darDeAlta();
  await db.usuarioOperador.updateMany({ where: { inquilinoId: "in1" }, data: { activo: false } });
  assert.equal(await accesoPorProveedor(db, { email: MAIL, email_verified: true }), false);
});

test("un usuario sin acceso a ningún centro no entra", async () => {
  // Existe la fila de Usuario pero no la de acceso: es el estado en que queda alguien al que se le
  // borró el vínculo con el centro.
  await db.usuario.create({ data: { email: "suelto@email.com", nombre: "Suelto", passwordHash: null } });
  assert.equal(await accesoPorProveedor(db, { email: "suelto@email.com", email_verified: true }), false);
});

test("el email se normaliza igual que en el login con contraseña", async () => {
  // Google puede mandar el mail con mayúsculas; el alta lo guardó en minúsculas. Si no se
  // normaliza, la misma persona es dos personas distintas según por dónde entre.
  await darDeAlta();
  assert.equal(await accesoPorProveedor(db, { email: "  Dra.Perez@Email.com ", email_verified: true }), true);
});

test("un perfil sin email o con basura no entra", async () => {
  await darDeAlta();
  for (const perfil of [{ email_verified: true }, { email: "", email_verified: true }, { email: 42, email_verified: true }]) {
    assert.equal(await accesoPorProveedor(db, perfil), false, JSON.stringify(perfil));
  }
});
