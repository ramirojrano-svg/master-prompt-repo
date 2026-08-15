#!/usr/bin/env node
// scripts/entorno-limpio.mjs — corre ANTES de `npm run dev` (npm lo engancha por el prefijo
// "pre") y avisa si la conexión no va a salir de .env.local.
//
// Por qué existe: una DATABASE_URL exportada en la terminal le gana al .env.local, en silencio,
// para TODO lo que se lance desde esa ventana — el doctor y el servidor por igual. El archivo
// puede estar impecable, y de hecho suele estarlo: se lo abre, se lee la conexión correcta, y no
// hay nada que corregir ahí. Mientras tanto la app habla con otra base (o con ninguna) y el login
// contesta que la contraseña está mal.
//
// Costó una sesión entera encontrarlo. El doctor ya lo detecta, pero el doctor hay que acordarse
// de correrlo: esto aparece solo, en el arranque, que es cuando el error se está por cometer.
//
// AVISA, no frena: pisar DATABASE_URL a propósito es legítimo (los tests apuntan a motor_test
// justo así). Lo que no puede pasar es que ocurra sin que nadie lo diga.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const amarillo = "\x1b[33m", limpio = "\x1b[0m";

// ── Lockfiles huérfanos por encima del proyecto ─────────────────────────────
// Next deduce la raíz del workspace buscando lockfiles hacia arriba. Si hay uno suelto en una
// carpeta de más arriba —lo deja un `npm install` corrido por error fuera del proyecto— elige ESA
// como raíz, y entonces resuelve los módulos contra el node_modules de allá. El error que sale es
// `Cannot find module 'next-auth'` con una ruta a la que le falta la carpeta del proyecto en el
// medio: C:\Users\vos\src\lib\sesion.ts en vez de C:\Users\vos\proyecto\src\lib\sesion.ts. Nada
// en ese mensaje dice "tenés un lockfile de más", y el warning de Next se pierde en el arranque.
//
// Se avisa, no se corrige: borrar archivos fuera del proyecto no es algo que este script deba
// hacer solo. Y NO se intenta arreglar con `turbopack.root` — se probó, y pasarle una ruta
// absoluta de Windows colgaba el servidor entero sin loguear nada.
const huerfanos = [];
for (let dir = dirname(RAIZ), previo = null; dir !== previo; previo = dir, dir = dirname(dir)) {
  for (const lock of ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb"]) {
    if (existsSync(join(dir, lock))) huerfanos.push(join(dir, lock));
  }
}

if (huerfanos.length > 0) {
  console.log(`\n${amarillo}⚠  Hay un lockfile FUERA del proyecto, en una carpeta de más arriba.${limpio}`);
  for (const h of huerfanos) console.log(`   ${h}`);
  console.log("   Next puede tomar esa carpeta como raíz y buscar los módulos ahí.");
  console.log("   El síntoma es:  Cannot find module 'next-auth'  con una ruta a la que le falta");
  console.log("   la carpeta del proyecto en el medio.");
  console.log(`   Si sobra (un npm install corrido por error), borralo:  ${amarillo}rm "${huerfanos[0]}"${limpio}\n`);
}

const expuesta = process.env.DATABASE_URL;

// Sin nada exportado no hay conflicto posible: el archivo manda y no hay nada que decir. El
// arranque limpio se queda callado — un aviso que sale siempre deja de leerse.
if (expuesta) {
  const tapar = (s) => String(s).replace(/:\/\/([^:/@]*):[^@]*@/, "://$1:***@");

  let delArchivo = null;
  const ruta = join(RAIZ, ".env.local");
  if (existsSync(ruta)) {
    for (const linea of readFileSync(ruta, "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)$/.exec(linea);
      if (!m) continue;
      const v = m[1].trim();
      const comillas = (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"));
      delArchivo = comillas ? v.slice(1, -1) : v;
      break;
    }
  }

  // Si coinciden, exportarla no cambia nada: no vale la pena gastar la atención del que lee.
  if (delArchivo !== expuesta) {
    const y = "\x1b[33m", r = "\x1b[0m";
    console.log(`\n${y}⚠  DATABASE_URL viene de la TERMINAL, no de .env.local.${r}`);
    console.log(`   En uso:       ${tapar(expuesta)}`);
    if (delArchivo) console.log(`   .env.local:   ${tapar(delArchivo)}`);
    console.log(`   La app va a usar la primera. Si no era la idea:  ${y}unset DATABASE_URL DIRECT_URL${r}\n`);
  }
}
