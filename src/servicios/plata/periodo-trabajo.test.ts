// src/servicios/plata/periodo-trabajo.test.ts — con qué mes abre Cierre de mes.
//
// Abre en el mes EN CURSO. Antes abría en el que viene, para acompañar que el centro cobra a mes
// entrante, y en el uso real salió al revés: la pantalla se abre muchas más veces para mirar el
// mes que se está trabajando que para cerrar el que viene, y cada una de esas veces caía en un mes
// futuro casi vacío, obligando a volver una flecha atrás.
//
// Dejó de tocar la base al hacerlo: el mes que abre ya no depende de si hay reservas cargadas.
// Eso también saca una consulta por carga de pantalla y un lugar menos donde equivocarse de
// centro.

import { test } from "node:test";
import assert from "node:assert/strict";
import { periodoDeTrabajo } from "./periodo-trabajo.ts";

test("abre el mes en curso", () => {
  assert.equal(periodoDeTrabajo({ hoy: "2026-09" }), "2026-09");
});

test("el primer día del mes ya abre ese mes, no el anterior ni el siguiente", () => {
  // El caso que se reportó: el 1° de septiembre la pantalla mostraba octubre.
  assert.equal(periodoDeTrabajo({ hoy: "2026-09" }), "2026-09");
  assert.equal(periodoDeTrabajo({ hoy: "2026-12" }), "2026-12");
});

test("lo pedido por la URL manda", () => {
  // La flecha del mes tiene que poder llevar a cualquier mes —incluido uno vacío, o el que viene,
  // que es como se cierra por adelantado—. Si el default pisara lo pedido, navegar sería
  // imposible.
  assert.equal(periodoDeTrabajo({ hoy: "2026-09", pedido: "2026-10" }), "2026-10");
  assert.equal(periodoDeTrabajo({ hoy: "2026-09", pedido: "2026-03" }), "2026-03");
});

test("un período basura en la URL cae al mes en curso, no rompe la pantalla", () => {
  for (const basura of ["", "2026-13", "2026-00", "septiembre", "../../etc", "2026-9"]) {
    assert.equal(periodoDeTrabajo({ hoy: "2026-09", pedido: basura }), "2026-09", basura);
  }
});
