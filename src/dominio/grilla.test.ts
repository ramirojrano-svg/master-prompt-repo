// src/dominio/grilla.test.ts — el layout de la grilla (§6.4 / §6.17).
// Los cuatro casos que el master exige: cluster de 15 solapados, bloque que empieza antes de la
// apertura, bloque que cruza la medianoche, y bloque de 15' (span mínimo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { filasTotales, MIN_SUBCOLS, rangoVisible, ubicarBloques, type BloqueEntrada, type RangoVisible } from "./grilla.ts";
import { instanteDeHoraLocal } from "./motor/zona.ts";

const AR = ["America", "Argentina", "Buenos_Aires"].join("/");
const FECHA = "2026-08-12";
const inicioDia = instanteDeHoraLocal(FECHA, "00:00", AR)!;

const R: RangoVisible = { inicioDia, aperturaMin: 8 * 60, cierreMin: 22 * 60, pasoMin: 30 };

function T(hm: string, fecha = FECHA) {
  return instanteDeHoraLocal(fecha, hm, AR)!;
}
function b(id: string, desde: string, hasta: string, columnaId = "sa1", fechaHasta = FECHA): BloqueEntrada {
  return { id, columnaId, inicio: T(desde), fin: T(hasta, fechaHasta) };
}

test("posición básica: 09:00-10:00 con apertura 08:00 y paso 30' => fila 3, span 2", () => {
  const [u] = ubicarBloques([b("a", "09:00", "10:00")], R);
  assert.equal(u!.fila, 3); // (60/30)+1
  assert.equal(u!.span, 2);
  assert.equal(u!.carril, 0);
});

test("bordes exactos NO comparten carril: 09-10 y 10-11 van los dos al carril 0", () => {
  const us = ubicarBloques([b("a", "09:00", "10:00"), b("b", "10:00", "11:00")], R);
  assert.deepEqual(us.map((u) => u.carril).sort(), [0, 0]);
});

test("solapados: cada uno toma un carril distinto", () => {
  const us = ubicarBloques([b("a", "09:00", "11:00"), b("b", "10:00", "12:00")], R);
  assert.deepEqual(us.map((u) => u.carril).sort(), [0, 1]);
});

test("§6.17 · cluster de 15 solapados: carriles crece sobre el mínimo y NADIE excede el grid", () => {
  const quince = Array.from({ length: 15 }, (_, k) => b(`x${k}`, "09:00", "12:00"));
  const us = ubicarBloques(quince, R);
  assert.equal(us.length, 15);
  const carriles = us[0]!.carriles;
  assert.equal(carriles, 15, "las subcolumnas se estiran al cluster (no 12 fijas)");
  // el bug que rompía la pantalla: pedir gridColumn más allá de las subcolumnas declaradas
  for (const u of us) assert.ok(u.carril < u.carriles, `carril ${u.carril} < carriles ${u.carriles}`);
  assert.deepEqual([...new Set(us.map((u) => u.carril))].sort((a, z) => a - z), Array.from({ length: 15 }, (_, k) => k));
});

test("con pocos bloques, las subcolumnas se mantienen en el mínimo", () => {
  const us = ubicarBloques([b("a", "09:00", "10:00")], R);
  assert.equal(us[0]!.carriles, MIN_SUBCOLS);
});

test("un bloque SOLO ocupa todo el ancho de la columna (no 1/12)", () => {
  const [u] = ubicarBloques([b("a", "09:00", "10:00")], R);
  assert.equal(u!.col, 1);
  assert.equal(u!.colSpan, u!.carriles, "sin solapamiento, el bloque usa la columna entera");
});

test("dos solapados se reparten la mitad cada uno, sin huecos ni desbordes", () => {
  const us = ubicarBloques([b("a", "09:00", "11:00"), b("b", "10:00", "12:00")], R);
  const [p, q] = [...us].sort((x, y) => x.col - y.col);
  assert.equal(p!.col, 1);
  assert.equal(p!.colSpan, p!.carriles / 2);
  assert.equal(q!.col, p!.carriles / 2 + 1);
  assert.equal(q!.col + q!.colSpan - 1, q!.carriles, "el último llega justo al borde");
});

test("tres solapados: tercios, y ninguno se sale del grid", () => {
  const us = ubicarBloques([b("a", "09:00", "12:00"), b("b", "09:30", "12:00"), b("c", "10:00", "12:00")], R);
  assert.equal(us.length, 3);
  for (const u of us) {
    assert.ok(u.col >= 1 && u.col + u.colSpan - 1 <= u.carriles, `col ${u.col}+${u.colSpan} dentro de ${u.carriles}`);
  }
});

test("un cluster de 15 no desborda el ancho declarado", () => {
  const us = ubicarBloques(Array.from({ length: 15 }, (_, k) => b(`x${k}`, "09:00", "12:00")), R);
  for (const u of us) assert.ok(u.col + u.colSpan - 1 <= u.carriles);
});

test("§6.17 · bloque que empieza ANTES de la apertura: se clampea a la fila 1", () => {
  const us = ubicarBloques([b("a", "06:00", "09:00")], R); // apertura 08:00
  assert.equal(us[0]!.fila, 1, "nunca fila 0 ni negativa");
  assert.equal(us[0]!.span, 2, "solo la porción visible (08:00-09:00)");
  assert.equal(us[0]!.recortadoArriba, true);
});

test("§6.17 · bloque que cruza la medianoche: se recorta al cierre", () => {
  const us = ubicarBloques([b("a", "23:30", "01:00", "sa1", "2026-08-13")], { ...R, cierreMin: 24 * 60 });
  assert.equal(us[0]!.recortadoAbajo, true);
  const fin = us[0]!.fila + us[0]!.span - 1;
  assert.ok(fin <= filasTotales({ ...R, cierreMin: 24 * 60 }), "no desborda las filas del grid");
});

test("§6.17 · bloque de 15' con paso 30': span mínimo 1 (nunca 0)", () => {
  const us = ubicarBloques([b("a", "08:30", "08:45")], R);
  assert.equal(us[0]!.span, 1);
});

test("un bloque enteramente fuera del rango visible no se ubica", () => {
  assert.deepEqual(ubicarBloques([b("a", "05:00", "06:00")], R), []);
});

test("las subcolumnas se calculan POR COLUMNA (una sala llena no infla a la otra)", () => {
  const bloques = [
    ...Array.from({ length: 14 }, (_, k) => b(`a${k}`, "09:00", "12:00", "sa1")),
    b("b", "09:00", "10:00", "sa2"),
  ];
  const us = ubicarBloques(bloques, R);
  assert.equal(us.find((u) => u.columnaId === "sa1")!.carriles, 14);
  assert.equal(us.find((u) => u.columnaId === "sa2")!.carriles, MIN_SUBCOLS);
});

test("paso 0 (config rota) cae al default y no divide por cero", () => {
  const us = ubicarBloques([b("a", "09:00", "10:00")], { ...R, pasoMin: 0 });
  assert.ok(Number.isFinite(us[0]!.fila) && us[0]!.span >= 1);
});

test("rangoVisible: unión de aperturas y bloques con una hora de margen", () => {
  const r = rangoVisible({ aperturas: [{ desdeMin: 8 * 60, hastaMin: 22 * 60 }], bloques: [{ desdeMin: 7 * 60, hastaMin: 23 * 60 }] });
  assert.equal(r.aperturaMin, 6 * 60);
  assert.equal(r.cierreMin, 24 * 60);
});

test("rangoVisible sin datos cae al default 08-20", () => {
  assert.deepEqual(rangoVisible({ aperturas: [], bloques: [] }), { aperturaMin: 480, cierreMin: 1200 });
});
