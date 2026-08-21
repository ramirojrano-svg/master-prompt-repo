// src/lib/auth-core.test.ts — la parte pura (sesionVigente); autorizar se prueba contra DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sesionVigente, duracionDeSesion, sesionExpirada } from "./auth-core.ts";

test("sesionVigente: fila borrada (sv null) => inválida, fail-closed", () => {
  assert.equal(sesionVigente(3, null), false);
});

test("sesionVigente: versión distinta (baja/cambio de rol) => inválida", () => {
  assert.equal(sesionVigente(2, 3), false);
});

test("sesionVigente: misma versión => válida", () => {
  assert.equal(sesionVigente(3, 3), true);
});

test("la sesión del administrador dura mucho menos que la del profesional", () => {
  // El administrador entra desde la computadora de la recepción, que usan varias personas.
  assert.equal(duracionDeSesion(["owner"]), 12 * 3600);
  assert.equal(duracionDeSesion(["inquilino_titular"]), 720 * 3600);
  // Con los dos roles manda el corto: lo que importa es a qué puede llegar, no cuántos tiene.
  assert.equal(duracionDeSesion(["inquilino_titular", "owner"]), 12 * 3600);
});

test("sin poder leer los roles se asume el plazo corto", () => {
  // Ante la duda, el más restrictivo. Al revés, un error de lectura regalaría treinta días.
  assert.equal(duracionDeSesion(null), 12 * 3600);
});

test("sesionExpirada mide contra el plazo que corresponde al rol", () => {
  const ahora = 1_800_000_000;
  const hace = (h: number) => ahora - h * 3600;

  assert.equal(sesionExpirada(hace(11), ["owner"], ahora), false);
  assert.equal(sesionExpirada(hace(13), ["owner"], ahora), true);
  // El mismo token, para un profesional, sigue vivo.
  assert.equal(sesionExpirada(hace(13), ["inquilino_titular"], ahora), false);
  assert.equal(sesionExpirada(hace(721), ["inquilino_titular"], ahora), true);
});

test("un token sin fecha de emisión no se mata", () => {
  // Es un caso de borde de una versión anterior, no un ataque: matarlo desloguearía sin motivo.
  assert.equal(sesionExpirada(undefined, ["owner"], 1_800_000_000), false);
  assert.equal(sesionExpirada("ayer", ["owner"], 1_800_000_000), false);
});
