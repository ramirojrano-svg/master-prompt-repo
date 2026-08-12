// src/lib/plata/membresia.test.ts — el único predicado de vigencia (§4.12)
import { test } from "node:test";
import assert from "node:assert/strict";
import { membresiaVigente } from "./membresia.ts";

const ahora = new Date("2026-08-12T12:00:00Z");
const futuro = new Date("2026-09-01T00:00:00Z");
const pasado = new Date("2026-08-01T00:00:00Z");

test("activa + vigenteHasta futuro => vigente", () => {
  assert.equal(membresiaVigente({ estado: "activa", vigenteHasta: futuro }, ahora), true);
});

test("vigenteHasta null => NO vigente (fail-closed)", () => {
  assert.equal(membresiaVigente({ estado: "activa", vigenteHasta: null }, ahora), false);
});

test("vigenteHasta en el pasado => NO vigente aunque el estado diga activa", () => {
  assert.equal(membresiaVigente({ estado: "activa", vigenteHasta: pasado }, ahora), false);
});

test("estado no activa (suspendida/baja) => NO vigente aunque la fecha sea futura", () => {
  assert.equal(membresiaVigente({ estado: "suspendida", vigenteHasta: futuro }, ahora), false);
  assert.equal(membresiaVigente({ estado: "baja", vigenteHasta: futuro }, ahora), false);
});
