// src/dominio/motor/intervalos.test.ts — T-01…T-06 (§15)
import { test } from "node:test";
import assert from "node:assert/strict";
import { restar, restarTodos, seSolapan } from "./intervalos.ts";
import type { Intervalo } from "./tipos.ts";

// Intervalo desde dos horas de pared del mismo día UTC (la zona no importa acá).
function iv(desde: string, hasta: string): Intervalo {
  return {
    inicio: new Date(`2026-08-12T${desde}:00Z`),
    fin: new Date(`2026-08-12T${hasta}:00Z`),
  };
}

// Compara una lista de intervalos por sus horas 'HH:MM' UTC, para asserts legibles.
function comoHoras(is: Intervalo[]): [string, string][] {
  return is.map((i) => [i.inicio.toISOString().slice(11, 16), i.fin.toISOString().slice(11, 16)]);
}

test("T-01 · bordes exactos NO chocan [09,10) vs [10,11)", () => {
  assert.equal(seSolapan(iv("09:00", "10:00"), iv("10:00", "11:00")), false);
});

test("T-02 · un minuto compartido SÍ choca [09,10) vs [09:59,11)", () => {
  assert.equal(seSolapan(iv("09:00", "10:00"), iv("09:59", "11:00")), true);
});

test("T-03 · contención total choca en ambas direcciones", () => {
  const grande = iv("09:00", "12:00");
  const chico = iv("10:00", "11:00");
  assert.equal(seSolapan(grande, chico), true);
  assert.equal(seSolapan(chico, grande), true);
});

test("T-04 · restar parte por el medio [09,13) - [10,11) => [[09,10),[11,13)]", () => {
  assert.deepEqual(comoHoras(restar(iv("09:00", "13:00"), iv("10:00", "11:00"))), [
    ["09:00", "10:00"],
    ["11:00", "13:00"],
  ]);
});

test("T-05 · restar sin intersección devuelve el original", () => {
  assert.deepEqual(comoHoras(restar(iv("09:00", "10:00"), iv("11:00", "12:00"))), [["09:00", "10:00"]]);
});

test("T-06 · restar con contención total => []", () => {
  assert.deepEqual(restar(iv("10:00", "11:00"), iv("09:00", "12:00")), []);
});

test("restarTodos aplica cada corte en cadena", () => {
  const libre = restarTodos([iv("08:00", "20:00")], [iv("10:00", "11:00"), iv("14:00", "15:00")]);
  assert.deepEqual(comoHoras(libre), [
    ["08:00", "10:00"],
    ["11:00", "14:00"],
    ["15:00", "20:00"],
  ]);
});
