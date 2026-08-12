// tests/integracion/tenant-actor.test.ts — aislamiento multi-tenant y resolución de actor (§11.3 / §6.2)
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/db/prisma.ts";
import { conTenant } from "../../src/lib/tenant.ts";
import { resolverActor } from "../../src/lib/actor.ts";
import { nuevoPool, reiniciarEsquema, seedBase, TZ_SEDE } from "./db.ts";

const pgPool = nuevoPool();

async function ocup(id: string, operadorId: string, sedeId: string, salaId: string) {
  await pgPool.query(
    `INSERT INTO "Ocupacion"("id","operadorId","sedeId","salaId","inquilinoId","tipo","estado","inicio","fin","tzSede")
     VALUES ($1,$2,$3,$4,NULL,'bloqueo','confirmada','2026-08-12T12:00:00Z','2026-08-12T13:00:00Z',$5)`,
    [id, operadorId, sedeId, salaId, TZ_SEDE],
  );
}

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool); // op1 + se1 + sa1/sa2 + in1/in2, slug 'centro'
  // Segundo tenant op2, con su propio espacio.
  await pgPool.query(`INSERT INTO "Operador"("id","nombre","slug") VALUES('op2','Otro','otro')`);
  await pgPool.query(`INSERT INTO "Sede"("id","operadorId","nombre","zonaHoraria") VALUES('se2','op2','S2','${TZ_SEDE}')`);
  await pgPool.query(`INSERT INTO "Sala"("id","operadorId","sedeId","nombre") VALUES('saB','op2','se2','B')`);
  // Una ocupación (bloqueo) en cada operador.
  await ocup("oc-op1", "op1", "se1", "sa1");
  await ocup("oc-op2", "op2", "se2", "saB");
  // Un usuario con acceso owner a op1.
  await pgPool.query(`INSERT INTO "Usuario"("id","email","nombre") VALUES('u1','u1@test','Dueño')`);
  await pgPool.query(`INSERT INTO "UsuarioOperador"("usuarioId","operadorId","rol","activo") VALUES('u1','op1','owner',true)`);
});

after(async () => {
  await prisma.$disconnect();
  await pgPool.end();
});

test("resolverActor devuelve el rol para el usuario+slug", async () => {
  const a = await resolverActor(prisma, { usuarioId: "u1", slug: "centro" });
  assert.deepEqual(a, { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null });
});

test("resolverActor con un slug ajeno => null (no confirma la existencia del centro)", async () => {
  assert.equal(await resolverActor(prisma, { usuarioId: "u1", slug: "otro" }), null);
});

test("el rol se lee FRESCO de la DB: cambiarlo surte efecto en el próximo request", async () => {
  await pgPool.query(`UPDATE "UsuarioOperador" SET "rol"='gestor' WHERE "usuarioId"='u1'`);
  const a = await resolverActor(prisma, { usuarioId: "u1", slug: "centro" });
  assert.equal(a?.rol, "gestor");
  await pgPool.query(`UPDATE "UsuarioOperador" SET "rol"='owner' WHERE "usuarioId"='u1'`);
});

test("una membresía inactiva no resuelve actor (fail-closed)", async () => {
  await pgPool.query(`UPDATE "UsuarioOperador" SET "activo"=false WHERE "usuarioId"='u1'`);
  assert.equal(await resolverActor(prisma, { usuarioId: "u1", slug: "centro" }), null);
  await pgPool.query(`UPDATE "UsuarioOperador" SET "activo"=true WHERE "usuarioId"='u1'`);
});

test("aislamiento por operadorId EXPLÍCITO: un where del tenant B no trae filas de A", async () => {
  const deB = await prisma.ocupacion.findMany({ where: { operadorId: "op2" }, select: { id: true } });
  assert.deepEqual(deB.map((o) => o.id), ["oc-op2"]);
});

test("guard $extends: con contexto de tenant, un findMany SIN where solo ve lo propio", async () => {
  const sinCtx = await prisma.ocupacion.count();
  assert.equal(sinCtx, 2); // sin sesión el guard está inerte: ve las dos

  const soloA = await conTenant({ operadorId: "op1" }, () => prisma.ocupacion.count());
  const soloB = await conTenant({ operadorId: "op2" }, () => prisma.ocupacion.count());
  assert.equal(soloA, 1);
  assert.equal(soloB, 1);
});
