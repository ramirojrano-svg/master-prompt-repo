// src/dominio/tarifa-plata.test.ts — leer plata como la escribe un argentino.
//
// El caso que motivó esto: un abono de $4.500 se guardó como $4,50 porque `Number("4.500")` da
// 4.5. Mil veces menos, sin error visible, descubierto recién al cerrar el mes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { aPesos, formatearPesos } from "./tarifa.ts";

test("el punto de miles es miles, no un decimal", () => {
  assert.equal(aPesos("4.500"), 4500);
  assert.equal(aPesos("3.750"), 3750);
  assert.equal(aPesos("9.100"), 9100);
  assert.equal(aPesos("1.234.567"), 1234567);
});

test("la coma es el decimal", () => {
  assert.equal(aPesos("4.500,50"), 4500.5);
  assert.equal(aPesos("4500,50"), 4500.5);
  assert.equal(aPesos("0,75"), 0.75);
});

test("un punto que NO separa miles sigue siendo decimal", () => {
  // Nadie escribe "4.5" queriendo decir cuatro mil quinientos: tres dígitos es la señal.
  assert.equal(aPesos("4.5"), 4.5);
  assert.equal(aPesos("0.75"), 0.75);
  assert.equal(aPesos("12.34"), 12.34);
});

test("lo que ya funcionaba sigue funcionando", () => {
  assert.equal(aPesos("4500"), 4500);
  assert.equal(aPesos(4500), 4500);
  assert.equal(aPesos("0"), 0);
  assert.equal(aPesos(0), 0);
});

test("tolera el signo pesos y los espacios", () => {
  assert.equal(aPesos("$ 4.500"), 4500);
  assert.equal(aPesos(" 4500 "), 4500);
});

test("lo que no es un número da null, para que el esquema lo rechace", () => {
  // Guardar un NaN dejaría un precio sin sentido en vez de un error que se ve.
  for (const basura of ["", "   ", "ocho mil", "4.5.6.7.8a", null, undefined, {}]) {
    assert.equal(aPesos(basura), null, String(basura));
  }
});

test("leer lo que la app escribe devuelve el mismo número", () => {
  // La propiedad que importa: `formatearPesos` y `aPesos` son inversas. Si no lo fueran, copiar
  // un importe de la pantalla y pegarlo en el formulario cambiaría el valor.
  for (const centavos of [450_000n, 375_000n, 910_000n, 25_560_000n, 100n]) {
    const texto = formatearPesos(centavos);
    assert.equal(aPesos(texto), Number(centavos) / 100, texto);
  }
});
