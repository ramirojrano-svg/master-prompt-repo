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
