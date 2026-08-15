// src/lib/entorno.ts — carga .env.local y .env en los procesos que NO son Next.
//
// Next levanta .env.local solo; los scripts sueltos (seed, doctor, esquema) no. Sin esto
// `npm run seed` —el comando que el README manda a correr— explota con "Environment variable
// not found: DATABASE_URL" aunque el archivo esté ahí al lado. Ese fallo dejaba la base sin
// datos, y sin datos el login contesta "contraseña incorrecta": una hora de buscar el problema
// donde no estaba.
//
// La precedencia se aplica ACÁ, a mano, en vez de delegarla en `process.loadEnvFile`. La versión
// anterior leía .env.local primero y .env después, apoyada en que loadEnvFile no pisa lo ya
// definido. En Node 22 no pisa; en otras versiones SÍ. Donde pisa, el orden se da vuelta entero:
// .env —que suele ser una copia de .env.example con valores de ejemplo— le gana al .env.local
// real, y la app termina apuntando a una base sin contraseña con los dos archivos intactos y
// nada en pantalla que lo explique. Costó una sesión entera de depuración.
//
// Las reglas, explícitas y en este orden (las mismas que aplica Next):
//   1. El entorno REAL gana siempre. De eso dependen los tests: `DATABASE_URL=... npm test`
//      apunta a motor_test sin riesgo de escribir en la base de desarrollo.
//   2. .env.local le gana a .env.
//   3. Dentro de un archivo, la primera aparición de una clave gana.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Parsea el formato .env: `CLAVE=valor`, una por línea. Acepta el prefijo `export`, comillas
 * simples o dobles alrededor del valor, y descarta comentarios y líneas vacías.
 *
 * Deliberadamente chico: acá los .env los escribe una persona siguiendo .env.example, no un
 * generador. Lo que sí cubre es lo que rompe de verdad —las comillas y el \r de un archivo
 * guardado en Windows— porque un \r pegado al final de una URL la parte sin que se vea nada raro.
 */
export function parsearEnv(texto: string): Map<string, string> {
  const salida = new Map<string, string>();
  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea || linea.startsWith("#")) continue;

    const corte = linea.indexOf("=");
    if (corte < 1) continue;

    const clave = linea.slice(0, corte).replace(/^export\s+/, "").trim();
    if (!clave) continue;
    // La primera gana: si el archivo repite una clave, la de más arriba es la que se lee.
    if (salida.has(clave)) continue;

    let valor = linea.slice(corte + 1).trim();
    const comillada =
      valor.length >= 2 &&
      ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'")));
    if (comillada) valor = valor.slice(1, -1);
    salida.set(clave, valor);
  }
  return salida;
}

/** Carga .env.local y .env si existen. Silenciosa: que falten es normal (en prod las var van en el entorno). */
export function cargarEnv(raiz: string = process.cwd()): void {
  // Se fotografía ANTES de tocar nada: lo que ya venía del entorno real no se pisa, pase lo que
  // pase con los archivos. Comparar contra process.env sobre la marcha no serviría — después de
  // cargar el primer archivo ya no se distingue lo que puso el usuario de lo que pusimos acá.
  const delEntorno = new Set(Object.keys(process.env));

  for (const archivo of [".env.local", ".env"]) {
    const ruta = join(raiz, archivo);
    if (!existsSync(ruta)) continue;
    for (const [clave, valor] of parsearEnv(readFileSync(ruta, "utf8"))) {
      // El entorno real, y el archivo de mayor precedencia que ya la definió, mandan.
      if (delEntorno.has(clave)) continue;
      process.env[clave] = valor;
      delEntorno.add(clave);
    }
  }
}
