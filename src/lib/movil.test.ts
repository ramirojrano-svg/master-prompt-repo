// src/lib/movil.test.ts — la detección de teléfono.
// Decide con qué vista abre la agenda, así que lo que importa es que no confunda una computadora
// con un teléfono (abriría el mes donde el día es mejor) ni al revés.
import { test } from "node:test";
import assert from "node:assert/strict";
import { esMovil } from "./movil.ts";

const UA = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
};

test("teléfonos", () => {
  assert.equal(esMovil(UA.iphone), true);
  assert.equal(esMovil(UA.android), true);
  assert.equal(esMovil(UA.ipad), true, "la tableta también: siete columnas tampoco entran cómodas");
});

test("computadoras", () => {
  assert.equal(esMovil(UA.mac), false);
  assert.equal(esMovil(UA.windows), false, "Chrome de escritorio dice Safari en el user-agent: no puede confundirse");
});

test("sin user-agent no se asume teléfono: el default de siempre es el día", () => {
  assert.equal(esMovil(null), false);
  assert.equal(esMovil(undefined), false);
  assert.equal(esMovil(""), false);
});
