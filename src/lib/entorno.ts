// src/lib/entorno.ts — carga .env.local en los procesos que NO son Next.
//
// Next levanta .env.local solo; los scripts sueltos (seed, doctor, esquema) no. Sin esto
// `npm run seed` —el comando que el README manda a correr— explota con "Environment variable
// not found: DATABASE_URL" aunque el archivo esté ahí al lado. Ese fallo dejaba la base sin
// datos, y sin datos el login contesta "contraseña incorrecta": una hora de buscar el problema
// donde no estaba.
//
// loadEnvFile NO pisa lo que ya está en el entorno, y de eso dependemos: un DATABASE_URL
// explícito adelante del comando sigue mandando, así los tests apuntan a motor_test sin riesgo
// de escribir en la base de desarrollo.

import { existsSync } from "node:fs";
import { join } from "node:path";

/** Carga .env.local y .env si existen. Silenciosa: que falten es normal (en prod las var van en el entorno). */
export function cargarEnv(raiz: string = process.cwd()): void {
  for (const archivo of [".env.local", ".env"]) {
    const ruta = join(raiz, archivo);
    if (existsSync(ruta)) process.loadEnvFile(ruta);
  }
}
