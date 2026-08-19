// src/dominio/motor/ya-empezo.test.ts — "el turno ya empezó".
// Decide si un profesional puede cancelar o mover su turno, así que el borde importa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { yaEmpezo } from "./intervalos.ts";

const T = (iso: string) => new Date(iso);
const AHORA = T("2026-08-19T15:00:00.000Z");

test("lo de ayer ya empezó", () => {
  assert.equal(yaEmpezo(T("2026-08-18T10:00:00.000Z"), AHORA), true);
});

test("lo de mañana no", () => {
  assert.equal(yaEmpezo(T("2026-08-20T10:00:00.000Z"), AHORA), false);
});

test("el borde EXACTO cuenta como empezado: el consultorio ya está ocupado", () => {
  assert.equal(yaEmpezo(AHORA, AHORA), true);
});

test("un milisegundo antes de empezar todavía se puede cancelar", () => {
  assert.equal(yaEmpezo(T("2026-08-19T15:00:00.001Z"), AHORA), false);
});

// ── alcanzadasPor: el recorte en memoria de una serie ───────────────────────
// Tiene que dar EXACTAMENTE lo mismo que la consulta que reemplaza. Si dijera de menos, una serie
// se crearía encima de un turno que ya existe; si dijera de más, rechazaría fechas libres.
import { alcanzadasPor } from "./intervalos.ts";

const I = (desde: string, hasta: string) => ({ inicio: new Date(desde), fin: new Date(hasta) });
const OBJ = I("2026-08-19T10:00:00Z", "2026-08-19T11:00:00Z");

test("lo que se pisa entra; lo pegado NO (los bordes no se tocan)", () => {
  const filas = [
    I("2026-08-19T10:30:00Z", "2026-08-19T11:30:00Z"), // se monta
    I("2026-08-19T09:00:00Z", "2026-08-19T10:00:00Z"), // termina justo cuando arranca
    I("2026-08-19T11:00:00Z", "2026-08-19T12:00:00Z"), // arranca justo cuando termina
  ];
  const r = alcanzadasPor(filas, OBJ, 720);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], filas[0]);
});

test("una que envuelve al objetivo entero también cuenta", () => {
  const filas = [I("2026-08-19T08:00:00Z", "2026-08-19T14:00:00Z")];
  assert.equal(alcanzadasPor(filas, OBJ, 720).length, 1);
});

test("el lookback corta hacia atrás: lo que arrancó antes del piso no se mira", () => {
  // Arranca 20 h antes y dura 22: alcanzaría al objetivo, pero queda fuera del lookback de 12 h.
  const lejana = [I("2026-08-18T14:00:00Z", "2026-08-19T12:00:00Z")];
  assert.equal(alcanzadasPor(lejana, OBJ, 720).length, 0, "fuera del lookback");
  assert.equal(alcanzadasPor(lejana, OBJ, 1_440).length, 1, "con lookback más largo, sí");
});

test("lista vacía no rompe", () => {
  assert.deepEqual(alcanzadasPor([], OBJ, 720), []);
});
