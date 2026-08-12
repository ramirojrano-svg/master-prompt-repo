// src/dominio/motor/guardarrailes.test.ts — T-15 (§15) / Capa A (§3.3)
// Lint de código FUENTE sobre todo src/ (excluidos los *.test.ts, que usan zonas como DATO).
// La Capa A sola da falsa seguridad; la Capa B (comportamiento con dos zonas) vive en zona.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// src/ es dos niveles arriba de este archivo (src/dominio/motor -> src).
const SRC = join(import.meta.dirname, "..", "..");

// El ÚNICO archivo donde las zonas IANA son literales legítimos: el registro país->zona (§7.19).
// Ahí la zona se DERIVA; en el resto del código entra por parámetro.
const REGISTRO_DE_ZONAS = new Set(["paises.ts"]);

function fuentes(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...fuentes(p));
    else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".test.ts") && !REGISTRO_DE_ZONAS.has(ent.name)) out.push(p);
  }
  return out;
}

/**
 * Devuelve las líneas del archivo con los comentarios borrados (preservando la cuenta de
 * líneas). El lint mira CÓDIGO, no prosa: una zona de ejemplo en un docstring es legítima;
 * un offset fijo en un string de código, no — y ese sigue quedando visible.
 */
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
    out = out.replace(/\/\*[\s\S]*?\*\//g, ""); // bloque que abre y cierra en la misma línea
    const abre = out.indexOf("/*");
    if (abre !== -1) {
      enBloque = true;
      out = out.slice(0, abre);
    }
    return out.replace(/(^|[^:])\/\/.*$/, "$1"); // comentario de línea, sin romper http://
  });
}

// Cada patrón prohibido con el motivo por el que muerde (§4.3.1).
const PROHIBIDOS: { re: RegExp; motivo: string }[] = [
  { re: /America\//, motivo: "zona IANA clavada: la tz entra por parámetro, nunca hardcodeada" },
  { re: /[-+]\d{2}:00['"`]/, motivo: "offset fijo en string (ej. '-03:00'): rompe con DST" },
  { re: /\b24\s*\*\s*3600\b/, motivo: "'24 * 3600' para el día: el día de DST dura 23 o 25 h" },
  { re: /\b7\s*\*\s*24\b/, motivo: "'7 * 24' para la semana: la ocurrencia post-DST se corre una hora" },
];

test("T-15 · ningún archivo fuente tiene zonas clavadas ni offsets fijos", () => {
  const hallazgos: string[] = [];
  for (const archivo of fuentes(SRC)) {
    const lineas = codigoPorLinea(readFileSync(archivo, "utf8"));
    lineas.forEach((linea, i) => {
      for (const { re, motivo } of PROHIBIDOS) {
        if (re.test(linea)) {
          hallazgos.push(`${archivo}:${i + 1} — ${motivo}\n    > ${linea.trim()}`);
        }
      }
    });
  }
  assert.deepEqual(hallazgos, [], `\n${hallazgos.join("\n")}\n`);
});
