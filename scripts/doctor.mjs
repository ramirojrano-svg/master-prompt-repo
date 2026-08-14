#!/usr/bin/env node
// scripts/doctor.mjs — revisa la instalación y dice qué falta, en orden.
//
//   npm run doctor
//
// Nació de una sesión entera perdida: la app decía "email o contraseña incorrectos" y el
// problema real era que la base no tenía tablas. Ningún mensaje de la app apuntaba ahí. Este
// script revisa la cadena completa —entorno, conexión, esquema, datos— y se detiene en el
// primer eslabón roto con el comando que lo arregla. Sale con código 1 si algo está mal, así
// sirve igual en un CI.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { cargarEnv } from "../src/lib/entorno.ts";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRACION = join(RAIZ, "prisma/migrations/0001_ocupacion_exclusion/migration.sql");

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const err = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const pista = (m) => console.log(`      \x1b[36m→\x1b[0m ${m}`);

function morir(mensaje, ...pasos) {
  err(mensaje);
  for (const p of pasos) pista(p);
  console.log();
  process.exit(1);
}

console.log("\nEMOAPP — revisión de la instalación\n");

// ── 1. Entorno ──────────────────────────────────────────────────────────────
cargarEnv(RAIZ);

if (!existsSync(join(RAIZ, ".env.local"))) {
  morir("No existe .env.local", "Copiá .env.example a .env.local y completá la conexión");
}
if (!process.env.DATABASE_URL) morir("Falta DATABASE_URL en .env.local", "Mirá .env.example");
if (!process.env.AUTH_SECRET) {
  // Sin AUTH_SECRET no se firman las cookies: se entra y en el próximo click estás afuera.
  morir(
    "Falta AUTH_SECRET en .env.local",
    'Generá uno:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
  );
}
ok(".env.local con DATABASE_URL y AUTH_SECRET");

// ── 2. Conexión ─────────────────────────────────────────────────────────────
/**
 * Traduce por qué no se pudo conectar.
 *
 * "No responde", "no me deja entrar" y "esa base no existe" son tres problemas distintos que se
 * arreglan de tres maneras distintas. Reportar siempre el primero manda a revisar si el servidor
 * está levantado cuando el servidor está perfecto y lo único que no coincide es la contraseña —
 * y ese rodeo ya costó una vuelta entera.
 */
function morirPorConexion(e) {
  // La URL ya se validó arriba; si no parsea, se cae al mensaje genérico.
  let usuario = "postgres", clave = "", base = "motor";
  try {
    const u = new URL(process.env.DATABASE_URL);
    usuario = decodeURIComponent(u.username) || "postgres";
    clave = decodeURIComponent(u.password);
    base = u.pathname.slice(1) || "motor";
  } catch {}

  if (e.code === "28P01" || /password authentication failed/i.test(e.message ?? "")) {
    // La clave va escrita en el comando a propósito: es la de una base LOCAL de desarrollo, ya
    // está en el .env.local de esta misma máquina, y con un placeholder el comando deja de ser
    // pegable —que es justo lo que hace útil a este mensaje.
    morir(
      `Postgres responde, pero rechaza la contraseña del usuario "${usuario}".`,
      "El servidor está bien: lo que no coincide es la clave de .env.local con la que tiene la base.",
      "Si la base corre en Docker, alineala con una línea:",
      `docker exec -it emoapp-db psql -U ${usuario} -c "ALTER USER ${usuario} WITH PASSWORD '${clave}';"`,
      "y volvé a correr:  npm run doctor",
    );
  }
  if (e.code === "3D000" || /database .* does not exist/i.test(e.message ?? "")) {
    morir(
      `El servidor responde, pero no existe la base "${base}".`,
      `docker exec -it emoapp-db createdb -U ${usuario} ${base}`,
      "y después:  npm run instalar",
    );
  }
  morir(
    `Postgres no responde: ${e.message}`,
    "Levantá la base (o el contenedor: docker start emoapp-db)",
    "Verificá que el puerto de DATABASE_URL sea el correcto",
  );
}

const cliente = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await cliente.connect();
} catch (e) {
  morirPorConexion(e);
}
const { rows: [fila] } = await cliente.query("SHOW server_version");
ok(`Postgres responde (v${fila.server_version})`);

// ── 3. Esquema ──────────────────────────────────────────────────────────────
const sql = readFileSync(MIGRACION, "utf8");
const esperadas = [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1]).sort();
const presentes = (
  await cliente.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
).rows.map((r) => r.table_name);
const faltan = esperadas.filter((t) => !presentes.includes(t));

if (faltan.length === esperadas.length) {
  await cliente.end();
  morir(
    "La base está VACÍA: no tiene ninguna tabla.",
    "npm run db:esquema",
    "npm run seed",
  );
}
if (faltan.length > 0) {
  await cliente.end();
  morir(
    `La base quedó vieja: le falta${faltan.length === 1 ? "" : "n"} ${faltan.length} tabla${faltan.length === 1 ? "" : "s"} (${faltan.join(", ")}).`,
    "npm run db:reset   (borra y recrea; son datos de prueba)",
    "npm run seed",
  );
}
ok(`Esquema completo (${esperadas.length} tablas)`);

// El EXCLUDE es el que impide dos reservas en la misma sala a la misma hora. Si la base se creó
// con `prisma db push` en vez de la migración, las tablas están pero el constraint NO — y eso no
// se nota hasta que dos personas reservan el mismo horario.
const { rows: excl } = await cliente.query(
  "SELECT conname FROM pg_constraint WHERE contype='x' AND conrelid='public.\"Ocupacion\"'::regclass",
);
if (excl.length === 0) {
  await cliente.end();
  morir(
    "Faltan los constraints de exclusión de Ocupacion (la base se creó con `prisma db push`).",
    "Sin ellos dos personas pueden reservar la misma sala a la misma hora.",
    "npm run db:reset && npm run seed",
  );
}
ok(`Constraints de exclusión activos (${excl.length})`);

// ── 4. Datos ────────────────────────────────────────────────────────────────
const uno = async (q) => Number((await cliente.query(q)).rows[0].n);
const usuarios = await uno('SELECT count(*)::int AS n FROM "Usuario"');
const operadores = await uno(`SELECT count(*)::int AS n FROM "Operador" WHERE slug='espacio-moca'`);

if (usuarios === 0 || operadores === 0) {
  await cliente.end();
  morir("El esquema está pero no hay datos: no vas a poder entrar.", "npm run seed");
}

const conClave = await uno(`SELECT count(*)::int AS n FROM "Usuario" WHERE "passwordHash" LIKE '$2%'`);
if (conClave === 0) morir("Hay usuarios pero ninguno con contraseña utilizable.", "npm run seed");

const salas = await uno('SELECT count(*)::int AS n FROM "Sala"');
const ocupaciones = await uno('SELECT count(*)::int AS n FROM "Ocupacion"');
ok(`Datos cargados (${usuarios} usuarios, ${salas} salas, ${ocupaciones} ocupaciones)`);

// Que exista al menos un acceso ACTIVO: sin fila en UsuarioOperador se entra al login pero el
// panel devuelve 404, que es el síntoma más confuso de todos.
const accesos = await uno('SELECT count(*)::int AS n FROM "UsuarioOperador" WHERE activo = true');
if (accesos === 0) morir("Ningún usuario tiene acceso activo al centro (el panel daría 404).", "npm run seed");
ok(`${accesos} accesos activos al centro`);

await cliente.end();

console.log("\n  Todo en orden. Arrancá con:  npm run dev");
console.log("  y entrá a  http://localhost:3000/panel/espacio-moca\n");
console.log("    Dueño        ramirojrano@gmail.com   emoapp-2026");
console.log("    Profesional  maria@email.com         emoapp-2026");
console.log("    Recepción    ana@email.com           emoapp-2026\n");
