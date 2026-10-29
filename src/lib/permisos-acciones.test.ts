// src/lib/permisos-acciones.test.ts — que ninguna escritura se autorice con un permiso de mirar.
//
// `definirAccion` envuelve ESCRITURAS: no hay una sola lectura declarada así. Entonces vale una
// regla simple y verificable: ninguna acción puede pedir un permiso de la lista de lectura.
//
// El agujero que cierra es real y estuvo abierto. Cargar y anular gastos pedían
// `finanzas.ver.agregada`, un permiso de lectura que tiene el rol de soporte —documentado como
// "SOLO lectura, nunca escribe"—. Soporte podía cargar un gasto y mover el resultado del centro.
// El test de la matriz de permisos no podía verlo: la matriz estaba bien; lo que estaba mal era
// qué permiso pedía la acción. Esa unión no la miraba nadie.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PERMISOS_DE_LECTURA, type Permiso } from "./permisos.ts";

const SERVICIOS = join(import.meta.dirname, "..", "servicios");

function archivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return archivosTs(p);
    return p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}

test("ninguna acción se autoriza con un permiso de solo lectura", () => {
  const culpables: string[] = [];
  for (const archivo of archivosTs(SERVICIOS)) {
    const texto = readFileSync(archivo, "utf8");
    for (const [, permiso] of texto.matchAll(/permiso:\s*"([a-z.]+)"/g)) {
      if (PERMISOS_DE_LECTURA.has(permiso as Permiso)) {
        culpables.push(`${archivo.split("/src/")[1]}: permiso: "${permiso}"`);
      }
    }
  }
  assert.deepEqual(
    culpables,
    [],
    `Una acción escribe: autorizarla con un permiso de mirar se la da a todo el que podía mirar.\n${culpables.join("\n")}`,
  );
});

test("hay permisos de lectura declarados, o el test de arriba no prueba nada", () => {
  // Si alguien vacía la lista, el test anterior pasa siempre y deja de avisar.
  assert.ok(PERMISOS_DE_LECTURA.size >= 5);
});
