// src/dominio/motor/comparaciones-de-rango.test.ts — §4.2
// Ninguna comparación de rango con `<=`/`>=` fuera de sus casas sancionadas:
//  - intervalos.ts: seSolapan() (con `<`) y contiene() (la única contención con `<=`).
//  - horarios.ts: solapanHora() (HH:MM, con `<`).
// Con `<=`, una reserva 15:00-16:00 y otra 16:00-17:00 se detectan como choque y la agenda
// queda con la mitad de los huecos inutilizables, sin un solo error visible.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const SRC = join(import.meta.dirname, "..", "..");
const CASAS_SANCIONADAS = new Set(["intervalos.ts", "horarios.ts"]);

function fuentes(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...fuentes(p));
    else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

/** Líneas con comentarios borrados (preserva la cuenta): el lint mira código, no prosa. */
function codigoPorLinea(txt: string): string[] {
  let enBloque = false;
  return txt.split("\n").map((linea) => {
    let out = linea;
    if (enBloque) {
      const cierre = out.indexOf("*/");
      if (cierre === -1) return "";
      out = out.slice(cierre + 2);
      enBloque = false;
    }
    out = out.replace(/\/\*[\s\S]*?\*\//g, "");
    const abre = out.indexOf("/*");
    if (abre !== -1) {
      enBloque = true;
      out = out.slice(0, abre);
    }
    return out.replace(/(^|[^:])\/\/.*$/, "$1");
  });
}

// `<=`/`>=` pegado a un extremo de rango, en cualquier orden; y `.getTime()` comparado con <=/>=.
const PROP = /(?:(<=|>=)[^;\n]*\.(?:inicio|fin|desde|hasta)\b)|(?:\.(?:inicio|fin|desde|hasta)\b[^;\n]*(<=|>=))/;
const GETTIME = /\.getTime\(\)\s*(?:<=|>=)/;

test("§4.2 · no hay comparaciones de rango sueltas fuera de intervalos.ts / horarios.ts", () => {
  const hallazgos: string[] = [];
  for (const archivo of fuentes(SRC)) {
    if (CASAS_SANCIONADAS.has(basename(archivo))) continue;
    codigoPorLinea(readFileSync(archivo, "utf8")).forEach((linea, i) => {
      if (PROP.test(linea) || GETTIME.test(linea)) {
        hallazgos.push(`${archivo}:${i + 1}\n    > ${linea.trim()}`);
      }
    });
  }
  assert.deepEqual(hallazgos, [], `\nUsá seSolapan()/contiene() de intervalos.ts:\n${hallazgos.join("\n")}\n`);
});
