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

// DIRECT_URL primero: esto ejecuta DDL (CREATE TABLE, CREATE EXTENSION, EXCLUDE), y contra un
// Postgres administrado —Supabase, Neon— DATABASE_URL suele apuntar a un pooler en modo
// transacción que RECHAZA o rompe el DDL. La conexión directa existe exactamente para esto. En
// local las dos apuntan al mismo lado y no cambia nada.
const URL_BASE = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!URL_BASE) {
  err("No hay DATABASE_URL ni DIRECT_URL (ni en el entorno ni en .env.local).");
  err("En local: copiá .env.example a .env.local y completá la conexión.");
  err("En Vercel: cargalas en Settings → Environment Variables.");
  process.exit(1);
}

const reset = process.argv.includes("--reset");
const sql = readFileSync(MIGRACION, "utf8");

// Columnas agregadas DESPUÉS de que la base ya existía.
//
// El camino de arriba crea tablas: si están todas, no hace nada. Eso alcanzaba mientras el esquema
// solo crecía en tablas, pero una columna nueva en una tabla que ya existe no la aplicaba nadie —
// y la única salida era `db:reset`, que borra los datos. Para una base con turnos cargados eso no
// es una opción, así que la columna nunca llegaba a producción.
//
// Estos parches corren SIEMPRE y son idempotentes (`IF NOT EXISTS`): aplicarlos dos veces deja lo
// mismo. Solo van acá los cambios que no pueden romper nada — agregar una columna que admite NULL.
// Renombrar, borrar o cambiar un tipo necesita pensar qué pasa con lo que ya está guardado, y eso
// no se resuelve con una lista.
const PARCHES = [
  'ALTER TABLE "Inquilino" ADD COLUMN IF NOT EXISTS "titulo" TEXT',
  'ALTER TABLE "Inquilino" ADD COLUMN IF NOT EXISTS "foto" TEXT',
  // Quien usa el consultorio pero no es cliente del centro. Nace en TRUE: todos los que ya están
  // cargados facturan, que es lo que venía pasando hasta ahora.
  'ALTER TABLE "Inquilino" ADD COLUMN IF NOT EXISTS "facturable" BOOLEAN NOT NULL DEFAULT true',
  // Los pedidos de "olvidé mi contraseña". Tabla nueva: se crea con IF NOT EXISTS igual que las
  // columnas, así una base ya cargada la suma sin perder nada.
  `CREATE TABLE IF NOT EXISTS "TokenClave" (
     "id" TEXT NOT NULL PRIMARY KEY,
     "usuarioId" TEXT NOT NULL REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE,
     "tokenHash" TEXT NOT NULL UNIQUE,
     "expiraEl" TIMESTAMPTZ(6) NOT NULL,
     "usadoEl" TIMESTAMPTZ(6),
     "creadoEl" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  'CREATE INDEX IF NOT EXISTS "TokenClave_usuarioId_expiraEl_idx" ON "TokenClave"("usuarioId", "expiraEl")',
  // Quién hizo qué. Tabla nueva: IF NOT EXISTS, así una base con datos la suma sin perder nada.
  `CREATE TABLE IF NOT EXISTS "Auditoria" (
     "id" TEXT NOT NULL PRIMARY KEY,
     "operadorId" TEXT NOT NULL REFERENCES "Operador"("id") ON DELETE CASCADE ON UPDATE CASCADE,
     "usuarioId" TEXT NOT NULL,
     "rol" "Rol" NOT NULL,
     "permiso" TEXT NOT NULL,
     "resultado" TEXT NOT NULL,
     "resumen" TEXT,
     "creadoEl" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  'CREATE INDEX IF NOT EXISTS "Auditoria_operadorId_creadoEl_idx" ON "Auditoria"("operadorId", "creadoEl")',
  'CREATE INDEX IF NOT EXISTS "Auditoria_operadorId_usuarioId_creadoEl_idx" ON "Auditoria"("operadorId", "usuarioId", "creadoEl")',
  // Una RESERVA puede no tener sala (horas que se facturan sin usar el espacio). Se reemplaza el
  // CHECK viejo: DROP + ADD porque Postgres no tiene "ALTER CONSTRAINT" para cambiar la condición.
  // Sigue siendo idempotente — correrlo dos veces deja lo mismo.
  'ALTER TABLE "Ocupacion" DROP CONSTRAINT IF EXISTS "ocupacion_sala_requerida"',
  `ALTER TABLE "Ocupacion" ADD CONSTRAINT "ocupacion_sala_requerida" CHECK ("tipo" IN ('bloqueo', 'reserva') OR "salaId" IS NOT NULL)`,
];

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

/** Qué tablas hay ahora mismo. Se vuelve a preguntar después de los parches: una tabla nueva la
 *  puede haber creado un parche, y contestar con la foto vieja sería declarar que falta algo que
 *  se acaba de crear. */
async function tablasPresentes() {
  const r = await cliente.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
  return r.rows.map((x) => x.table_name);
}

try {
  const antes = await tablasPresentes();
  const faltanAntes = esperadas.filter((t) => !antes.includes(t));

  if (reset) {
    // Destructivo a propósito y solo con la bandera puesta: es la salida para una base a medias.
    await cliente.query('DROP SCHEMA IF EXISTS "public" CASCADE; CREATE SCHEMA "public";');
    ok("Esquema anterior borrado");
    await cliente.query(sql);
    ok(`Esquema recreado (${esperadas.length} tablas, constraints de exclusión y btree_gist)`);
    info("Ahora cargá los datos:  npm run seed");
  } else if (faltanAntes.length === esperadas.length) {
    // Base vacía: la migración entera. Tiene que ir ANTES de los parches, que agregan columnas y
    // referencias sobre tablas que todavía no existirían.
    await cliente.query(sql);
    ok(`Esquema aplicado (${esperadas.length} tablas, constraints de exclusión y btree_gist)`);
    info("Ahora cargá los datos:  npm run seed");
  }

  // Los parches van SIEMPRE y ANTES de juzgar si la base está completa. El orden importa y se
  // pagó caro: los parches también crean TABLAS nuevas, no solo columnas. Cuando se agregó
  // TokenClave, una base de producción sana pasó a tener "15 de 16 tablas", el chequeo la declaró
  // a medias y abortó con exit 1 — tirando abajo el deploy y recomendando un `db:reset` que
  // habría borrado los turnos cargados. La tabla que "faltaba" la creaba el parche de tres líneas
  // más abajo, que nunca llegaba a correr.
  for (const parche of PARCHES) await cliente.query(parche);

  // Recién ahora se juzga, con la foto de DESPUÉS de los parches.
  const despues = await tablasPresentes();
  const faltan = esperadas.filter((t) => !despues.includes(t));
  if (faltan.length > 0) {
    err(`La base quedó a medias: le falta${faltan.length === 1 ? "" : "n"} ${faltan.length} de ${esperadas.length} tablas.`);
    err(`Falta${faltan.length === 1 ? "" : "n"}: ${faltan.join(", ")}`);
    err("Es una base de una versión anterior, y ningún parche la cubre.");
    // El aviso va ANTES del comando: `db:reset` borra la base entera, y en producción eso son los
    // turnos y la facturación de verdad. Ofrecerlo a secas es ofrecer un desastre.
    err("Para rehacerla en DESARROLLO (borra TODOS los datos, nunca en producción):");
    err("    npm run db:reset && npm run seed");
    process.exit(1);
  }
  ok(`Esquema al día (${esperadas.length} tablas, ${PARCHES.length} parches idempotentes)`);
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
