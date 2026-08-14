// src/dominio/repeticion.test.ts — los bordes del calendario, que son donde esto se rompe.

import { test } from "node:test";
import assert from "node:assert/strict";
import { esRepeticion, etiquetaDeRepeticion, fechasDeSerie, OCURRENCIAS_MAX } from "./repeticion.ts";

test("sin repetición: una sola fecha, la elegida", () => {
  assert.deepEqual(fechasDeSerie("2026-08-14", "no", 10), ["2026-08-14"]);
});

test("diaria: días corridos, cruzando el fin de mes", () => {
  assert.deepEqual(fechasDeSerie("2026-08-30", "diaria", 4), ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
});

test("semanal: el mismo día de la semana, cruzando el fin de año", () => {
  const f = fechasDeSerie("2026-12-25", "semanal", 3); // viernes
  assert.deepEqual(f, ["2026-12-25", "2027-01-01", "2027-01-08"]);
});

test("hábiles: saltea sábado y domingo", () => {
  // Jueves 13 → viernes 14 → lunes 17 → martes 18.
  assert.deepEqual(fechasDeSerie("2026-08-13", "habiles", 4), ["2026-08-13", "2026-08-14", "2026-08-17", "2026-08-18"]);
});

test("hábiles arrancando un SÁBADO: la primera ocurrencia es el lunes", () => {
  // Empezar en fin de semana no puede devolver el sábado: no es un día hábil.
  assert.deepEqual(fechasDeSerie("2026-08-15", "habiles", 2), ["2026-08-17", "2026-08-18"]);
});

test("mensual es 'el segundo viernes', NO 'el día 14'", () => {
  // 2026-08-14 es el segundo viernes de agosto. Los siguientes segundos viernes NO son un 14.
  const f = fechasDeSerie("2026-08-14", "mensual", 4);
  assert.deepEqual(f, ["2026-08-14", "2026-09-11", "2026-10-09", "2026-11-13"]);
});

test("mensual: el primer día del mes que cae en ese día de la semana", () => {
  // 2026-03-02 es el PRIMER lunes de marzo.
  assert.deepEqual(fechasDeSerie("2026-03-02", "mensual", 3), ["2026-03-02", "2026-04-06", "2026-05-04"]);
});

test("mensual: un QUINTO viernes saltea los meses que no lo tienen, sin gastar cupo", () => {
  // 2026-01-30 es el quinto viernes de enero. Febrero, marzo, abril y junio de 2026 tienen solo
  // cuatro viernes: se saltean enteros, y las siguientes ocurrencias son mayo y julio.
  const f = fechasDeSerie("2026-01-30", "mensual", 3);
  assert.deepEqual(f, ["2026-01-30", "2026-05-29", "2026-07-31"]);
  assert.equal(f.length, 3, "las tres ocurrencias pedidas se entregan igual, salteando meses");
});

test("anual: el mismo día y mes", () => {
  assert.deepEqual(fechasDeSerie("2026-08-14", "anual", 3), ["2026-08-14", "2027-08-14", "2028-08-14"]);
});

test("anual sobre un 29 de febrero: solo los años bisiestos", () => {
  // 2028 y 2032 son bisiestos; 2029, 2030 y 2031 no existen como 29/2 y se saltean.
  assert.deepEqual(fechasDeSerie("2028-02-29", "anual", 2), ["2028-02-29", "2032-02-29"]);
});

test("la primera ocurrencia SIEMPRE es la fecha elegida (salvo hábiles en fin de semana)", () => {
  for (const r of ["diaria", "semanal", "mensual", "anual"] as const) {
    assert.equal(fechasDeSerie("2026-08-14", r, 3)[0], "2026-08-14", r);
  }
});

test("la cantidad se respeta y está topeada", () => {
  assert.equal(fechasDeSerie("2026-08-14", "semanal", 12).length, 12);
  assert.equal(fechasDeSerie("2026-08-14", "diaria", 999).length, OCURRENCIAS_MAX);
  assert.equal(fechasDeSerie("2026-08-14", "semanal", 0).length, 1, "pedir cero igual da la ocurrencia elegida");
});

test("una fecha que no existe no genera nada", () => {
  assert.deepEqual(fechasDeSerie("2026-02-30", "diaria", 3), []);
  assert.deepEqual(fechasDeSerie("no-es-fecha", "diaria", 3), []);
  assert.deepEqual(fechasDeSerie("2026-13-01", "semanal", 2), []);
});

test("las etiquetas se arman desde la fecha, como en un calendario de verdad", () => {
  const f = "2026-08-14"; // segundo viernes de agosto
  assert.equal(etiquetaDeRepeticion(f, "no"), "No se repite");
  assert.equal(etiquetaDeRepeticion(f, "semanal"), "Cada semana, el viernes");
  assert.equal(etiquetaDeRepeticion(f, "mensual"), "Todos los meses, el segundo viernes");
  assert.equal(etiquetaDeRepeticion(f, "anual"), "Anualmente, el 14 de agosto");
  assert.equal(etiquetaDeRepeticion(f, "habiles"), "Todos los días hábiles (de lunes a viernes)");
});

test("la etiqueta mensual usa el ordinal correcto según la semana", () => {
  assert.equal(etiquetaDeRepeticion("2026-08-07", "mensual"), "Todos los meses, el primer viernes");
  assert.equal(etiquetaDeRepeticion("2026-08-21", "mensual"), "Todos los meses, el tercer viernes");
  assert.equal(etiquetaDeRepeticion("2026-01-30", "mensual"), "Todos los meses, el quinto viernes");
});

test("esRepeticion filtra lo que venga de un formulario", () => {
  assert.ok(esRepeticion("mensual"));
  assert.ok(!esRepeticion("cada-tanto"));
  assert.ok(!esRepeticion(""));
});
