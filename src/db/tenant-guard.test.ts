// src/db/tenant-guard.test.ts — que la red cubra todo lo que puede caerse.
//
// El guard de tenant inyecta `operadorId` en las consultas con `where` libre. Es una RED: lo que
// sostiene el sistema es el `operadorId` explícito que ponen los servicios. Pero una red con un
// agujero es peor que ninguna, porque nadie mira debajo de ella.
//
// Esta prueba lee el esquema de Prisma y exige que todo modelo con columna `operadorId` esté en
// el conjunto. Así un modelo nuevo no puede nacer descubierto: quien lo agregue va a ver fallar
// esto antes de escribir la primera consulta.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MODELOS_CON_TENANT } from "./prisma.ts";

/** Los modelos del esquema que tienen una columna `operadorId`. */
function modelosConOperadorId(): string[] {
  const esquema = readFileSync(join(import.meta.dirname, "..", "..", "prisma", "schema.prisma"), "utf8");
  const encontrados: string[] = [];
  let actual: string | null = null;

  for (const linea of esquema.split("\n")) {
    const inicio = /^model\s+(\w+)\s*\{/.exec(linea);
    if (inicio) {
      actual = inicio[1]!;
      continue;
    }
    if (linea.startsWith("}")) {
      actual = null;
      continue;
    }
    // La columna, no la relación ni el índice: `operadorId String` al principio de la línea.
    if (actual && /^\s*operadorId\s+String/.test(linea)) encontrados.push(actual);
  }
  return encontrados;
}

test("todo modelo con operadorId está cubierto por el guard", () => {
  const sinCubrir = modelosConOperadorId().filter((m) => !MODELOS_CON_TENANT.has(m));
  assert.deepEqual(
    sinCubrir,
    [],
    `Estos modelos tienen operadorId y el guard no los mira: ${sinCubrir.join(", ")}. ` +
      "Agregalos a TENANT_MODELS en src/db/prisma.ts.",
  );
});

test("el guard no vigila modelos que no existen", () => {
  // Un nombre mal escrito en el conjunto no rompe nada, y por eso mismo pasaría inadvertido para
  // siempre — creyendo que hay una red donde no la hay.
  const conColumna = new Set(modelosConOperadorId());
  const sobrantes = [...MODELOS_CON_TENANT].filter((m) => !conColumna.has(m));
  assert.deepEqual(sobrantes, [], `Estos están en el guard y no tienen operadorId: ${sobrantes.join(", ")}`);
});

test("el conjunto no quedó vacío por un error de importación", () => {
  assert.ok(MODELOS_CON_TENANT.size >= 13);
});
