// src/dominio/motor/zona.test.ts — T-07…T-14 (§15) + test de comportamiento con dos zonas (§11.2 regla 4)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diaSemanaDeFecha,
  esFechaCalendarioValida,
  fechaEnZona,
  formatHora,
  formatIcsUtc,
  instanteDeHoraLocal,
  rangoDiaEnZona,
} from "./zona.ts";

const AR = "America/Argentina/Buenos_Aires";
const CL = "America/Santiago";
const MX = "America/Mexico_City";

// Duración de un rango en horas (para los días de 23/25 h).
function horas(r: { inicio: Date; fin: Date }): number {
  return (r.fin.getTime() - r.inicio.getTime()) / 3_600_000;
}

test("T-07 · fecha inexistente 2026-02-30 se rechaza (no rollover al 2/3)", () => {
  assert.equal(esFechaCalendarioValida("2026-02-30"), false);
  assert.equal(instanteDeHoraLocal("2026-02-30", "10:00", AR), null);
});

test("T-08 · mes inválido 2026-13-01 se rechaza", () => {
  assert.equal(esFechaCalendarioValida("2026-13-01"), false);
  assert.equal(instanteDeHoraLocal("2026-13-01", "10:00", AR), null);
});

test("T-09 · hora inexistente (salto de primavera CL) corre hacia adelante, nunca null", () => {
  // 2026-09-06 en Santiago: 00:00 -> 01:00. La hora 00:30 no existe.
  const i = instanteDeHoraLocal("2026-09-06", "00:30", CL);
  assert.notEqual(i, null);
  // Corre hacia adelante: cae DESPUÉS del salto (>= 01:00 local), nunca antes.
  assert.equal(formatHora(i as Date, CL), "01:30");
});

test("T-10 · hora ambigua (vuelta del DST CL) devuelve la PRIMERA ocurrencia", () => {
  // 2026-04-04 23:30 en Santiago ocurre dos veces: 02:30Z (offset -180) y 03:30Z (offset -240).
  const i = instanteDeHoraLocal("2026-04-04", "23:30", CL);
  assert.notEqual(i, null);
  assert.equal((i as Date).toISOString(), "2026-04-05T02:30:00.000Z"); // la primera
});

test("T-11 · día de 23 h (salto de primavera CL)", () => {
  const r = rangoDiaEnZona("2026-09-06", CL);
  assert.notEqual(r, null);
  assert.equal(horas(r!), 23);
});

test("T-12 · día de 25 h (vuelta del DST CL)", () => {
  const r = rangoDiaEnZona("2026-04-04", CL);
  assert.notEqual(r, null);
  assert.equal(horas(r!), 25);
});

test("T-13 · mismo instante, dos sedes: string renderizado distinto y correcto", () => {
  const i = new Date("2026-08-12T18:00:00Z"); // agosto: AR -3, CL -4
  assert.equal(formatHora(i, AR), "15:00");
  assert.equal(formatHora(i, CL), "14:00");
  assert.notEqual(formatHora(i, AR), formatHora(i, CL));
});

test("T-14 · ICS de una sede no-AR: DTSTART absoluto que rinde 09:00 en Santiago", () => {
  const i = instanteDeHoraLocal("2026-08-12", "09:00", CL);
  assert.notEqual(i, null);
  // Round-trip: el instante, leído en la zona del centro, es la hora que el inquilino eligió.
  assert.equal(formatHora(i as Date, CL), "09:00");
  // Agosto en Santiago es UTC-4 => 09:00 local = 13:00Z.
  assert.equal(formatIcsUtc(i as Date), "20260812T130000Z");
});

test("Comportamiento con dos zonas (§11.2 regla 4): mismo instante, rótulos AR/MX", () => {
  const i = new Date("2026-03-10T14:00:00Z");
  assert.equal(formatHora(i, AR), "11:00");
  assert.equal(formatHora(i, MX), "08:00"); // México abolió el DST (UTC-6 todo el año)
});

test("diaSemanaDeFecha usa el mediodía UTC (inmune a offsets)", () => {
  assert.equal(diaSemanaDeFecha("2026-08-12"), 3); // miércoles
  assert.equal(diaSemanaDeFecha("2026-02-30"), null);
});

test("fechaEnZona devuelve el día local correcto en el borde de medianoche", () => {
  // 2026-09-01 00:30 hora de la sede AR cae en 2026-09-01 local aunque en UTC sea 03:30Z.
  const i = instanteDeHoraLocal("2026-09-01", "00:30", AR);
  assert.equal(fechaEnZona(i as Date, AR), "2026-09-01");
});
