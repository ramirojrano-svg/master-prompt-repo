#!/usr/bin/env node
// scripts/acceso.mjs — repara los accesos al panel sin tocar los datos.
//
//   npm run acceso
//
// Por qué existe. "Email o contraseña incorrectos" con la contraseña correcta significa una sola
// cosa: la base responde y el usuario no verifica. Hasta ahora la única salida era `npm run seed`,
// que REHACE el centro entero — y usar una motosierra para arreglar una cerradura es cómodo el
// primer día y carísimo el día que ya hay turnos cargados.
//
// Esto repara solamente la puerta: crea los usuarios si faltan, les vuelve a poner la
// contraseña, y se asegura de que tengan su rol ACTIVO en el centro. No mira ni toca turnos,
// profesionales, precios ni asientos.
//
// La contraseña sale de SEED_PASSWORD, así que también es la forma de CAMBIARLA en producción:
//   SEED_PASSWORD='la nueva' npm run acceso
//
// Es idempotente: correrlo dos veces deja lo mismo. Y no inventa el centro — si no existe, avisa
// que hace falta el seed, porque un usuario sin centro no puede entrar a ninguna parte.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { cargarEnv } from "../src/lib/entorno.ts";
import { hashPassword, verificarPassword } from "../src/lib/password.ts";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const SLUG = process.env.SLUG ?? "espacio-moca";
const CLAVE = process.env.SEED_PASSWORD ?? "emoapp-2026";

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const err = (m) => console.error(`  \x1b[31m✗\x1b[0m ${m}`);

// Los dos accesos del piloto, uno por rol. El inquilino se cuelga del primer profesional que
// haya: sirve para ver la pantalla con las reglas de privacidad puestas.
//
// Había un tercero, `ana@email.com` con rol `recepcion`, que quedó acá cuando el centro pasó a
// tener solo administrador y profesional. `recepcion` ya no existe en el enum `Rol` de la base,
// así que el INSERT fallaba y el script se cortaba con un error de Postgres — justo la
// herramienta que uno corre cuando NO puede entrar.
const CUENTAS = [
  { email: "ramirojrano@gmail.com", nombre: "Ramiro Raño", rol: "owner", conInquilino: false },
  { email: "maria@email.com", nombre: "Profesional", rol: "inquilino_titular", conInquilino: true },
];

cargarEnv(RAIZ);
if (!process.env.DATABASE_URL) {
  err("No hay DATABASE_URL (ni en el entorno ni en .env.local).");
  process.exit(1);
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await c.connect();
} catch (e) {
  err(`La base no responde: ${e.message}`);
  err("Levantá Postgres y volvé a intentar.  npm run doctor  te dice más.");
  process.exit(1);
}

console.log("\nEMOAPP — reparando los accesos al panel\n");

try {
  const { rows: ops } = await c.query('SELECT id FROM "Operador" WHERE slug = $1', [SLUG]);
  const operadorId = ops[0]?.id;
  if (!operadorId) {
    err(`No existe el centro "${SLUG}": no hay a qué darle acceso.`);
    err("Cargá los datos primero:  npm run seed");
    process.exit(1);
  }

  // Un profesional cualquiera para colgarle el usuario del inquilino. Si todavía no hay ninguno,
  // ese acceso se saltea en vez de fallar: los otros dos alcanzan para entrar.
  const { rows: inqs } = await c.query('SELECT id FROM "Inquilino" WHERE "operadorId" = $1 ORDER BY nombre LIMIT 1', [operadorId]);
  const inquilinoId = inqs[0]?.id ?? null;

  const hash = await hashPassword(CLAVE);

  for (const cuenta of CUENTAS) {
    if (cuenta.conInquilino && !inquilinoId) {
      console.log(`  \x1b[36m·\x1b[0m ${cuenta.email}: salteado (todavía no hay profesionales cargados)`);
      continue;
    }

    // El usuario: se crea si falta y se le REPONE la contraseña si ya estaba. Reponerla siempre
    // es el punto — si el hash guardado no coincide, ninguna otra reparación sirve de nada.
    const { rows: us } = await c.query(
      `INSERT INTO "Usuario"("id","email","nombre","passwordHash")
       VALUES (gen_random_uuid()::text, $1, $2, $3)
       ON CONFLICT ("email") DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash"
       RETURNING id`,
      [cuenta.email, cuenta.nombre, hash],
    );
    const usuarioId = us[0].id;

    // El rol en el centro. `activo` vuelve a true: una membresía desactivada da 404 en el panel,
    // que es el síntoma más confuso de todos (entrás pero "el centro no existe").
    await c.query(
      `INSERT INTO "UsuarioOperador"("usuarioId","operadorId","rol","inquilinoId","activo")
       VALUES ($1, $2, $3::"Rol", $4, true)
       ON CONFLICT ("usuarioId","operadorId")
       DO UPDATE SET rol = EXCLUDED.rol, "inquilinoId" = EXCLUDED."inquilinoId", activo = true`,
      [usuarioId, operadorId, cuenta.rol, cuenta.conInquilino ? inquilinoId : null],
    );

    // Se verifica de verdad contra el hash guardado, no se asume: es exactamente lo que la app
    // va a hacer cuando la persona apriete "Entrar".
    const { rows: guardado } = await c.query('SELECT "passwordHash" FROM "Usuario" WHERE id = $1', [usuarioId]);
    const anda = await verificarPassword(CLAVE, guardado[0].passwordHash);
    if (!anda) {
      err(`${cuenta.email}: la contraseña quedó mal guardada. Esto no debería pasar.`);
      process.exit(1);
    }
    ok(`${cuenta.email} · ${cuenta.rol}`);
  }

  console.log(`\n  Entrá a  http://localhost:3000/panel/${SLUG}  con cualquiera de esos emails.`);
  console.log(`  Contraseña: ${CLAVE}\n`);
} catch (e) {
  err(`No se pudo reparar: ${e.message}`);
  process.exit(1);
} finally {
  await c.end();
}
