// src/dominio/calendario.test.ts — la aritmética del calendario.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diasDeVista,
  diasDelMes,
  domingoDe,
  esVista,
  fechaDeParam,
  matrizMensual,
  nombreCorto,
  navegar,
  primeroDelMes,
  tituloDeVista,
} from "./calendario.ts";

// 2026-08-13 es JUEVES.
const JUE = "2026-08-13";

test("la semana arranca en DOMINGO", () => {
  assert.equal(domingoDe(JUE), "2026-08-09");
  assert.equal(domingoDe("2026-08-09"), "2026-08-09", "un domingo es su propio domingo");
  assert.equal(domingoDe("2026-08-15"), "2026-08-09", "el sábado cierra la semana");
});

test("cada vista muestra la cantidad de días que corresponde", () => {
  assert.equal(diasDeVista("dia", JUE).length, 1);
  assert.equal(diasDeVista("semana", JUE).length, 7);
  assert.equal(diasDeVista("mes", JUE).length, 42);
});

test("la grilla del mes SIEMPRE tiene 6×7, aunque el mes entre en 5 semanas", () => {
  // Febrero 2026 arranca domingo y tiene 28 días: entra justo en 4 filas. Igual son 42.
  for (const f of ["2026-02-15", "2026-08-13", "2027-01-31", "2028-02-29"]) {
    assert.equal(diasDeVista("mes", f).length, 42, `${f} tiene que dar 42 celdas`);
    assert.equal(matrizMensual(f).length, 6);
    assert.ok(matrizMensual(f).every((s) => s.length === 7));
  }
});

test("la grilla del mes arranca en el domingo previo al día 1 y lo marca como ajeno", () => {
  const m = matrizMensual(JUE); // agosto 2026 arranca SÁBADO
  assert.equal(m[0]![0]!.fecha, "2026-07-26");
  assert.equal(m[0]![0]!.delMes, false, "el 26 de julio se muestra pero es de otro mes");
  assert.equal(m[0]![6]!.fecha, "2026-08-01");
  assert.equal(m[0]![6]!.delMes, true);
});

test("navegar por día y por semana", () => {
  assert.equal(navegar("dia", JUE, 1), "2026-08-14");
  assert.equal(navegar("dia", JUE, -1), "2026-08-12");
  assert.equal(navegar("semana", JUE, 1), "2026-08-20");
  assert.equal(navegar("semana", JUE, -1), "2026-08-06");
});

test("navegar de mes NO se saltea meses desde un día 31", () => {
  // El bug clásico: 31 de marzo + 30 días = 30 de abril, pero "+1 mes" desde el 31 con aritmética
  // de días cae en mayo y el operador nunca ve abril.
  assert.equal(navegar("mes", "2026-03-31", 1), "2026-04-01");
  assert.equal(navegar("mes", "2026-01-31", 1), "2026-02-01");
  assert.equal(navegar("mes", "2026-05-31", -1), "2026-04-01");
});

test("navegar de mes cruza el año en los dos sentidos", () => {
  assert.equal(navegar("mes", "2026-12-15", 1), "2027-01-01");
  assert.equal(navegar("mes", "2026-01-15", -1), "2025-12-01");
  assert.equal(navegar("mes", "2026-01-15", -13), "2024-12-01");
});

test("los títulos se leen como los lee una persona", () => {
  assert.equal(tituloDeVista("dia", JUE), "jueves, 13 de agosto de 2026");
  assert.equal(tituloDeVista("mes", JUE), "Agosto 2026");
  assert.equal(tituloDeVista("semana", JUE), "9 – 15 de agosto de 2026");
});

test("una semana que cruza mes o año lo dice, sin repetir de más", () => {
  assert.equal(tituloDeVista("semana", "2026-08-31"), "30 de agosto – 5 de septiembre de 2026");
  assert.equal(tituloDeVista("semana", "2026-12-31"), "27 de diciembre de 2026 – 2 de enero de 2027");
});

test("días del mes, incluido febrero bisiesto", () => {
  assert.equal(diasDelMes("2026-02-10"), 28);
  assert.equal(diasDelMes("2028-02-10"), 29);
  assert.equal(diasDelMes("2026-08-10"), 31);
  assert.equal(diasDelMes("2026-04-10"), 30);
  assert.equal(primeroDelMes(JUE), "2026-08-01");
});

test("un ?fecha= o ?vista= basura no rompe la pantalla (§9)", () => {
  assert.equal(fechaDeParam("2026-08-13"), "2026-08-13");
  assert.equal(fechaDeParam("2026-02-30"), null, "el 30 de febrero no existe");
  assert.equal(fechaDeParam("ayer"), null);
  assert.equal(fechaDeParam(undefined), null);
  assert.equal(fechaDeParam("<script>"), null);
  assert.equal(esVista("semana"), true);
  assert.equal(esVista("año"), false);
});

test("el chip angosto muestra el nombre sin la especialidad", () => {
  assert.equal(nombreCorto("María Gómez (Psicología)"), "María Gómez");
  assert.equal(nombreCorto("Juan Fernández (Odontología general)"), "Juan Fernández");
  assert.equal(nombreCorto("Ocupado"), "Ocupado", "sin paréntesis se deja tal cual");
  assert.equal(nombreCorto("Mantenimiento técnico"), "Mantenimiento técnico");
  assert.equal(nombreCorto("(Psicología)"), "(Psicología)", "si solo queda vacío, se muestra el original");
});
