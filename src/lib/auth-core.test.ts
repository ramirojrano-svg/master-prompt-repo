// src/lib/auth-core.test.ts — la parte pura (sesionVigente); autorizar se prueba contra DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sesionVigente } from "./auth-core.ts";

test("sesionVigente: fila borrada (sv null) => inválida, fail-closed", () => {
  assert.equal(sesionVigente(3, null), false);
});

test("sesionVigente: versión distinta (baja/cambio de rol) => inválida", () => {
  assert.equal(sesionVigente(2, 3), false);
});

test("sesionVigente: misma versión => válida", () => {
  assert.equal(sesionVigente(3, 3), true);
});
