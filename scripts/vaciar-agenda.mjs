#!/usr/bin/env node
// scripts/vaciar-agenda.mjs — deja el calendario en blanco, sin tocar la configuración del centro.
//
//   npm run vaciar-agenda -- --si
//
// Para qué. Después del seed la agenda viene con turnos de ejemplo, que sirven para ver que la
// pantalla funciona y estorban para empezar a usarla de verdad. `db:reset` la vaciaría, pero se
// lleva puesto TODO —consultorios, profesionales, precios, usuarios y contraseñas— y habría que
// rehacer eso también.
//
// Qué borra:
//   · Ocupacion    — las reservas y los bloqueos: el calendario.
//   · Asiento      — la cuenta corriente: lo facturado por esos turnos y los cobros.
//   · BolsaAsiento — las horas de abono consumidas por esos turnos.
//   · EsperaSlot   — las esperas anotadas para horarios que ya no existen.
//   · Liquidacion  — los cierres de mes, que resumen turnos que dejaron de estar.
//
// Qué NO toca: el centro, la sede, los consultorios, los profesionales, los precios, los abonos,
// los gastos, ni los usuarios y sus contraseñas.
//
// Por qué borra también la plata. Un asiento dice "le cobrás 3 horas de la sala 2 del 14 de marzo".
// Si el turno desaparece y el asiento queda, el profesional entra a "Mis reservas", ve cero
// reservas y un saldo a pagar, y no hay pantalla en la app que explique de dónde salió. La deuda
// sin el detalle que la forma es exactamente lo que esta app existe para evitar.
//
// Pide --si a propósito: es destructivo y no tiene vuelta atrás.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { cargarEnv } from "../src/lib/entorno.ts";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const SLUG = process.env.SLUG ?? "espacio-moca";

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const info = (m) => console.log(`  \x1b[36m·\x1b[0m ${m}`);
const err = (m) => console.error(`  \x1b[31m✗\x1b[0m ${m}`);

cargarEnv(RAIZ);

const URL_BASE = process.env.DATABASE_URL || process.env.DIRECT_URL;
if (!URL_BASE) {
  err("No hay DATABASE_URL (ni en el entorno ni en .env.local).");
  process.exit(1);
}

// El orden importa: lo que cuelga de las reservas primero.
const TABLAS = ["Liquidacion", "EsperaSlot", "BolsaAsiento", "Asiento", "Ocupacion"];

const c = new pg.Client({ connectionString: URL_BASE });
try {
  await c.connect();
} catch (e) {
  err(`La base no responde: ${e.message}`);
  process.exit(1);
}

try {
  const { rows } = await c.query('SELECT id, nombre FROM "Operador" WHERE slug = $1', [SLUG]);
  const operador = rows[0];
  if (!operador) {
    err(`No existe el centro "${SLUG}".`);
    process.exit(1);
  }

  console.log(`\nEMOAPP — vaciar la agenda de ${operador.nombre} (${SLUG})\n`);

  // Se cuenta ANTES de preguntar: "esto borra 39 reservas" es una advertencia; "esto borra datos"
  // no dice nada. Y si ya está vacío, se sabe sin haber tocado nada.
  const conteos = [];
  for (const t of TABLAS) {
    const { rows: r } = await c.query(`SELECT COUNT(*)::int AS n FROM "${t}" WHERE "operadorId" = $1`, [operador.id]);
    conteos.push([t, r[0].n]);
  }
  for (const [t, n] of conteos) info(`${t}: ${n}`);

  const total = conteos.reduce((s, [, n]) => s + n, 0);
  if (total === 0) {
    console.log("");
    ok("La agenda ya estaba vacía: no había nada que borrar.");
    process.exit(0);
  }

  if (!process.argv.includes("--si")) {
    console.log("");
    err(`Esto borra ${total} filas y NO se puede deshacer.`);
    err("Si es lo que querés:   npm run vaciar-agenda -- --si");
    process.exit(1);
  }

  // Todo o nada: a mitad de camino quedarían asientos hablando de turnos que ya no existen.
  await c.query("BEGIN");
  for (const t of TABLAS) {
    const r = await c.query(`DELETE FROM "${t}" WHERE "operadorId" = $1`, [operador.id]);
    if (r.rowCount > 0) ok(`${t}: ${r.rowCount} borradas`);
  }
  await c.query("COMMIT");

  console.log("");
  ok("Calendario en blanco. Los consultorios, los profesionales y los precios quedaron como estaban.");
} catch (e) {
  await c.query("ROLLBACK").catch(() => {});
  err(`No se pudo vaciar: ${e.message}`);
  process.exit(1);
} finally {
  await c.end();
}
