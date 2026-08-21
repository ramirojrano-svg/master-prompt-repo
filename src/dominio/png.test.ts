// src/dominio/png.test.ts — leer el PNG del logo.
//
// Se prueba contra el archivo REAL del proyecto y no contra uno inventado: lo que tiene que
// funcionar es ese, y un PNG de prueba de 2×2 no ejercita ni los filtros ni el tamaño.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { achicar, leerPng } from "./png.ts";

const logo = () => leerPng(readFileSync(join(process.cwd(), "public", "logo.png")));

test("lee el logo del centro", () => {
  const img = logo();
  assert.ok(img, "si esto falla, el PDF sale sin membrete");
  assert.equal(img.ancho, 794);
  assert.equal(img.alto, 647);
  assert.equal(img.rgba.length, 794 * 647 * 4);
});

test("el logo tiene transparencia de verdad", () => {
  // De eso depende que sobre la banda azul se vea la silueta y no un rectángulo.
  const img = logo()!;
  let transparentes = 0;
  for (let k = 3; k < img.rgba.length; k += 4) if (img.rgba[k]! < 10) transparentes++;
  assert.ok(transparentes > 1000, `esperaba fondo transparente, hubo ${transparentes} píxeles`);
});

test("achicar reduce las dos dimensiones y conserva el alfa", () => {
  const img = logo()!;
  const chico = achicar(img, 4);
  assert.equal(chico.ancho, Math.floor(794 / 4));
  assert.equal(chico.alto, Math.floor(647 / 4));
  assert.equal(chico.rgba.length, chico.ancho * chico.alto * 4);

  let opacos = 0;
  for (let k = 3; k < chico.rgba.length; k += 4) if (chico.rgba[k]! > 200) opacos++;
  assert.ok(opacos > 100, "achicar no puede borrar el dibujo");
});

test("achicar con factor 1 devuelve la misma imagen", () => {
  const img = logo()!;
  assert.equal(achicar(img, 1), img);
});

test("algo que no es un PNG devuelve null, no explota", () => {
  // El PDF sale sin logo, que es mucho mejor que no salir.
  assert.equal(leerPng(Buffer.from("no soy un png")), null);
  assert.equal(leerPng(Buffer.alloc(0)), null);
});
