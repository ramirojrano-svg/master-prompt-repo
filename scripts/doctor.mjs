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

import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { cargarEnv } from "../src/lib/entorno.ts";
import { autorizar } from "../src/lib/auth-core.ts";

const CLAVE_DEMO = process.env.SEED_PASSWORD ?? "emoapp-2026";

// Las cuentas que este script promete que funcionan. Se usan para PROBAR y para IMPRIMIR al
// final: una sola lista, así el cartel de "entrá con esto" no puede quedar prometiendo una cuenta
// que nadie verificó.
const CUENTAS = [
  { rol: "Dueño", email: "ramirojrano@gmail.com" },
  { rol: "Profesional", email: "maria@email.com" },
  { rol: "Recepción", email: "ana@email.com" },
];

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
// QUÉ base, dicho en voz alta. Todo lo que sigue habla de ESTA, y la app tiene que hablar de la
// misma: cuando no coinciden, doctor dice "todo en orden" y el login rechaza la contraseña, sin
// que nada en pantalla insinúe que son dos bases distintas. Con el nombre acá, comparar es mirar.
const { rows: [dondeEstoy] } = await cliente.query(
  "SELECT current_database() AS base, host(inet_server_addr()) AS host, inet_server_port() AS puerto",
);
ok(`Postgres responde (v${fila.server_version}) — base "${dondeEstoy.base}" en ${dondeEstoy.host ?? "localhost"}:${dondeEstoy.puerto}`);

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

// Las tablas pueden estar TODAS y faltar una columna: es lo que pasa cuando el código se
// actualizó y la base no. Ese caso decía "esquema completo" y después el seed reventaba con un
// stack de Prisma en la línea que usaba la columna nueva — el chequeo miraba el continente y no
// el contenido.
const columnasEsperadas = [...sql.matchAll(/CREATE TABLE "([^"]+)" \(([\s\S]*?)\n\);/g)].flatMap(([, tabla, cuerpo]) =>
  [...cuerpo.matchAll(/^\s{4}"([^"]+)"/gm)].map((m) => `${tabla}.${m[1]}`),
);
const columnasPresentes = new Set(
  (await cliente.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'")).rows.map(
    (r) => `${r.table_name}.${r.column_name}`,
  ),
);
const columnasFaltan = columnasEsperadas.filter((c) => !columnasPresentes.has(c));
if (columnasFaltan.length > 0) {
  await cliente.end();
  morir(
    `Las tablas están, pero falta${columnasFaltan.length === 1 ? "" : "n"} ${columnasFaltan.length} columna${columnasFaltan.length === 1 ? "" : "s"}: ${columnasFaltan.slice(0, 6).join(", ")}${columnasFaltan.length > 6 ? "…" : ""}`,
    "La base es de una versión anterior del código: se actualizó la app y no el esquema.",
    "npm run db:reset   (borra y recrea; después hay que volver a cargar los datos)",
    "npm run seed",
  );
}
ok(`Esquema completo (${esperadas.length} tablas, ${columnasEsperadas.length} columnas)`);

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

// El cliente GENERADO de Prisma, que es distinto del esquema de la base. Un `git pull` que cambia
// schema.prisma NO lo regenera —eso pasa en `npm install`—, y entonces la base queda al día y el
// código no la puede usar: la primera consulta con un campo nuevo muere con "Unknown argument",
// que no se parece en nada a "faltó regenerar el cliente".
const generado = join(RAIZ, "node_modules/.prisma/client/index.d.ts");
if (!existsSync(generado)) {
  await cliente.end();
  morir("Falta el cliente de Prisma generado.", "npx prisma generate");
}
if (statSync(join(RAIZ, "prisma/schema.prisma")).mtimeMs > statSync(generado).mtimeMs) {
  await cliente.end();
  morir(
    "El cliente de Prisma es MÁS VIEJO que el esquema.",
    "La base puede estar bien; lo que no sabe de los campos nuevos es el código.",
    "npx prisma generate",
  );
}
ok("Cliente de Prisma al día con el esquema");

// ── 4. Datos ────────────────────────────────────────────────────────────────
const uno = async (q) => Number((await cliente.query(q)).rows[0].n);
const usuarios = await uno('SELECT count(*)::int AS n FROM "Usuario"');
const operadores = await uno(`SELECT count(*)::int AS n FROM "Operador" WHERE slug='espacio-moca'`);

if (operadores === 0) {
  await cliente.end();
  morir("El esquema está pero no hay datos: no vas a poder entrar.", "npm run seed");
}
// Sin usuarios pero CON centro: la puerta, no los datos. Se repara sin borrar nada.
if (usuarios === 0) {
  await cliente.end();
  morir("El centro está cargado pero no hay ningún usuario para entrar.", "npm run acceso");
}

const salas = await uno('SELECT count(*)::int AS n FROM "Sala"');
const ocupaciones = await uno('SELECT count(*)::int AS n FROM "Ocupacion"');
ok(`Datos cargados (${usuarios} usuarios, ${salas} salas, ${ocupaciones} ocupaciones)`);

// Que exista al menos un acceso ACTIVO: sin fila en UsuarioOperador se entra al login pero el
// panel devuelve 404, que es el síntoma más confuso de todos.
const accesos = await uno('SELECT count(*)::int AS n FROM "UsuarioOperador" WHERE activo = true');
if (accesos === 0) {
  await cliente.end();
  morir("Ningún usuario tiene acceso activo al centro (el panel daría 404).", "npm run acceso");
}
ok(`${accesos} accesos activos al centro`);

/**
 * Prueba cada cuenta con `autorizar`, la función que corre el provider de Auth.js. Devuelve true
 * si TODAS entran; si alguna no, explica cuál de los dos motivos posibles fue y sale con 1.
 *
 * La forma que se le pasa es la mínima que `autorizar` consume, respaldada por pg y no por el
 * cliente de Prisma: el cliente generado puede estar viejo —es justo lo que se revisó unas líneas
 * más arriba— y un diagnóstico no puede depender de la pieza que está tratando de auditar.
 */
async function cuentasQueEntran() {
  const comoPrisma = {
    usuario: {
      async findUnique({ where }) {
        const { rows: [u] } = await cliente.query(
          `SELECT id, email, nombre, "passwordHash", "sessionVersion" FROM "Usuario" WHERE email = $1`,
          [where.email],
        );
        return u ?? null;
      },
    },
  };

  for (const { rol, email } of CUENTAS) {
    if (await autorizar(comoPrisma, { email, password: CLAVE_DEMO })) continue;

    // Falló. `autorizar` devuelve el MISMO null para "ese email no existe" y "la contraseña no
    // coincide" — deliberado en el login, para no filtrar qué emails están registrados. Acá esa
    // discreción no sirve de nada y cuesta caro: se vuelve a preguntar para poder decir cuál de
    // los dos fue, porque se arreglan distinto.
    const { rows: [u] } = await cliente.query('SELECT email FROM "Usuario" WHERE email = $1', [email]);
    const { rows: cargados } = await cliente.query('SELECT email FROM "Usuario" ORDER BY email LIMIT 10');
    await cliente.end();

    if (!u) {
      morir(
        `No existe ningún usuario con el email ${email} (${rol}).`,
        // Los emails REALES de la base. Si lo que falla es una mayúscula o un dominio distinto,
        // se ve acá al lado y no hay nada más que deducir.
        `Los emails cargados en esta base son: ${cargados.map((r) => r.email).join(", ") || "(ninguno)"}`,
        "npm run acceso",
      );
    }
    morir(
      `La contraseña "${CLAVE_DEMO}" NO abre la cuenta ${email} (${rol}).`,
      "El usuario existe: lo que no coincide es la contraseña guardada.",
      "npm run acceso",
    );
  }
  ok(`las ${CUENTAS.length} cuentas entran (probado con la misma función que corre el login)`);
  return true;
}

// ── 5. La puerta ────────────────────────────────────────────────────────────
// El chequeo que más caro salió, y por qué está escrito así: se prueban las credenciales POR LA
// MISMA FUNCIÓN QUE USA EL LOGIN. La versión anterior verificaba a mano, con su propia consulta,
// el hash del primer dueño que apareciera — y eso NO es lo que hace la app: la app busca por el
// email TIPEADO, normalizado (trim + minúsculas). Dos caminos distintos pueden discrepar, y
// cuando discrepan el doctor dice "la contraseña verifica" mientras el login contesta
// "incorrecta", sin una sola pista de por qué. Un diagnóstico que no ejecuta el camino real no
// está diagnosticando: está adivinando en paralelo.
if (!(await cuentasQueEntran())) process.exit(1);

await cliente.end();

console.log("\n  Todo en orden. Arrancá con:  npm run dev");
console.log("  y entrá a  http://localhost:3000/panel/espacio-moca\n");
for (const { rol, email } of CUENTAS) console.log(`    ${rol.padEnd(12)} ${email.padEnd(24)} ${CLAVE_DEMO}`);
console.log();
