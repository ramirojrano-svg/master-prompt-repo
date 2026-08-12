// src/dominio/motor/cancelacion.test.ts — T-43…T-46 (§15)
import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularCancelacion, calcularNoShow, ESCALONES_DEFAULT } from "./cancelacion.ts";

const inicio = new Date("2026-08-12T12:00:00Z");
const antes = (h: number) => new Date(inicio.getTime() - h * 3_600_000);

function cancel(over: Partial<Parameters<typeof calcularCancelacion>[0]> = {}) {
  return calcularCancelacion({
    inicio,
    ahora: antes(72),
    cobradoCentavos: 10_000n,
    bolsaOrigen: "pago_suelto",
    minutosDeCupoConsumidos: 0,
    escalones: ESCALONES_DEFAULT,
    origen: "inquilino",
    ...over,
  });
}

test("T-43 · escalones: 72h/36h/6h antes => 100% / 50% / 0%", () => {
  assert.equal(cancel({ ahora: antes(72) }).reembolsoPct, 100);
  assert.equal(cancel({ ahora: antes(36) }).reembolsoPct, 50);
  assert.equal(cancel({ ahora: antes(6) }).reembolsoPct, 0);
  assert.equal(cancel({ ahora: antes(36) }).devueltoCentavos, 5_000n);
});

test("T-44 · borde exacto 48h => 100% (el escalón es >=)", () => {
  assert.equal(cancel({ ahora: antes(48) }).reembolsoPct, 100);
});

test("T-45 · el reintegro vuelve a la MISMA bolsa de la que salió (bono, no mes)", () => {
  const r = cancel({ ahora: antes(36), bolsaOrigen: "bono", minutosDeCupoConsumidos: 60 });
  assert.equal(r.bolsaDestino, "bono");
  assert.equal(r.minutosAReintegrar, 30); // 50% de 60'
});

test("T-46 · cancelación por el OPERADOR a 2h => 100% + compensación, ignora los escalones", () => {
  const r = cancel({ ahora: antes(2), origen: "operador" });
  assert.equal(r.reembolsoPct, 100);
  assert.equal(r.devueltoCentavos, 10_000n);
  assert.equal(r.retenidoCentavos, 0n);
});

test("liberaSlot es true si todavía no empezó, false si ya pasó", () => {
  assert.equal(cancel({ ahora: antes(1) }).liberaSlot, true);
  assert.equal(cancel({ ahora: new Date(inicio.getTime() + 60_000) }).liberaSlot, false);
});

test("no-show: retiene el 100%, consume el cupo, no libera el slot", () => {
  const r = calcularNoShow({ cobradoCentavos: 9_000n, minutosDeCupoConsumidos: 60 });
  assert.deepEqual(r, { retenidoCentavos: 9_000n, minutosConsumidos: 60, liberaSlot: false });
});
