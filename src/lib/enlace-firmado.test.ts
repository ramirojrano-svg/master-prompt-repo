// src/lib/enlace-firmado.test.ts — la llave que abre UN documento y vence sola.
//
// Es la única puerta de la app que se abre sin sesión, así que lo que se prueba acá es que no se
// pueda fabricar una llave ni estirarle el vencimiento.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DIAS_VIGENCIA, firmarEnlace, verificarEnlace } from "./enlace-firmado.ts";

const SECRETO = "un-secreto-de-prueba-largo-0123456789";
process.env.AUTH_SECRET = SECRETO;

test("la llave abre el documento que firmó", () => {
  const t = firmarEnlace("liq_abc123")!;
  assert.deepEqual(verificarEnlace(t), { ok: true, id: "liq_abc123" });
});

test("una llave de otro documento no abre este", () => {
  const otra = firmarEnlace("liq_otro")!;
  const v = verificarEnlace(otra);
  assert.ok(v.ok && v.id === "liq_otro", "abre la suya, no la de al lado");
});

test("cambiarle el id rompe la firma", () => {
  const t = firmarEnlace("liq_abc123")!;
  const [, vence, f] = t.split(".");
  assert.deepEqual(verificarEnlace(`liq_ajena.${vence}.${f}`), { ok: false, motivo: "firma_invalida" });
});

test("estirarle el vencimiento rompe la firma", () => {
  // El plazo viaja ADENTRO de lo firmado: no se puede correr sin fabricar la firma de nuevo.
  const t = firmarEnlace("liq_abc123")!;
  const [id, vence, f] = t.split(".");
  const masTarde = String(Number(vence) + 86_400 * 365);
  assert.deepEqual(verificarEnlace(`${id}.${masTarde}.${f}`), { ok: false, motivo: "firma_invalida" });
});

test("una firma inventada no sirve", () => {
  const t = firmarEnlace("liq_abc123")!;
  const [id, vence] = t.split(".");
  assert.equal(verificarEnlace(`${id}.${vence}.firmaInventada`).ok, false);
});

test("después del plazo deja de abrir", () => {
  const t = firmarEnlace("liq_abc123", new Date("2026-01-01T12:00:00Z"))!;
  const dentro = new Date(`2026-01-01T12:00:00Z`);
  const fuera = new Date(Date.UTC(2026, 0, 1, 12) + (DIAS_VIGENCIA + 1) * 86_400_000);
  assert.ok(verificarEnlace(t, dentro).ok);
  assert.deepEqual(verificarEnlace(t, fuera), { ok: false, motivo: "vencido" });
});

test("una firma inválida se reporta como inválida, no como vencida", () => {
  // Contestar "vencido" a un token inventado le diría al que prueba que la fecha es un campo que
  // puede tocar. Se verifica la firma PRIMERO.
  const viejo = firmarEnlace("liq_abc123", new Date("2020-01-01T12:00:00Z"))!;
  const [id, vence] = viejo.split(".");
  assert.deepEqual(verificarEnlace(`${id}.${vence}.inventada`), { ok: false, motivo: "firma_invalida" });
});

test("basura no rompe nada", () => {
  for (const b of ["", "x", "a.b", "a.b.c.d", "...", "liq.noesnumero.firma"]) {
    assert.equal(verificarEnlace(b).ok, false, b);
  }
});

test("con otro secreto, la llave no abre", () => {
  const t = firmarEnlace("liq_abc123")!;
  process.env.AUTH_SECRET = "otro-secreto-igual-de-largo-0123456789";
  assert.deepEqual(verificarEnlace(t), { ok: false, motivo: "firma_invalida" });
  process.env.AUTH_SECRET = SECRETO;
});

test("sin secreto no se firma: mejor sin botón que con una llave de juguete", () => {
  const antes = process.env.AUTH_SECRET;
  delete process.env.AUTH_SECRET;
  assert.equal(firmarEnlace("liq_abc123"), null);
  assert.deepEqual(verificarEnlace("lo.que.sea"), { ok: false, motivo: "sin_secreto" });
  process.env.AUTH_SECRET = antes;
});
