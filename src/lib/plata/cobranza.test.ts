// src/lib/plata/cobranza.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoCobranza } from "./cobranza.ts";

const ahora = new Date("2026-08-12T12:00:00Z");
const base = { deudaVencidaCent: 10_000n, diasDesdeVencimiento: 0, excepcionHasta: null, ahora };

test("sin deuda vencida => al_dia", () => {
  assert.equal(estadoCobranza({ ...base, deudaVencidaCent: 0n }), "al_dia");
});

test("deuda dentro de la gracia (<=7 días) => gracia", () => {
  assert.equal(estadoCobranza({ ...base, diasDesdeVencimiento: 3 }), "gracia");
});

test("deuda entre 8 y 30 días => suspendido", () => {
  assert.equal(estadoCobranza({ ...base, diasDesdeVencimiento: 15 }), "suspendido");
});

test("deuda de más de 30 días => baja", () => {
  assert.equal(estadoCobranza({ ...base, diasDesdeVencimiento: 40 }), "baja");
});

test("excepción vigente del operador manda: al_dia aunque deba", () => {
  const excepcionHasta = new Date("2026-08-20T00:00:00Z");
  assert.equal(estadoCobranza({ ...base, diasDesdeVencimiento: 40, excepcionHasta }), "al_dia");
});
