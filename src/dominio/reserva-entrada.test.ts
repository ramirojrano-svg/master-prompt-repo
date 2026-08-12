// src/dominio/reserva-entrada.test.ts — T-35, T-36 (§15)
import { test } from "node:test";
import assert from "node:assert/strict";
import { ReservaInput, validarVentanaReserva } from "./reserva-entrada.ts";

const AR = ["America", "Argentina", "Buenos_Aires"].join("/");
const AHORA = new Date("2026-08-01T00:00:00Z");

function parse(o: unknown) {
  const r = ReservaInput.safeParse(o);
  assert.ok(r.success, "el input debería parsear");
  return r.data;
}

test("T-35 · POST forjado: fecha ≠ día local de inicioISO se rechaza antes de tocar la base", () => {
  const d = parse({ salaId: "sa1", fecha: "2026-08-20", inicioISO: "2026-08-21T12:00:00.000Z", duracionMin: 60 });
  const r = validarVentanaReserva(d, AR, AHORA);
  assert.deepEqual(r, { ok: false, error: "FECHA_INCONSISTENTE" });
});

test("fecha y hora consistentes en la zona de la sede: pasa", () => {
  // 12:00Z = 09:00 en AR, mismo día 2026-08-20
  const d = parse({ salaId: "sa1", fecha: "2026-08-20", inicioISO: "2026-08-20T12:00:00.000Z", duracionMin: 60 });
  const r = validarVentanaReserva(d, AR, AHORA);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.fin.getTime() - r.inicio.getTime(), 60 * 60_000);
});

test("T-36 · duración fuera de rango se rechaza en el zod (5' y 800')", () => {
  const base = { salaId: "sa1", fecha: "2026-08-20", inicioISO: "2026-08-20T12:00:00.000Z" };
  assert.equal(ReservaInput.safeParse({ ...base, duracionMin: 5 }).success, false);
  assert.equal(ReservaInput.safeParse({ ...base, duracionMin: 800 }).success, false);
  assert.equal(ReservaInput.safeParse({ ...base, duracionMin: 60 }).success, true);
});

test("fecha inexistente en el calendario se rechaza", () => {
  const d = parse({ salaId: "sa1", fecha: "2026-02-30", inicioISO: "2026-02-28T12:00:00.000Z", duracionMin: 60 });
  assert.deepEqual(validarVentanaReserva(d, AR, AHORA), { ok: false, error: "FECHA_INVALIDA" });
});
