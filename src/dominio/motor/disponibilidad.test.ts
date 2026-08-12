// src/dominio/motor/disponibilidad.test.ts — T-20…T-27 (§15)
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluarVentana, intervaloBloqueante, slotsDe } from "./disponibilidad.ts";
import { formatHora, instanteDeHoraLocal, minutosAHora, sumarDiasLocal } from "./zona.ts";
import type { EntradaDisponibilidad, Franja, HorarioSemanal, Instante, Ocupacion, PoliticaCentro } from "./tipos.ts";

const AR = ["America", "Argentina", "Buenos_Aires"].join("/");
const FECHA = "2026-08-12"; // miércoles (día 3)
const PASADO = new Date("2026-08-01T00:00:00Z"); // muy anterior: no filtra por antelación

function T(h: number, m = 0): Instante {
  return instanteDeHoraLocal(FECHA, minutosAHora(h * 60 + m), AR)!;
}

function hhmm(i: Instante): string {
  return formatHora(i, AR);
}

function horarioDia3(franjas: Franja[]): HorarioSemanal {
  return { 0: [], 1: [], 2: [], 3: franjas, 4: [], 5: [], 6: [] };
}

const POL: PoliticaCentro = {
  pasoMin: 30,
  duracionMinMin: 15,
  duracionMaxMin: 720,
  bufferMin: 15,
  bufferMismoInquilino: 0,
  antelacionMinMin: 0,
  horizonteDias: 60,
};

function entrada(over: Partial<EntradaDisponibilidad> & { horario: HorarioSemanal; duracionMin: number }): EntradaDisponibilidad {
  return { fecha: FECHA, tz: AR, ocupaciones: [], politica: POL, ahora: PASADO, ...over };
}

function ocu(over: Partial<Ocupacion>): Ocupacion {
  return { id: "o", salaId: "sa1", inquilinoId: null, tipo: "reserva", inicio: T(9), fin: T(10), bufferMin: 0, ...over };
}

test("T-20 · un bloque de 120' no cruza el hueco del mediodía", () => {
  const slots = slotsDe(entrada({ horario: horarioDia3([{ desde: "10:00", hasta: "12:00" }, { desde: "14:00", hasta: "18:00" }]), duracionMin: 120 }));
  const horas = slots.map(hhmm);
  assert.deepEqual(horas, ["10:00", "14:00", "14:30", "15:00", "15:30", "16:00"]);
  assert.ok(!horas.includes("11:00"));
});

test("T-21 · los slots se anclan a la apertura, no al borde del hueco (fin 10:47)", () => {
  const slots = slotsDe(
    entrada({
      horario: horarioDia3([{ desde: "09:00", hasta: "12:00" }]),
      duracionMin: 30,
      ocupaciones: [ocu({ inicio: T(9), fin: T(10, 47), inquilinoId: "in1" })],
    }),
  );
  const horas = slots.map(hhmm);
  assert.ok(horas.includes("11:00"));
  assert.ok(!horas.some((h) => h.endsWith(":47"))); // nunca ofrece 10:47
});

test("T-22 · piso por antelación: primer slot >= ahora + 120', redondeado al paso", () => {
  const slots = slotsDe(
    entrada({
      horario: horarioDia3([{ desde: "08:00", hasta: "20:00" }]),
      duracionMin: 60,
      politica: { ...POL, antelacionMinMin: 120 },
      ahora: T(10), // 10:00 local => piso 12:00
    }),
  );
  assert.equal(hhmm(slots[0]!), "12:00");
});

test("T-23 · fuera de horizonte: 61 días con horizonte 60", () => {
  const ahora = T(12);
  const fecha61 = sumarDiasLocal(FECHA, 61)!;
  const r = evaluarVentana(fecha61, AR, ahora, 60);
  assert.deepEqual(r, { ok: false, motivo: "FUERA_DE_HORIZONTE" });
  // dentro del horizonte sí entra
  assert.deepEqual(evaluarVentana(sumarDiasLocal(FECHA, 30)!, AR, ahora, 60), { ok: true });
  // una fecha pasada es otro motivo, distinguible
  assert.deepEqual(evaluarVentana(sumarDiasLocal(FECHA, -1)!, AR, ahora, 60), { ok: false, motivo: "FECHA_PASADA" });
});

test("T-24 · pasoMin 0 (basura) cae al default y devuelve slots, no lista vacía", () => {
  const slots = slotsDe(
    entrada({
      horario: horarioDia3([{ desde: "09:00", hasta: "12:00" }]),
      duracionMin: 60,
      politica: { ...POL, pasoMin: 0 as unknown as PoliticaCentro["pasoMin"] },
    }),
  );
  assert.ok(slots.length > 0);
});

test("T-25 · buffer entre inquilinos distintos: 10:00 no, 10:15 sí", () => {
  const slots = slotsDe(
    entrada({
      horario: horarioDia3([{ desde: "09:00", hasta: "12:00" }]),
      duracionMin: 60,
      politica: { ...POL, pasoMin: 15 },
      inquilinoId: "in2",
      ocupaciones: [ocu({ inicio: T(9), fin: T(10), bufferMin: 15, inquilinoId: "in1" })],
    }),
  );
  const horas = slots.map(hhmm);
  assert.ok(!horas.includes("10:00"));
  assert.ok(horas.includes("10:15"));
});

test("T-26 · bloques consecutivos del MISMO inquilino: 10-11 permitido", () => {
  const slots = slotsDe(
    entrada({
      horario: horarioDia3([{ desde: "09:00", hasta: "12:00" }]),
      duracionMin: 60,
      politica: { ...POL, pasoMin: 60, bufferMismoInquilino: 0 },
      inquilinoId: "in1",
      ocupaciones: [ocu({ inicio: T(9), fin: T(10), bufferMin: 15, inquilinoId: "in1" })],
    }),
  );
  const horas = slots.map(hhmm);
  assert.ok(horas.includes("10:00")); // consecutivo, sin buffer
  assert.ok(!horas.includes("09:00")); // ese sí está ocupado
});

test("T-27 · buffer ESTAMPADO: la reserva vieja bloquea sus 15', aunque la config suba a 30'", () => {
  const o = ocu({ inicio: T(12), fin: T(13), bufferMin: 15, inquilinoId: "in1" });
  const bloq = intervaloBloqueante(o, "in2", { ...POL, bufferMin: 30 });
  const minutosDeBuffer = (bloq.fin.getTime() - o.fin.getTime()) / 60_000;
  assert.equal(minutosDeBuffer, 15); // usa o.bufferMin (estampado), no politica.bufferMin
});
