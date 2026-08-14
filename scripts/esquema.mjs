#!/usr/bin/env node
// scripts/esquema.mjs — aplica el esquema a la base. Sin psql, sin bash.
//
//   node scripts/esquema.mjs           aplica el esquema si falta
//   node scripts/esquema.mjs --reset   borra TODO y lo recrea (datos de prueba: se pierden)
//
// Por qué existe: el README mandaba a correr
//     psql "$DATABASE_URL" -f prisma/migrations/0001_ocupacion_exclusion/migration.sql
// que asume bash Y un psql en el PATH. En Windows no hay ninguno de los dos, así que el paso se
// saltea y la app arranca contra una base VACÍA. Ahí Prisma tira P2021 en la primera consulta y
// el login, que no distinguía "clave mal" de "no pude preguntar", contestaba "contraseña
// incorrecta". El paso más importante de la instalación no podía correrse en la mitad de las
// máquinas. Esto hace el mismo trabajo con pg, que ya es dependencia del proyecto.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { cargarEnv } from "../src/lib/entorno.ts";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRACION = join(RAIZ, "prisma/migrations/0001_ocupacion_exclusion/migration.sql");

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const info = (m) => console.log(`  \x1b[36m·\x1b[0m ${m}`);
const err = (m) => console.error(`  \x1b[31m✗\x1b[0m ${m}`);

cargarEnv(RAIZ);

const URL_BASE = process.env.DATABASE_URL;
if (!URL_BASE) {
  err("No hay DATABASE_URL (ni en el entorno ni en .env.local).");
  err("Copiá .env.example a .env.local y completá la conexión.");
  process.exit(1);
}

const reset = process.argv.includes("--reset");
const sql = readFileSync(MIGRACION, "utf8");

// Las tablas que el esquema DEBE crear se leen de la propia migración: si mañana se agrega una
// tabla, este chequeo se entera solo. Una lista escrita a mano se desactualiza y el día que pasa
// dice "todo en orden" sobre una base a la que le falta algo.
const esperadas = [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1]).sort();

const cliente = new pg.Client({ connectionString: URL_BASE });

try {
  await cliente.connect();
} catch (e) {
  err(`No me pude conectar a la base: ${e.message}`);
  err("Revisá que Postgres esté levantado y que DATABASE_URL apunte al puerto correcto.");
  process.exit(1);
}

try {
  const presentes = (
    await cliente.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
  ).rows.map((r) => r.table_name);
  const faltan = esperadas.filter((t) => !presentes.includes(t));

  if (reset) {
    // Destructivo a propósito y solo con la bandera puesta: es la salida para una base a medias.
    await cliente.query('DROP SCHEMA IF EXISTS "public" CASCADE; CREATE SCHEMA "public";');
    ok("Esquema anterior borrado");
    await cliente.query(sql);
    ok(`Esquema recreado (${esperadas.length} tablas, constraints de exclusión y btree_gist)`);
    info("Ahora cargá los datos:  npm run seed");
  } else if (faltan.length === 0) {
    ok(`El esquema ya estaba aplicado (${esperadas.length} tablas)`);
  } else if (faltan.length === esperadas.length) {
    await cliente.query(sql);
    ok(`Esquema aplicado (${esperadas.length} tablas, constraints de exclusión y btree_gist)`);
    info("Ahora cargá los datos:  npm run seed");
  } else {
    // Ni vacía ni completa: la base quedó de una versión anterior del código. Aplicar la
    // migración de nuevo fallaría en la primera tabla que ya existe, así que no lo intentamos:
    // se dice qué falta y cuál es el comando que lo arregla.
    err(`La base quedó a medias: le falta${faltan.length === 1 ? "" : "n"} ${faltan.length} de ${esperadas.length} tablas.`);
    err(`Falta${faltan.length === 1 ? "" : "n"}: ${faltan.join(", ")}`);
    err("Es una base de una versión anterior. Para rehacerla (se pierden los datos de prueba):");
    err("    npm run db:reset && npm run seed");
    process.exit(1);
  }
} catch (e) {
  err(`Falló al aplicar el esquema: ${e.message}`);
  process.exit(1);
} finally {
  await cliente.end();
}

// El CLIENTE de Prisma se regenera acá, no solo en `npm install`. Aplicar el esquema y dejar el
// cliente viejo deja la base al día y el código incapaz de usarla: la primera consulta con un
// campo nuevo muere con "Unknown argument", que no se parece en nada a "faltó regenerar". Es
// barato y elimina el paso que todo el mundo se olvida después de un `git pull`.
try {
  // `shell: true` NO es decorativo: en Windows `npx` es `npx.cmd`, y sin shell el spawn no lo
  // resuelve y muere con ENOENT. El comando va como string por la misma razón.
  execSync("npx --yes prisma@6 generate", { cwd: RAIZ, stdio: "pipe", shell: true });
  ok("Cliente de Prisma regenerado");
} catch (e) {
  // Sale con 1 para FRENAR la cadena (`npm run instalar` es esquema && seed && doctor): sin el
  // cliente regenerado el seed va a morir igual, y es mejor parar acá —en la causa— que dejarlo
  // fallar dos pasos más adelante con otro mensaje.
  const detalle = String(e.stderr || e.message);
  err("El esquema SÍ se aplicó, pero no se pudo regenerar el cliente de Prisma.");

  // EPERM al renombrar el motor: en Windows el .dll no se puede reemplazar mientras un proceso
  // lo tiene abierto, y el que lo tiene abierto es SIEMPRE el servidor de desarrollo. El mensaje
  // de Prisma habla de un rename fallido y no menciona esto por ningún lado.
  if (/EPERM|EBUSY|operation not permitted/i.test(detalle)) {
    err("El archivo está en uso: `npm run dev` lo tiene abierto y Windows no lo deja reemplazar.");
    err("1) Frená el servidor con Ctrl+C en su ventana");
    err("2) npx prisma generate");
    err("3) volvé a arrancar con npm run dev");
  } else {
    err("Corré a mano:   npx prisma generate");
  }
  err(detalle.split("\n").filter(Boolean).slice(0, 2).join(" "));
  process.exit(1);
}
