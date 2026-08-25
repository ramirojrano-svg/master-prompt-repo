// src/lib/acciones-serializables.test.ts — que una acción de servidor no capture una función.
//
// Este archivo existe por un bug que rompió el cierre de mes y que NINGUNA otra capa vio.
//
// Una server action declarada adentro de un componente es una clausura: Next serializa todo lo
// que la función toma de su entorno para poder mandárselo al cliente. Los strings y los números
// viajan; una FUNCIÓN no. Cuando `cerrarUno` empezó a llamar a un ayudante declarado adentro del
// mismo componente, la pantalla entera pasó a morir con "Functions cannot be passed directly to
// Client Components", justo al apretar Cerrar.
//
// Por qué hace falta un chequeo estático y no una prueba más:
//  · Las pruebas de servicio no lo ven: el servicio de cierre funciona perfecto, el error es del
//    render.
//  · `npm run build` no lo ve: compila sin quejarse, revienta en tiempo de ejecución.
//  · Las pruebas de navegador contra `npm run dev` TAMPOCO lo ven: en desarrollo Next se recupera
//    y devuelve 200. Solo se cae en producción — es decir, se descubre con la app publicada.
//
// El arreglo es siempre el mismo y es de una línea: mover el ayudante a nivel de MÓDULO. Ahí deja
// de ser algo capturado y pasa a ser una referencia del módulo, que no se serializa.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(import.meta.dirname, "..", "..", "app");

function tsxDe(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) salida.push(...tsxDe(ruta));
    else if (entrada.endsWith(".tsx") || entrada.endsWith(".ts")) salida.push(ruta);
  }
  return salida;
}

/** Los bloques `function ... { ... }` de primer nivel DENTRO del componente (indentados con 2). */
type Bloque = { nombre: string; cuerpo: string; esAccion: boolean };

function bloquesDelComponente(fuente: string): Bloque[] {
  const bloques: Bloque[] = [];
  // Una declaración indentada exactamente con dos espacios: es el nivel de adentro del componente.
  const re = /^ {2}(?:async )?function (\w+)\s*\([^)]*\)[^{]*\{$/gm;
  for (let m = re.exec(fuente); m; m = re.exec(fuente)) {
    // El cuerpo llega hasta el primer `\n  }` — el cierre a la misma indentación.
    const desde = m.index + m[0].length;
    const hasta = fuente.indexOf("\n  }", desde);
    if (hasta === -1) continue;
    const cuerpo = fuente.slice(desde, hasta);
    bloques.push({ nombre: m[1]!, cuerpo, esAccion: /^\s*["']use server["']/m.test(cuerpo) });
  }
  return bloques;
}

test("ninguna acción de servidor captura una función declarada en el componente", () => {
  const problemas: string[] = [];

  for (const archivo of tsxDe(RAIZ)) {
    const fuente = readFileSync(archivo, "utf8");
    if (!fuente.includes("use server")) continue;

    const bloques = bloquesDelComponente(fuente);
    const acciones = bloques.filter((b) => b.esAccion);
    if (acciones.length === 0) continue;

    // Los ayudantes: funciones del componente que NO son acciones. Capturarlas es el bug.
    const ayudantes = bloques.filter((b) => !b.esAccion).map((b) => b.nombre);
    // Y los ayudantes escritos como `const x = (...) => ...`, que se serializan igual de mal.
    const flechas = [...fuente.matchAll(/^ {2}const (\w+) = (?:async )?\([^)]*\)\s*(?::[^=]+)?=>/gm)].map((m) => m[1]!);

    for (const accion of acciones) {
      for (const ayudante of [...ayudantes, ...flechas]) {
        if (new RegExp(`\\b${ayudante}\\s*\\(`).test(accion.cuerpo)) {
          problemas.push(
            `${archivo.slice(archivo.indexOf("app"))}: la acción "${accion.nombre}" usa "${ayudante}", ` +
              `declarada dentro del componente. Movela a nivel de módulo.`,
          );
        }
      }
    }
  }

  assert.deepEqual(problemas, [], "\n" + problemas.join("\n"));
});
