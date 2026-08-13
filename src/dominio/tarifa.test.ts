// src/dominio/tarifa.test.ts — resolución por especificidad y cotización.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cotizar, formatearPesos, resolverTarifa, tarifaRige, type TarifaVigente } from "./tarifa.ts";

const AHORA = new Date("2026-08-13T12:00:00Z");
const ANTES = new Date("2026-01-01T00:00:00Z");

function t(over: Partial<TarifaVigente> & { id: string; precioHoraCent: bigint }): TarifaVigente {
  return { salaId: null, inquilinoId: null, vigenteDesde: ANTES, vigenteHasta: null, ...over };
}

const general = t({ id: "gen", precioHoraCent: 800_000n });
const deSala = t({ id: "sala", precioHoraCent: 900_000n, salaId: "sa1" });
const deProf = t({ id: "prof", precioHoraCent: 700_000n, inquilinoId: "in1" });
const deAmbos = t({ id: "ambos", precioHoraCent: 600_000n, salaId: "sa1", inquilinoId: "in1" });

const ctx = { salaId: "sa1", inquilinoId: "in1", ahora: AHORA };

test("sin tarifas => null (que NO es precio cero)", () => {
  assert.equal(resolverTarifa([], ctx), null);
  const c = cotizar(null, 60);
  assert.equal(c.fuente, "sin_tarifa");
  assert.equal(c.importeCent, 0n);
  assert.equal(c.tarifaId, null);
});

test("solo la general => se usa la general", () => {
  assert.equal(resolverTarifa([general], ctx)?.id, "gen");
});

test("la de SALA gana sobre la general", () => {
  assert.equal(resolverTarifa([general, deSala], ctx)?.id, "sala");
});

test("la del PROFESIONAL gana sobre la de sala", () => {
  assert.equal(resolverTarifa([general, deSala, deProf], ctx)?.id, "prof");
});

test("profesional + sala gana sobre todas", () => {
  assert.equal(resolverTarifa([general, deSala, deProf, deAmbos], ctx)?.id, "ambos");
});

test("una tarifa de OTRA sala u OTRO profesional no aplica", () => {
  const otra = t({ id: "otra", precioHoraCent: 1n, salaId: "sa9" });
  const otroProf = t({ id: "otroP", precioHoraCent: 2n, inquilinoId: "in9" });
  assert.equal(resolverTarifa([general, otra, otroProf], ctx)?.id, "gen");
});

test("entre dos igual de específicas gana la MÁS NUEVA", () => {
  const vieja = t({ id: "v", precioHoraCent: 500_000n, vigenteDesde: new Date("2026-01-01T00:00:00Z") });
  const nueva = t({ id: "n", precioHoraCent: 850_000n, vigenteDesde: new Date("2026-08-01T00:00:00Z") });
  assert.equal(resolverTarifa([vieja, nueva], ctx)?.id, "n");
});

test("una tarifa CERRADA (vigenteHasta pasado) no se usa", () => {
  const cerrada = t({ id: "c", precioHoraCent: 500_000n, vigenteHasta: new Date("2026-08-01T00:00:00Z") });
  assert.equal(tarifaRige(cerrada, AHORA), false);
  assert.equal(resolverTarifa([cerrada], ctx), null);
});

test("una tarifa que todavía no empezó no se usa", () => {
  const futura = t({ id: "f", precioHoraCent: 999n, vigenteDesde: new Date("2026-12-01T00:00:00Z") });
  assert.equal(resolverTarifa([futura], ctx), null);
});

test("cotizar prorratea por minutos y trunca hacia abajo", () => {
  assert.equal(cotizar(general, 60).importeCent, 800_000n); // 1 h = $8.000
  assert.equal(cotizar(general, 120).importeCent, 1_600_000n); // 2 h
  assert.equal(cotizar(general, 30).importeCent, 400_000n); // media hora
  assert.equal(cotizar(general, 90).importeCent, 1_200_000n); // 1 h 30
  assert.equal(cotizar(general, 720).importeCent, 9_600_000n); // 12 h, el máximo
});

test("cotizar guarda la FUENTE del precio (para poder explicarlo meses después)", () => {
  assert.equal(cotizar(deAmbos, 60).fuente, "profesional_y_sala");
  assert.equal(cotizar(deProf, 60).fuente, "profesional");
  assert.equal(cotizar(deSala, 60).fuente, "sala");
  assert.equal(cotizar(general, 60).fuente, "general");
});

test("un redondeo raro nunca cobra de más", () => {
  const impar = t({ id: "i", precioHoraCent: 100n }); // $1 la hora
  assert.equal(cotizar(impar, 7).importeCent, 11n); // 100*7/60 = 11.67 => 11
});

test("formatearPesos muestra la plata en formato local", () => {
  const s = formatearPesos(800_000n);
  assert.match(s, /8\.000/);
  assert.match(s, /\$/);
});
