// src/dominio/paises.test.ts — §7.19: un test impide agregar un país a medias.
import { test } from "node:test";
import assert from "node:assert/strict";
import { esPaisSoportado, monedaDePais, PAISES, zonaDePais } from "./paises.ts";

function tzValida(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

test("todo país del registro está COMPLETO: moneda ISO, tz IANA real, prefijo, frase no vacía", () => {
  for (const [pais, info] of Object.entries(PAISES)) {
    assert.match(info.moneda, /^[A-Z]{3}$/, `${pais}: moneda ISO 4217`);
    assert.ok(tzValida(info.tz), `${pais}: tz IANA válida (${info.tz})`);
    assert.ok(Number.isInteger(info.prefijo) && info.prefijo > 0, `${pais}: prefijo numérico`);
    assert.ok(info.fraseLegal.trim().length > 0, `${pais}: frase legal no vacía`);
  }
});

test("zonaDePais deriva la zona; país no soportado => null", () => {
  assert.equal(zonaDePais("AR"), "America/Argentina/Buenos_Aires");
  assert.equal(zonaDePais("MX"), "America/Mexico_City");
  assert.equal(zonaDePais("XX"), null);
  assert.equal(monedaDePais("CL"), "CLP");
  assert.equal(esPaisSoportado("AR"), true);
  assert.equal(esPaisSoportado("US"), false);
});
