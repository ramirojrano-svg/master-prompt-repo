// src/lib/plata/dinero.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { desagregarIva, prorratear } from "./dinero.ts";

test("desagregarIva: alícuota 0 => todo neto, IVA 0", () => {
  assert.deepEqual(desagregarIva(12_100n, 0), { netoCent: 12_100n, ivaCent: 0n });
});

test("desagregarIva 21%: neto + IVA cierran exactamente con el total (por resta)", () => {
  const { netoCent, ivaCent } = desagregarIva(12_100n, 210);
  assert.equal(netoCent, 10_000n);
  assert.equal(ivaCent, 2_100n);
  assert.equal(netoCent + ivaCent, 12_100n);
});

test("desagregarIva: siempre cierra aunque no sea divisible", () => {
  const total = 999n;
  const { netoCent, ivaCent } = desagregarIva(total, 210);
  assert.equal(netoCent + ivaCent, total);
});

test("prorratear: mes completo, cero días, y mitad de mes", () => {
  assert.equal(prorratear(3_000n, 31, 31), 3_000n); // completo
  assert.equal(prorratear(3_000n, 0, 30), 0n);
  assert.equal(prorratear(3_000n, 15, 30), 1_500n);
  assert.equal(prorratear(3_000n, 40, 30), 3_000n); // más días que el mes => completo
});
