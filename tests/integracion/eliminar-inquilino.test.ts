// tests/integracion/eliminar-inquilino.test.ts — el único borrado sin vuelta atrás.
//
// Todo lo demás en esta app archiva. Esto destruye, así que lo que hay que probar no es que
// funcione —eso es lo fácil— sino que NO funcione cuando no tiene que funcionar, y que cuando
// funciona no deje nada colgando. Las ocho tablas que apuntan a una ficha tienen FK NoAction: un
// resto olvidado no es un dato viejo, es una transacción que aborta o una fila huérfana.

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { eliminarInquilinoCon, queArrastra } from "../../src/servicios/config/eliminar-inquilino.ts";
import { cerrarPeriodo } from "../../src/servicios/plata/liquidacion.ts";
import { asentarIdempotente } from "../../src/servicios/plata/ledger.ts";
import { prisma } from "../../src/db/prisma.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { insertarOcupacion, nuevoPool, reiniciarEsquema, seedBase, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });
const eliminar = eliminarInquilinoCon(db);

const owner: Actor = { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null };
const profesional: Actor = { usuarioId: "u2", operadorId: "op1", rol: "inquilino_titular", inquilinoId: "in1" };
const PERIODO = "2026-08";

/** Deja a `in2` de baja y con todo lo que puede arrastrar una ficha duplicada. */
async function conTodoEncima() {
  await pgPool.query(`UPDATE "Inquilino" SET "estado" = 'baja' WHERE id = 'in2'`);
  await insertarOcupacion(pgPool, { id: "oc1", salaId: "sa1", inquilinoId: "in2", inicio: "2026-08-12T13:00:00Z", fin: "2026-08-12T14:00:00Z" });
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId: "in2", concepto: "cargo_uso", montoCent: 28_800_000n,
    moneda: "ARS", periodo: PERIODO, fechaHecho: new Date("2026-08-12T12:00:00Z"), clave: "c:1",
  });
  await pgPool.query(
    `INSERT INTO "Tarifa"("id","operadorId","inquilinoId","nombre","precioHoraCent","vigenteDesde")
     VALUES('ta-in2','op1','in2','Suya',700000,'2020-01-01T00:00:00Z')`,
  );
  const r = await cerrarPeriodo({
    operadorId: "op1", inquilinoId: "in2", periodo: PERIODO, alicuotaDecimas: 0,
    venceEl: new Date("2026-08-30T12:00:00Z"), receptorRazonSocial: "Lic Gomez", receptorCondIva: "no informada",
  }, db);
  assert.ok(r.ok, "el cierre de preparación no debería fallar");
}

async function cuenta(tabla: string, inquilinoId: string) {
  const { rows } = await pgPool.query(`SELECT count(*)::int AS n FROM "${tabla}" WHERE "inquilinoId" = $1`, [inquilinoId]);
  return rows[0].n as number;
}

before(async () => {
  await reiniciarEsquema(pgPool);
});
beforeEach(async () => {
  // TRUNCATE y no DROP SCHEMA: recrear el esquema le cambia el OID a los enums, y la conexión que
  // Prisma tiene abierta los cachea — el test siguiente falla con "cache lookup failed for type".
  // Borrar por Operador alcanza: todo cuelga de él con FK en cascada.
  await pgPool.query('TRUNCATE "Operador","Usuario" CASCADE');
  await seedBase(pgPool);
});
after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

// ── Las puertas cerradas ────────────────────────────────────────────────────

test("una ficha ACTIVA no se borra, por más que se confirme bien", async () => {
  const r = await eliminar(owner, { inquilinoId: "in2", confirmacion: "Lic Gomez" });
  assert.ok(r.ok);
  assert.equal(r.data.ok, false);
  assert.equal(r.data.ok === false && r.data.error, "SIGUE_ACTIVO");
  // Dar de baja primero es lo que separa un error de dedo de una decisión en dos momentos.
  assert.ok(await db.inquilino.findUnique({ where: { id: "in2" } }));
});

test("el nombre mal escrito no borra nada", async () => {
  await pgPool.query(`UPDATE "Inquilino" SET "estado" = 'baja' WHERE id = 'in2'`);
  const r = await eliminar(owner, { inquilinoId: "in2", confirmacion: "Lic Gomes" });
  assert.ok(r.ok);
  assert.equal(r.data.ok === false && r.data.error, "NOMBRE_NO_COINCIDE");
  assert.ok(await db.inquilino.findUnique({ where: { id: "in2" } }));
});

test("el nombre se compara como lo ve una persona: mayúsculas y espacios de más dan igual", async () => {
  // El caso que motivó todo esto son dos fichas que se diferencian SOLO en las mayúsculas. Exigir
  // la grafía exacta sería pedirle a alguien que reproduzca el error que quiere borrar.
  await pgPool.query(`UPDATE "Inquilino" SET "estado" = 'baja' WHERE id = 'in2'`);
  const r = await eliminar(owner, { inquilinoId: "in2", confirmacion: "  lic   gomez " });
  assert.ok(r.ok && r.data.ok);
});

test("un profesional no puede borrar fichas, ni la suya", async () => {
  await pgPool.query(`UPDATE "Inquilino" SET "estado" = 'baja' WHERE id = 'in1'`);
  const r = await eliminar(profesional, { inquilinoId: "in1", confirmacion: "Dra Perez" });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error, "SIN_PERMISO");
  assert.ok(await db.inquilino.findUnique({ where: { id: "in1" } }));
});

test("la ficha de OTRO centro no se borra por id", async () => {
  await pgPool.query(`INSERT INTO "Operador"("id","nombre","slug") VALUES('op2','Otro','otro')`);
  await pgPool.query(`INSERT INTO "Inquilino"("id","operadorId","nombre","estado") VALUES('inAjeno','op2','Ajeno','baja')`);

  const r = await eliminar(owner, { inquilinoId: "inAjeno", confirmacion: "Ajeno" });
  assert.ok(r.ok);
  assert.equal(r.data.ok === false && r.data.error, "NO_ENCONTRADO");
  assert.ok(await db.inquilino.findUnique({ where: { id: "inAjeno" } }), "la ficha ajena sigue viva");
});

// ── El borrado de verdad ────────────────────────────────────────────────────

test("borra la ficha y TODO lo que le cuelga, sin dejar restos", async () => {
  await conTodoEncima();

  const r = await eliminar(owner, { inquilinoId: "in2", confirmacion: "Lic Gomez" });
  assert.ok(r.ok && r.data.ok, "debería borrar");
  assert.equal(r.data.reservas, 1);
  assert.equal(r.data.movimientos, 1);
  assert.equal(r.data.liquidaciones, 1);

  assert.equal(await db.inquilino.findUnique({ where: { id: "in2" } }), null);
  // Un resto en cualquiera de estas no es un dato viejo: es una fila huérfana que la FK NoAction
  // debería haber impedido, o sea que el borrado se hizo mal.
  for (const tabla of ["Ocupacion", "Asiento", "Liquidacion", "Tarifa", "Membresia", "EsperaSlot", "BolsaAsiento"]) {
    assert.equal(await cuenta(tabla, "in2"), 0, `quedaron filas en ${tabla}`);
  }
});

test("no toca nada del profesional de al lado", async () => {
  await conTodoEncima();
  await insertarOcupacion(pgPool, { id: "oc9", salaId: "sa1", inquilinoId: "in1", inicio: "2026-08-13T13:00:00Z", fin: "2026-08-13T14:00:00Z" });
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId: "in1", concepto: "cargo_uso", montoCent: 10_000n,
    moneda: "ARS", periodo: PERIODO, fechaHecho: new Date("2026-08-13T12:00:00Z"), clave: "c:in1",
  });

  const r = await eliminar(owner, { inquilinoId: "in2", confirmacion: "Lic Gomez" });
  assert.ok(r.ok && r.data.ok);

  assert.ok(await db.inquilino.findUnique({ where: { id: "in1" } }));
  assert.equal(await cuenta("Ocupacion", "in1"), 1);
  assert.equal(await cuenta("Asiento", "in1"), 1);
});

test("se lleva el acceso a la app, y la cuenta de login si no le queda otro centro", async () => {
  await pgPool.query(`UPDATE "Inquilino" SET "estado" = 'baja' WHERE id = 'in2'`);
  await pgPool.query(`INSERT INTO "Usuario"("id","email","nombre") VALUES('us9','gomez@example.com','Gomez')`);
  await pgPool.query(
    `INSERT INTO "UsuarioOperador"("usuarioId","operadorId","rol","inquilinoId") VALUES('us9','op1','inquilino_titular','in2')`,
  );

  const r = await eliminar(owner, { inquilinoId: "in2", confirmacion: "Lic Gomez" });
  assert.ok(r.ok && r.data.ok);

  // Una cuenta que entra a nombre de alguien que ya no existe es un agujero, no un resto.
  const { rows } = await pgPool.query(`SELECT count(*)::int AS n FROM "Usuario" WHERE id = 'us9'`);
  assert.equal(rows[0].n, 0);
});

test("una cuenta que ADEMÁS pertenece a otro centro no se borra", async () => {
  await pgPool.query(`UPDATE "Inquilino" SET "estado" = 'baja' WHERE id = 'in2'`);
  await pgPool.query(`INSERT INTO "Operador"("id","nombre","slug") VALUES('op2','Otro','otro')`);
  await pgPool.query(`INSERT INTO "Usuario"("id","email","nombre") VALUES('us9','gomez@example.com','Gomez')`);
  await pgPool.query(
    `INSERT INTO "UsuarioOperador"("usuarioId","operadorId","rol","inquilinoId") VALUES('us9','op1','inquilino_titular','in2')`,
  );
  await pgPool.query(`INSERT INTO "UsuarioOperador"("usuarioId","operadorId","rol") VALUES('us9','op2','owner')`);

  const r = await eliminar(owner, { inquilinoId: "in2", confirmacion: "Lic Gomez" });
  assert.ok(r.ok && r.data.ok);

  const { rows } = await pgPool.query(`SELECT count(*)::int AS n FROM "Usuario" WHERE id = 'us9'`);
  assert.equal(rows[0].n, 1, "borrarla dejaría al otro centro sin su usuario");
});

// ── Lo que se muestra antes de confirmar ────────────────────────────────────

test("el resumen dice qué se va a destruir, en cantidades y en pesos", async () => {
  await conTodoEncima();

  const a = await queArrastra({ operadorId: "op1", inquilinoId: "in2" }, db);
  assert.ok(a);
  assert.equal(a.nombre, "Lic Gomez");
  assert.equal(a.estado, "baja");
  assert.equal(a.reservas, 1);
  assert.equal(a.movimientos, 1);
  assert.equal(a.cargadoCent, 28_800_000n);
  assert.equal(a.tarifas, 1);
  assert.equal(a.liquidaciones.length, 1);
  assert.equal(a.liquidaciones[0]!.totalCent, 28_800_000n);
});

test("un cobro registrado se informa aparte: borrarlo no es limpiar, es cambiar los libros", async () => {
  await pgPool.query(`UPDATE "Inquilino" SET "estado" = 'baja' WHERE id = 'in2'`);
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId: "in2", concepto: "cargo_uso", montoCent: 20_000n,
    moneda: "ARS", periodo: PERIODO, fechaHecho: new Date("2026-08-12T12:00:00Z"), clave: "c:1",
  });
  await asentarIdempotente(db, {
    operadorId: "op1", inquilinoId: "in2", concepto: "pago", montoCent: -15_000n,
    moneda: "ARS", periodo: PERIODO, fechaHecho: new Date("2026-08-12T12:00:00Z"), clave: "p:1",
  });

  const a = await queArrastra({ operadorId: "op1", inquilinoId: "in2" }, db);
  assert.ok(a);
  // En positivo: quien lee tiene que ver "entraron $150", no un número negativo.
  assert.equal(a.cobradoCent, 15_000n);
  assert.equal(a.cargadoCent, 20_000n, "el cargo no se netea con el pago");
});

test("el resumen de una ficha de otro centro es null, igual que uno inexistente", async () => {
  assert.equal(await queArrastra({ operadorId: "op-ajeno", inquilinoId: "in2" }, db), null);
  assert.equal(await queArrastra({ operadorId: "op1", inquilinoId: "no-existe" }, db), null);
});
