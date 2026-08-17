// tests/integracion/agenda-dia.test.ts — el camino de datos de LA pantalla (§6.4 / §6.3).
// No puedo abrir un browser en este entorno, así que se verifica lo que la pantalla recibe:
// salas, ubicaciones y —sobre todo— que la proyección por rol se respete de punta a punta.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { cargarDia } from "../../src/servicios/agenda/dia.ts";
import { prisma } from "../../src/db/prisma.ts";
import { fechaEnZona, instanteDeHoraLocal } from "../../src/dominio/motor/zona.ts";
import type { Actor } from "../../src/lib/actor.ts";
import { nuevoPool, reiniciarEsquema, seedBase, TZ_SEDE, URL_DB } from "./db.ts";

const pgPool = nuevoPool();
const db = new PrismaClient({ datasourceUrl: URL_DB });

const HOY = "2026-08-12"; // miércoles
const AHORA = instanteDeHoraLocal(HOY, "12:00", TZ_SEDE)!;

const owner: Actor = { usuarioId: "u1", operadorId: "op1", rol: "owner", inquilinoId: null };
const inqPropio: Actor = { usuarioId: "u2", operadorId: "op1", rol: "inquilino_titular", inquilinoId: "in1" };
const inqAjeno: Actor = { usuarioId: "u3", operadorId: "op1", rol: "inquilino_titular", inquilinoId: "in2" };

before(async () => {
  await reiniciarEsquema(pgPool);
  await seedBase(pgPool); // op1, se1, sa1/sa2, in1/in2
  const H = JSON.stringify({ "0": [], "1": [{ desde: "08:00", hasta: "22:00" }], "2": [{ desde: "08:00", hasta: "22:00" }], "3": [{ desde: "08:00", hasta: "22:00" }], "4": [{ desde: "08:00", hasta: "22:00" }], "5": [{ desde: "08:00", hasta: "22:00" }], "6": [] });
  await pgPool.query(`UPDATE "Sala" SET "horarioJson"=$1::jsonb, "orden"=1 WHERE "id"='sa1'`, [H]);
  await pgPool.query(`UPDATE "Sala" SET "horarioJson"=$1::jsonb, "orden"=2 WHERE "id"='sa2'`, [H]);
  // Una sala ARCHIVADA con actividad ese día (caso feo: no puede desaparecer de la pantalla).
  await pgPool.query(`INSERT INTO "Sala"("id","operadorId","sedeId","nombre","activa","orden") VALUES('saArch','op1','se1','Consultorio viejo',false,9)`);

  const ins = (id: string, salaId: string, inqId: string | null, desde: string, hasta: string, tipo = "reserva", nota: string | null = null) =>
    pgPool.query(
      `INSERT INTO "Ocupacion"("id","operadorId","sedeId","salaId","inquilinoId","tipo","estado","inicio","fin","tzSede","notaInterna")
       VALUES ($1,'op1','se1',$2,$3,$4::tipo_ocupacion,'confirmada',$5,$6,$7,$8)`,
      [id, salaId, inqId, tipo, instanteDeHoraLocal(HOY, desde, TZ_SEDE), instanteDeHoraLocal(HOY, hasta, TZ_SEDE), TZ_SEDE, nota],
    );

  await ins("r-propia", "sa1", "in1", "09:00", "10:00", "reserva", "Martín 16h");
  await ins("r-ajena", "sa1", "in2", "10:00", "11:00");
  await ins("r-mant", "sa2", null, "12:00", "13:00", "bloqueo");
  await ins("r-arch", "saArch", "in1", "15:00", "16:00");
});

after(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
  await pgPool.end();
});

test("el owner ve el día completo, con identidad y KPIs con denominador", async () => {
  const dia = await cargarDia({ actor: owner, fecha: HOY }, db);
  assert.ok(dia);
  assert.equal(dia!.reservas.length, 4);
  assert.ok(dia!.kpis.disponiblesMin > 0, "el denominador se muestra, no un % suelto");
  const propia = dia!.reservas.find((r) => r.id === "r-propia") as Record<string, unknown>;
  assert.equal(propia.inquilinoNombre, "Dra Perez");
});

test("§6.4 · el KPI usa la APERTURA como denominador (no el rango visible) y descuenta bloqueos", async () => {
  const dia = await cargarDia({ actor: owner, fecha: HOY }, db);
  // 2 salas activas × 14 h de apertura (08-22) = 1680' ; menos 60' de bloqueo = 1620'.
  assert.equal(dia!.kpis.disponiblesMin, 2 * 14 * 60 - 60);
  // Numerador: solo RESERVAS (2 de 1 h en sa1 + 1 h en la archivada), nunca el bloqueo.
  assert.equal(dia!.kpis.ocupadasMin, 3 * 60);
  assert.equal(dia!.kpis.ocupacionPct, Math.round((180 / 1620) * 100));
});

test("la sala ARCHIVADA con actividad sigue apareciendo (un filtro no borra una fila que existe)", async () => {
  const dia = await cargarDia({ actor: owner, fecha: HOY }, db);
  const arch = dia!.salas.find((s) => s.id === "saArch");
  assert.ok(arch, "la sala archivada con reservas del día tiene que estar");
  assert.equal(arch!.activa, false);
});

test("§6.3 · el inquilino NO ve identidad ajena ni notas de otros", async () => {
  const dia = await cargarDia({ actor: inqAjeno, fecha: HOY }, db);
  const json = JSON.stringify(dia!.reservas);
  assert.ok(!json.includes("Dra Perez"), "no puede salir el nombre de otro inquilino");
  assert.ok(!json.includes("Martín"), "no puede salir la nota privada de otro");
  const ajena = dia!.reservas.find((r) => r.id === "r-propia") as Record<string, unknown>;
  assert.equal(ajena.estado, "ocupado"); // indistinguible de un bloqueo
});

test("§6.3 · el inquilino SÍ ve su propia nota privada", async () => {
  const dia = await cargarDia({ actor: inqPropio, fecha: HOY }, db);
  const propia = dia!.reservas.find((r) => r.id === "r-propia") as Record<string, unknown>;
  assert.equal(propia.notaInterna, "Martín 16h");
  // pero la de al lado sigue siendo anónima
  const ajena = dia!.reservas.find((r) => r.id === "r-ajena") as Record<string, unknown>;
  assert.equal(ajena.estado, "ocupado");
});

test("las ubicaciones ubican cada bloque en su columna, sin exceder el grid", async () => {
  const dia = await cargarDia({ actor: owner, fecha: HOY }, db);
  assert.equal(dia!.ubicaciones.length, 4);
  for (const u of dia!.ubicaciones) {
    assert.ok(u.fila >= 1, "nunca fila 0 ni negativa");
    assert.ok(u.fila + u.span - 1 <= dia!.filas, "no desborda las filas del grid");
    assert.ok(u.carril < u.carriles, "no pide una subcolumna que el grid no tiene");
  }
});

test("un día sin actividad devuelve la grilla vacía pero con las salas activas", async () => {
  const vacio = await cargarDia({ actor: owner, fecha: "2026-08-15" }, db); // sábado
  assert.ok(vacio);
  assert.equal(vacio!.reservas.length, 0);
  assert.ok(vacio!.salas.length >= 2, "las salas activas se muestran igual");
});

test("el operador de OTRO tenant no ve nada de este centro", async () => {
  const ajeno: Actor = { usuarioId: "uX", operadorId: "opX", rol: "owner", inquilinoId: null };
  const dia = await cargarDia({ actor: ajeno, fecha: HOY }, db);
  assert.equal(dia, null, "sin sede propia no hay pantalla (y jamás datos ajenos)");
  void fechaEnZona(AHORA, TZ_SEDE);
});
