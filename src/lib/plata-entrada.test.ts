// src/lib/plata-entrada.test.ts — que ningún importe se vuelva a leer mal.
//
// La misma falla apareció en tres campos distintos —abono, precio por hora, cobro, gasto— y las
// cuatro veces el síntoma fue el mismo: un importe mil veces menor, sin error. El test de
// comportamiento (que "4.500" son cuatro mil quinientos) ya vive con el parser. Este es el
// estructural: busca en los esquemas un importe leído con `coerce.number`, que es la forma que
// tenía el bug, y falla nombrando el archivo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { plataEnPesos } from "./plata-entrada.ts";

const RAIZ = join(import.meta.dirname, "..");

/** Los nombres de campo que son plata. Si mañana hay otro, se agrega acá. */
const CAMPOS_DE_PLATA = ["monto", "montoMensual", "precioHora", "precioMensual", "importe", "montoCent"];

function archivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return archivosTs(p);
    return p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}

test("ningún campo de plata se lee con coerce.number", () => {
  const culpables: string[] = [];
  for (const archivo of archivosTs(RAIZ)) {
    for (const linea of readFileSync(archivo, "utf8").split("\n")) {
      if (!linea.includes("coerce.number")) continue;
      const campo = linea.trim().split(":")[0]?.trim();
      if (campo && CAMPOS_DE_PLATA.includes(campo)) {
        culpables.push(`${archivo.replace(RAIZ, "src")}: ${linea.trim()}`);
      }
    }
  }
  assert.deepEqual(
    culpables,
    [],
    `Un importe leído con coerce.number lee "4.500" como 4.5. Usá plataEnPesos():\n${culpables.join("\n")}`,
  );
});

test("plataEnPesos respeta las reglas del número que se le pasa", () => {
  const soloPositivo = plataEnPesos(z.number().finite().positive().max(1000));
  assert.equal(soloPositivo.safeParse("120.000").success, false, "120.000 supera el máximo");
  assert.equal(soloPositivo.safeParse("0").success, false, "cero no es positivo");
  assert.equal(soloPositivo.parse("999"), 999);
});

test("un texto que no es plata se rechaza en vez de guardarse como NaN", () => {
  const esquema = plataEnPesos(z.number().finite().min(0).max(1_000_000));
  for (const basura of ["", "ocho mil", "abc"]) {
    assert.equal(esquema.safeParse(basura).success, false, basura);
  }
});
