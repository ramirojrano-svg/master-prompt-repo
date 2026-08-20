// tests/integracion/auditoria.test.ts — el registro de quién hizo qué.
//
// Lo que se prueba acá no es que el registro exista, sino las dos cosas que lo hacen servir o lo
// vuelven peligroso:
//
//  · Que NO guarde secretos. Varias acciones reciben contraseñas, y un registro de auditoría que
//    las guarde es una filtración con fecha y hora. Este es EL test del archivo.
//  · Que registre también los RECHAZOS. Un intento sin permiso es justamente lo que se va a buscar
//    el día que algo no cierre; si solo quedaran los éxitos, el registro contaría media historia.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { accesosCon } from "../../src/servicios/config/accesos.ts";
import { cierreCon } from "../../src/servicios/plata/cierre.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });
const accesos = accesosCon(db);
const cierre = cierreCon(db);

const owner: Actor = { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null };
const profesional: Actor = { usuarioId: "u2", operadorId: "op1", rol: "inquilino_titular", inquilinoId: "in1" };

const CLAVE_SECRETA = "esta-clave-no-puede-quedar-registrada";

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool);
});
beforeEach(async () => {
  await pgPool.query('TRUNCATE "Auditoria" CASCADE');
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

// ── El test que importa ─────────────────────────────────────────────────────

test("NUNCA se registra una contraseña, ni siquiera cuando la acción la recibe", async () => {
  await accesos.crear(owner, { inquilinoId: "in1", email: "alguien@ejemplo.com", password: CLAVE_SECRETA });

  const filas = await db.auditoria.findMany({ where: { operadorId: "op1" } });
  assert.ok(filas.length > 0, "la acción tiene que haber quedado registrada");

  // Se revisa la fila ENTERA serializada, no solo el campo que uno esperaría: si mañana alguien
  // agrega una columna y le mete el input, este test lo caza igual.
  const todo = JSON.stringify(filas);
  assert.ok(!todo.includes(CLAVE_SECRETA), "la contraseña no puede estar en ninguna parte del registro");
  // Y el email sí: es lo que hace falta para saber a quién se le dio acceso.
  assert.ok(todo.includes("alguien@ejemplo.com"), "el resumen sí guarda a quién se le dio el acceso");
});

// ── Qué queda registrado ────────────────────────────────────────────────────

test("una acción que sale bien deja resultado 'ok', con quién y con qué permiso", async () => {
  await accesos.crear(owner, { inquilinoId: "in2", email: "otro@ejemplo.com", password: CLAVE_SECRETA });

  const fila = await db.auditoria.findFirstOrThrow({ where: { operadorId: "op1" }, orderBy: { creadoEl: "desc" } });
  assert.equal(fila.usuarioId, "u1");
  assert.equal(fila.rol, "owner");
  assert.equal(fila.permiso, "usuarios.administrar");
  assert.equal(fila.resultado, "ok");
});

test("un intento SIN PERMISO también se registra: es lo que más interesa ver", async () => {
  const r = await cierre.uno(profesional, { periodo: "2026-08", inquilinoId: "in1", venceEl: "2026-09-10" });
  assert.deepEqual(r, { ok: false, error: "SIN_PERMISO" });

  const fila = await db.auditoria.findFirstOrThrow({ where: { operadorId: "op1" }, orderBy: { creadoEl: "desc" } });
  assert.equal(fila.usuarioId, "u2");
  assert.equal(fila.rol, "inquilino_titular");
  assert.equal(fila.permiso, "periodo.cerrar");
  assert.equal(fila.resultado, "SIN_PERMISO");
  assert.equal(fila.resumen, null, "de un rechazo no se guarda detalle: el input no llegó a validarse");
});

test("un rechazo de NEGOCIO queda con su código, no como un 'ok' genérico", async () => {
  // Sin cargos que liquidar: el servicio contesta NADA_QUE_LIQUIDAR.
  const r = await cierre.uno(owner, { periodo: "2026-08", inquilinoId: "in1", venceEl: "2026-09-10" });
  assert.ok(r.ok);

  const fila = await db.auditoria.findFirstOrThrow({ where: { operadorId: "op1" }, orderBy: { creadoEl: "desc" } });
  assert.equal(fila.resultado, "NADA_QUE_LIQUIDAR", "se distingue 'se hizo' de 'se intentó'");
});

test("una entrada inválida se registra sin resumen: no hay input confiable del que sacarlo", async () => {
  await accesos.crear(owner, { inquilinoId: "", email: "no-es-un-email", password: "x" });

  const fila = await db.auditoria.findFirstOrThrow({ where: { operadorId: "op1" }, orderBy: { creadoEl: "desc" } });
  assert.equal(fila.resultado, "ENTRADA_INVALIDA");
  assert.equal(fila.resumen, null);
});

// ── Aislamiento ─────────────────────────────────────────────────────────────

test("el registro queda en el centro del actor y no se mezcla con otro", async () => {
  await pgPool.query(`INSERT INTO "Operador"("id","nombre","slug") VALUES('opY','Otro','otro-y')`);
  await accesos.crear(owner, { inquilinoId: "in1", email: "x@ejemplo.com", password: CLAVE_SECRETA });

  assert.equal(await db.auditoria.count({ where: { operadorId: "op1" } }), 1);
  assert.equal(await db.auditoria.count({ where: { operadorId: "opY" } }), 0);
  await pgPool.query(`DELETE FROM "Operador" WHERE "id"='opY'`);
});
