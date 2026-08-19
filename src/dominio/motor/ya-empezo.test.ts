// src/dominio/motor/ya-empezo.test.ts — "el turno ya empezó".
// Decide si un profesional puede cancelar o mover su turno, así que el borde importa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { yaEmpezo } from "./intervalos.ts";

const T = (iso: string) => new Date(iso);
const AHORA = T("2026-08-19T15:00:00.000Z");

test("lo de ayer ya empezó", () => {
  assert.equal(yaEmpezo(T("2026-08-18T10:00:00.000Z"), AHORA), true);
});

test("lo de mañana no", () => {
  assert.equal(yaEmpezo(T("2026-08-20T10:00:00.000Z"), AHORA), false);
});

test("el borde EXACTO cuenta como empezado: el consultorio ya está ocupado", () => {
  assert.equal(yaEmpezo(AHORA, AHORA), true);
});

test("un milisegundo antes de empezar todavía se puede cancelar", () => {
  assert.equal(yaEmpezo(T("2026-08-19T15:00:00.001Z"), AHORA), false);
});
