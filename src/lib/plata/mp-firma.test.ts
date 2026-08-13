// src/lib/plata/mp-firma.test.ts — §5.10 #3 y frescura
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { firmaWebhookValida } from "./mp-firma.ts";

const SECRET = "secreto-mp";
const dataId = "PAY-123";
const requestId = "req-abc";

function firmar(ts: number, secret = SECRET): string {
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

const ahoraMs = 1_700_000_000_000;
const ts = Math.floor(ahoraMs / 1000);

test("firma válida y fresca => true", () => {
  assert.equal(firmaWebhookValida({ dataId, requestId, xSignature: firmar(ts), secret: SECRET, ahoraMs }), true);
});

test("sin secret => false (fail-closed)", () => {
  assert.equal(firmaWebhookValida({ dataId, requestId, xSignature: firmar(ts), secret: undefined, ahoraMs }), false);
});

test("firma adulterada => false", () => {
  const x = firmar(ts).replace(/v1=.*/, "v1=deadbeef");
  assert.equal(firmaWebhookValida({ dataId, requestId, xSignature: x, secret: SECRET, ahoraMs }), false);
});

test("secret equivocado => false", () => {
  assert.equal(firmaWebhookValida({ dataId, requestId, xSignature: firmar(ts, "otro"), secret: SECRET, ahoraMs }), false);
});

test("ts viejo (>5 min) => false (anti-replay)", () => {
  const viejo = ts - 6 * 60;
  assert.equal(firmaWebhookValida({ dataId, requestId, xSignature: firmar(viejo), secret: SECRET, ahoraMs }), false);
});

test("sin header x-signature => false", () => {
  assert.equal(firmaWebhookValida({ dataId, requestId, xSignature: null, secret: SECRET, ahoraMs }), false);
});
