// src/dominio/motor/horarios.test.ts — T-16…T-19 (§15)
import { test } from "node:test";
import assert from "node:assert/strict";
import { HORARIO_DEFAULT, parseHorarios, resumenHorarios, sanitizarHorarios } from "./horarios.ts";
import type { Dia, Franja, HorarioSemanal } from "./tipos.ts";

const DIAS: Dia[] = [0, 1, 2, 3, 4, 5, 6];

test("T-16 · blob roto cae a HORARIO_DEFAULT, no crashea, con las 7 keys", () => {
  const h = parseHorarios("{ no es json valido");
  assert.deepEqual(h, HORARIO_DEFAULT);
  for (const d of DIAS) assert.ok(Array.isArray(h[d]), `día ${d} tiene que ser un array`);
});

test("T-16b · valor no-objeto también cae al default", () => {
  assert.deepEqual(parseHorarios(42), HORARIO_DEFAULT);
  assert.deepEqual(parseHorarios(null), HORARIO_DEFAULT);
});

test("T-17 · solapes internos: se queda con el primero de cada choque", () => {
  const h = sanitizarHorarios({ "1": [{ desde: "09:00", hasta: "12:00" }, { desde: "11:00", hasta: "14:00" }] });
  assert.deepEqual(h[1], [{ desde: "09:00", hasta: "12:00" }]);
});

test("T-18 · el tope por día se aplica DESPUÉS de validar (4 válidos al final de 100)", () => {
  const basura = Array.from({ length: 96 }, () => ({ desde: "no", hasta: "va" }));
  const validas: Franja[] = [
    { desde: "08:00", hasta: "09:00" },
    { desde: "10:00", hasta: "11:00" },
    { desde: "12:00", hasta: "13:00" },
    { desde: "14:00", hasta: "15:00" },
  ];
  const h = sanitizarHorarios({ "3": [...basura, ...validas] });
  assert.deepEqual(h[3], validas); // los 4 válidos sobreviven, no 0
});

test("T-18b · con más de 4 franjas válidas, se recorta a 4", () => {
  const seis: Franja[] = Array.from({ length: 6 }, (_, k) => ({
    desde: `${String(8 + k).padStart(2, "0")}:00`,
    hasta: `${String(8 + k).padStart(2, "0")}:30`,
  }));
  const h = sanitizarHorarios({ "2": seis });
  assert.equal(h[2].length, 4);
});

test("T-19 · resumen agrupa días consecutivos con el mismo horario", () => {
  const franja: Franja[] = [{ desde: "09:00", hasta: "20:00" }];
  const h: HorarioSemanal = { 0: [], 1: franja, 2: franja, 3: franja, 4: franja, 5: franja, 6: [{ desde: "09:00", hasta: "13:00" }] };
  assert.equal(resumenHorarios(h), "Lun a Vie 09:00-20:00 · Sáb 09:00-13:00");
});

test("resumen de un solo día no dice 'a'", () => {
  const h: HorarioSemanal = { 0: [], 1: [], 2: [], 3: [{ desde: "08:00", hasta: "12:00" }], 4: [], 5: [], 6: [] };
  assert.equal(resumenHorarios(h), "Mié 08:00-12:00");
});
