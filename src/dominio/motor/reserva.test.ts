// src/dominio/motor/reserva.test.ts — el veredicto puro del re-chequeo (§4.8.4)
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluarReserva, type EntradaReserva } from "./reserva.ts";
import { instanteDeHoraLocal } from "./zona.ts";
import type { HorarioSemanal, Ocupacion, PoliticaCentro } from "./tipos.ts";

const AR = ["America", "Argentina", "Buenos_Aires"].join("/");
const FECHA = "2026-08-12"; // miércoles (día 3)
const HOR: HorarioSemanal = { 0: [], 1: [], 2: [], 3: [{ desde: "09:00", hasta: "18:00" }], 4: [], 5: [], 6: [] };
const POL: PoliticaCentro = { pasoMin: 30, duracionMinMin: 15, duracionMaxMin: 720, bufferMin: 15, bufferMismoInquilino: 0, antelacionMinMin: 0, horizonteDias: 60 };

function T(h: number, m = 0) {
  return instanteDeHoraLocal(FECHA, `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, AR)!;
}

function base(over: Partial<EntradaReserva>): EntradaReserva {
  return {
    fecha: FECHA,
    tz: AR,
    horario: HOR,
    politica: POL,
    intervalo: { inicio: T(10), fin: T(11) },
    inquilinoId: "in1",
    bloqueaProfesional: true,
    ocupacionesSala: [],
    ocupacionesInquilino: [],
    ...over,
  };
}

function ocu(over: Partial<Ocupacion>): Ocupacion {
  return { id: "o", salaId: "sa1", inquilinoId: "in2", tipo: "reserva", inicio: T(10), fin: T(11), bufferMin: 0, ...over };
}

test("sala y horario libres => ok", () => {
  assert.deepEqual(evaluarReserva(base({})), { ok: true });
});

test("fuera de la franja de apertura => FUERA_DE_HORARIO", () => {
  assert.deepEqual(evaluarReserva(base({ intervalo: { inicio: T(19), fin: T(20) } })), { ok: false, codigo: "FUERA_DE_HORARIO" });
});

test("choque con otra ocupación de la sala => SLOT_OCUPADO", () => {
  const r = evaluarReserva(base({ ocupacionesSala: [ocu({ inicio: T(10, 30), fin: T(11, 30) })] }));
  assert.deepEqual(r, { ok: false, codigo: "SLOT_OCUPADO" });
});

test("el buffer estampado de otra ocupación bloquea el borde", () => {
  // 09-10 de otro inquilino con buffer 15' bloquea hasta 10:15; 10:00-11:00 choca.
  const r = evaluarReserva(base({ ocupacionesSala: [ocu({ inicio: T(9), fin: T(10), bufferMin: 15 })] }));
  assert.deepEqual(r, { ok: false, codigo: "SLOT_OCUPADO" });
});

test("el inquilino ya tiene otra sala en ese rango => SOLAPA_INQUILINO", () => {
  const r = evaluarReserva(base({ ocupacionesInquilino: [ocu({ salaId: "sa2", inquilinoId: "in1", inicio: T(10, 30), fin: T(11, 30) })] }));
  assert.deepEqual(r, { ok: false, codigo: "SOLAPA_INQUILINO" });
});

test("con bloqueaProfesional=false, el solape del inquilino se permite", () => {
  const r = evaluarReserva(base({ bloqueaProfesional: false, ocupacionesInquilino: [ocu({ salaId: "sa2", inquilinoId: "in1", inicio: T(10, 30), fin: T(11, 30) })] }));
  assert.deepEqual(r, { ok: true });
});
