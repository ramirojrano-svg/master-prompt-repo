// src/dominio/conflictos.test.ts — el mensaje que recibe quien agenda una serie.
//
// El caso que motivó todo: se pide "cada lunes" y uno de los lunes ya lo tiene otro profesional.
// Antes la pantalla decía "1 fecha quedó afuera porque el consultorio ya estaba ocupado o
// cerrado" — sin decir qué lunes ni cuál de los dos motivos era.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describirConflictos,
  nombrarFecha,
  parsearConflictos,
  resumirConflictos,
  serializarConflictos,
  type ConflictoFecha,
} from "./conflictos.ts";

/** El camino completo: agrupar y contar, después describir. Es lo que hace la pantalla. */
const describir = (cs: ConflictoFecha[]) => describirConflictos(resumirConflictos(cs));

test("nombrarFecha da el día de la semana correcto", () => {
  // Verificables a mano en un calendario 2026.
  assert.equal(nombrarFecha("2026-08-17"), "lunes 17/8");
  assert.equal(nombrarFecha("2026-08-15"), "sábado 15/8");
  assert.equal(nombrarFecha("2026-01-01"), "jueves 1/1");
  assert.equal(nombrarFecha("2026-12-31"), "jueves 31/12");
});

test("nombrarFecha no se corre de día por zona horaria", () => {
  // Es la razón por la que no se construye un Date: `new Date("2026-03-01")` es medianoche UTC,
  // y en Buenos Aires (UTC−3) eso es el 28 de febrero. Una fecha de calendario se nombra con
  // aritmética, no con husos.
  assert.equal(nombrarFecha("2026-03-01"), "domingo 1/3");
  assert.equal(nombrarFecha("2026-07-01"), "miércoles 1/7");
});

test("nombrarFecha atraviesa un año bisiesto", () => {
  assert.equal(nombrarFecha("2028-02-29"), "martes 29/2");
  assert.equal(nombrarFecha("2028-03-01"), "miércoles 1/3");
});

test("una fecha mal formada se devuelve tal cual en vez de romper la pantalla", () => {
  assert.equal(nombrarFecha("cualquier cosa"), "cualquier cosa");
});

test("EL CASO: un lunes ocupado por otro profesional se nombra", () => {
  const g = describir([{ fecha: "2026-08-17", codigo: "SLOT_OCUPADO" }]);
  assert.equal(g.length, 1);
  assert.match(g[0]!.motivo, /ocupado por otro profesional/);
  assert.deepEqual(g[0]!.fechas, ["lunes 17/8"]);
  assert.equal(g[0]!.ocultas, 0);
});

test("los tres motivos NO se mezclan: se arreglan distinto", () => {
  const g = describir([
    { fecha: "2026-08-17", codigo: "SLOT_OCUPADO" },
    { fecha: "2026-09-07", codigo: "FUERA_DE_HORARIO" },
    { fecha: "2026-08-24", codigo: "SOLAPA_INQUILINO" },
  ]);
  assert.equal(g.length, 3, "un grupo por motivo");
  const motivos = g.map((x) => x.motivo);
  assert.ok(motivos.some((m) => /otro profesional/.test(m)), "consultorio tomado");
  assert.ok(motivos.some((m) => /otro consultorio/.test(m)), "el profesional ya tenía turno");
  assert.ok(motivos.some((m) => /cerrado/.test(m)), "fuera de horario");
});

test("el motivo con más fechas va primero", () => {
  // Si de una serie larga cuarenta cayeron por horario y dos por choque, lo que hay que leer
  // primero es lo de las cuarenta.
  const g = describir([
    { fecha: "2026-08-17", codigo: "SLOT_OCUPADO" },
    { fecha: "2026-09-07", codigo: "FUERA_DE_HORARIO" },
    { fecha: "2026-09-14", codigo: "FUERA_DE_HORARIO" },
  ]);
  assert.match(g[0]!.motivo, /cerrado/);
  assert.equal(g[0]!.fechas.length, 2);
});

test("las fechas salen ordenadas, no en el orden en que llegaron", () => {
  const g = describir([
    { fecha: "2026-08-31", codigo: "SLOT_OCUPADO" },
    { fecha: "2026-08-17", codigo: "SLOT_OCUPADO" },
    { fecha: "2026-08-24", codigo: "SLOT_OCUPADO" },
  ]);
  assert.deepEqual(g[0]!.fechas, ["lunes 17/8", "lunes 24/8", "lunes 31/8"]);
});

test("una lista larga se corta y dice cuántas quedaron sin nombrar", () => {
  const muchos = Array.from({ length: 10 }, (_, i) => ({
    fecha: `2026-08-${String(i + 10).padStart(2, "0")}`,
    codigo: "SLOT_OCUPADO",
  }));
  const g = describir(muchos);
  assert.equal(g[0]!.fechas.length, 6);
  assert.equal(g[0]!.ocultas, 4, "las otras se cuentan, no desaparecen");
});

test("sin conflictos no hay grupos", () => {
  assert.deepEqual(describir([]), []);
});

test("un código desconocido no rompe: cae en un texto genérico", () => {
  const g = describir([{ fecha: "2026-08-17", codigo: "ALGO_NUEVO" }]);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0]!.fechas, ["lunes 17/8"]);
});

// ── Los totales, que es donde estaba el error ───────────────────────────────

test("EL TOTAL sobrevive al recorte de la URL", () => {
  // Esto es lo que salió mal en pantalla: 57 choques, la URL llevaba 18, y el cartel decía
  // "57 fechas quedaron afuera" arriba y "y 12 más" abajo. Los dos números salían de conteos
  // distintos. Ahora el total se calcula UNA vez, sobre la lista completa, y viaja con el grupo.
  const muchos = Array.from({ length: 57 }, (_, i) => ({
    fecha: `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    codigo: "SLOT_OCUPADO",
  }));

  const ida = resumirConflictos(muchos);
  assert.equal(ida[0]!.total, 57, "el total es el real, no el de la muestra");
  assert.equal(ida[0]!.fechas.length, 6, "solo viajan 6 fechas");

  const vuelta = parsearConflictos(serializarConflictos(ida));
  assert.equal(vuelta[0]!.total, 57, "y sigue siendo 57 del otro lado");

  const g = describirConflictos(vuelta);
  assert.equal(g[0]!.fechas.length + g[0]!.ocultas, 57, "6 nombradas + 51 contadas = 57");
});

test("cada motivo lleva su propio total", () => {
  const cs = [
    ...Array.from({ length: 20 }, (_, i) => ({ fecha: `2026-01-${String(i + 1).padStart(2, "0")}`, codigo: "FUERA_DE_HORARIO" })),
    ...Array.from({ length: 3 }, (_, i) => ({ fecha: `2026-02-${String(i + 1).padStart(2, "0")}`, codigo: "SLOT_OCUPADO" })),
  ];
  const g = describirConflictos(parsearConflictos(serializarConflictos(resumirConflictos(cs))));
  assert.equal(g[0]!.fechas.length + g[0]!.ocultas, 20);
  assert.equal(g[1]!.fechas.length + g[1]!.ocultas, 3);
  assert.equal(g[1]!.ocultas, 0, "tres entran enteras: no dice 'y 0 más'");
});

test("ida y vuelta por la URL conservando motivos, totales y fechas", () => {
  const cs: ConflictoFecha[] = [
    { fecha: "2026-08-17", codigo: "SLOT_OCUPADO" },
    { fecha: "2026-09-07", codigo: "FUERA_DE_HORARIO" },
  ];
  assert.deepEqual(parsearConflictos(serializarConflictos(resumirConflictos(cs))), resumirConflictos(cs));
});

test("parsear basura devuelve vacío en vez de romper la pantalla", () => {
  // La query la puede editar cualquiera: lo que venga mal formado se descarta, no se muestra.
  assert.deepEqual(parsearConflictos(undefined), []);
  assert.deepEqual(parsearConflictos(""), []);
  assert.deepEqual(parsearConflictos("basura~mas-basura"), []);
  assert.deepEqual(parsearConflictos("SLOT_OCUPADO:0:"), [], "un total de cero no es un conflicto");
});

test("un total manoseado no puede quedar por debajo de las fechas que llegaron", () => {
  const g = parsearConflictos("SLOT_OCUPADO:1:2026-08-17.2026-08-24.2026-08-31");
  assert.equal(g[0]!.total, 3, "gana lo que se puede probar");
});

test("la query queda manejable aunque la serie sea anual", () => {
  const muchos = Array.from({ length: 57 }, (_, i) => ({
    fecha: `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    codigo: "SLOT_OCUPADO",
  }));
  assert.ok(serializarConflictos(resumirConflictos(muchos)).length < 200);
});
