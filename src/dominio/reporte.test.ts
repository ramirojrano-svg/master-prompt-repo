// src/dominio/reporte.test.ts — la aritmética del panel de datos.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aperturaDelPeriodoMin,
  diasDelPeriodo,
  esPeriodoValido,
  horasYMinutos,
  periodoAnterior,
  porcentaje,
  sinDetallar,
  venceElDelPeriodo,
} from "./reporte.ts";

test("un período es 'YYYY-MM' de verdad: el mes 13 no existe", () => {
  assert.equal(esPeriodoValido("2026-08"), true);
  assert.equal(esPeriodoValido("2026-13"), false);
  assert.equal(esPeriodoValido("2026-00"), false);
  assert.equal(esPeriodoValido("2026-8"), false);
  assert.equal(esPeriodoValido("agosto"), false);
});

test("los días del período salen completos, incluido febrero bisiesto", () => {
  assert.equal(diasDelPeriodo("2026-08").length, 31);
  assert.equal(diasDelPeriodo("2026-04").length, 30);
  assert.equal(diasDelPeriodo("2026-02").length, 28);
  assert.equal(diasDelPeriodo("2028-02").length, 29, "2028 es bisiesto");
  assert.equal(diasDelPeriodo("2026-08")[0], "2026-08-01");
  assert.equal(diasDelPeriodo("2026-08").at(-1), "2026-08-31");
  assert.deepEqual(diasDelPeriodo("2026-13"), [], "un período inválido no inventa días");
});

test("el período anterior cruza el año para atrás", () => {
  assert.equal(periodoAnterior("2026-08"), "2026-07");
  assert.equal(periodoAnterior("2026-01"), "2025-12");
});

test("la apertura cuenta DÍA POR DÍA: un mes con cinco lunes abre más", () => {
  // L-V 08:00-22:00 = 840 minutos por día hábil.
  const franjas = (d: number) => (d >= 1 && d <= 5 ? [{ desdeMin: 480, hastaMin: 1320 }] : []);
  // Día de la semana calculado sobre la fecha (evita depender del motor de zonas en un test puro).
  const diaSemana = (f: string) => new Date(`${f}T12:00:00Z`).getUTCDay();

  const agosto = aperturaDelPeriodoMin(franjas, diaSemana, diasDelPeriodo("2026-08"));
  const habiles = diasDelPeriodo("2026-08").filter((f) => { const d = diaSemana(f); return d >= 1 && d <= 5; }).length;
  assert.equal(agosto, habiles * 840);
  assert.notEqual(agosto, 31 * 840, "no es '31 días × 14 h': el fin de semana está cerrado");
});

test("una sala que no abre ningún día tiene denominador cero, no NaN", () => {
  const cerrada = aperturaDelPeriodoMin(() => [], () => 1, diasDelPeriodo("2026-08"));
  assert.equal(cerrada, 0);
  assert.equal(porcentaje(0, 0), 0);
  assert.equal(porcentaje(120, 0), 0, "sin denominador no hay porcentaje: 0, jamás Infinity");
});

test("porcentaje redondea al entero y muestra lo que hay", () => {
  assert.equal(porcentaje(50, 100), 50);
  assert.equal(porcentaje(1, 3), 33);
  assert.equal(porcentaje(2, 3), 67);
});

test("el detalle que no cierra deja el resto VISIBLE, no lo esconde (§6.8)", () => {
  const filas = [{ id: "a", montoCent: 500_000n }, { id: "b", montoCent: 300_000n }];
  assert.equal(sinDetallar(800_000n, filas), 0n, "cuando cierra, no sobra nada");
  assert.equal(sinDetallar(920_000n, filas), 120_000n, "lo que el detalle no explica se muestra");
  assert.equal(sinDetallar(700_000n, filas), -100_000n, "y si el detalle se pasa, también se ve");
});

test("las horas se muestran como horas y minutos, no como decimales", () => {
  assert.equal(horasYMinutos(750), "12 h 30′");
  assert.equal(horasYMinutos(720), "12 h");
  assert.equal(horasYMinutos(45), "45′");
  assert.equal(horasYMinutos(0), "0′");
  assert.equal(horasYMinutos(-90), "−1 h 30′");
});

test("venceElDelPeriodo cae DENTRO del mes facturado", () => {
  // El centro cobra a mes entrante: el 31 de agosto se emite septiembre, y septiembre se paga el
  // 7 de septiembre. Con facturación a mes vencido esto seria el mes siguiente.
  assert.equal(venceElDelPeriodo("2026-09", 7), "2026-09-07");
  assert.equal(venceElDelPeriodo("2026-01", 7), "2026-01-07");
});

test("venceElDelPeriodo rellena el día con cero a la izquierda", () => {
  // "2026-09-7" no es una fecha válida para un <input type=date> ni para el parser.
  assert.equal(venceElDelPeriodo("2026-09", 1), "2026-09-01");
});
