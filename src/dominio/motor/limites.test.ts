// src/dominio/motor/limites.test.ts — el acoplamiento invisible del lookback (§4.7.1)
import { test } from "node:test";
import assert from "node:assert/strict";
import { BUFFER_MAX_MIN, DURACION_MAX_MIN, LOOKBACK_MIN, PASO_DEFAULT, pasoValido } from "./limites.ts";

test("LOOKBACK_MIN >= DURACION_MAX_MIN + BUFFER_MAX_MIN", () => {
  // Si alguien sube el máximo de duración y no el lookback, una reserva en curso se vuelve
  // invisible para el cálculo de solapamiento y vuelve la doble reserva.
  assert.ok(LOOKBACK_MIN >= DURACION_MAX_MIN + BUFFER_MAX_MIN);
});

test("pasoValido: la lista es cerrada; basura cae al default, nunca a 0", () => {
  assert.equal(pasoValido(0), PASO_DEFAULT);
  assert.equal(pasoValido(7), PASO_DEFAULT);
  assert.equal(pasoValido("30"), PASO_DEFAULT);
  assert.equal(pasoValido(null), PASO_DEFAULT);
  assert.equal(pasoValido(30), 30);
  assert.equal(pasoValido(15), 15);
});
