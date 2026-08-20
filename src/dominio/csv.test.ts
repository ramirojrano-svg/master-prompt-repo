// src/dominio/csv.test.ts — el CSV que Excel abre sin pelear.
// Cada caso de acá es un archivo que se corre una columna si el escape está mal, y eso no se nota
// hasta que los números no cierran.
import { test } from "node:test";
import assert from "node:assert/strict";
import { armarCsv, celda } from "./csv.ts";

test("un valor común va tal cual", () => {
  assert.equal(celda("Marta Gil"), "Marta Gil");
  assert.equal(celda(1234), "1234");
  assert.equal(celda(800000n), "800000");
});

test("una coma en el nombre NO corre la columna", () => {
  assert.equal(celda("Terrón, Marta"), '"Terrón, Marta"');
});

test("las comillas se duplican, que es lo que pide el formato", () => {
  assert.equal(celda('el "Doctor"'), '"el ""Doctor"""');
});

test("un salto de línea adentro de una celda no parte la fila", () => {
  assert.equal(celda("dos\nrenglones"), '"dos\nrenglones"');
});

test("vacío y nulo son celda vacía, no la palabra 'null'", () => {
  assert.equal(celda(null), "");
  assert.equal(celda(undefined), "");
});

test("el archivo arranca con BOM: sin eso Excel muestra 'TerrÃ³n'", () => {
  const csv = armarCsv(["nombre"], [["Terrón"]]);
  assert.ok(csv.startsWith("﻿"), "media agenda de este centro tiene tildes");
});

test("las filas se separan con CRLF, que es lo que espera Excel", () => {
  const csv = armarCsv(["a", "b"], [["1", "2"], ["3", "4"]]);
  assert.equal(csv, "﻿a,b\r\n1,2\r\n3,4\r\n");
});
