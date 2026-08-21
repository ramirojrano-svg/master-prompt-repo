// src/dominio/habiles.test.ts — cuándo salen las liquidaciones.
//
// De esto depende que el aviso llegue un día en que alguien lo lea. Un error acá no rompe nada:
// simplemente el mail sale un domingo, o no sale.

import { test } from "node:test";
import assert from "node:assert/strict";
import { esUltimoHabil, ultimoHabilDelMes } from "./habiles.ts";

test("cuando el mes termina entre semana, es el último día", () => {
  // 31/08/2026 es lunes.
  assert.equal(ultimoHabilDelMes("2026-08"), "2026-08-31");
});

test("cuando el mes termina en domingo, retrocede al viernes", () => {
  // 31/05/2026 es domingo ⇒ viernes 29.
  assert.equal(ultimoHabilDelMes("2026-05"), "2026-05-29");
});

test("cuando el mes termina en sábado, retrocede al viernes", () => {
  // 31/01/2026 es sábado ⇒ viernes 30.
  assert.equal(ultimoHabilDelMes("2026-01"), "2026-01-30");
});

test("febrero de un año bisiesto usa el 29 si es hábil", () => {
  // 29/02/2028 es martes.
  assert.equal(ultimoHabilDelMes("2028-02"), "2028-02-29");
});

test("febrero común no inventa un día 29", () => {
  // 28/02/2026 es sábado ⇒ viernes 27.
  assert.equal(ultimoHabilDelMes("2026-02"), "2026-02-27");
});

test("esUltimoHabil contesta por la fecha entera", () => {
  assert.equal(esUltimoHabil("2026-08-31"), true);
  assert.equal(esUltimoHabil("2026-08-30"), false, "domingo 30 no es el último hábil");
  assert.equal(esUltimoHabil("2026-05-31"), false, "domingo: el hábil fue el 29");
  assert.equal(esUltimoHabil("2026-05-29"), true);
});
