// src/env.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnv } from "./env.ts";

const base = { DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db", AUTH_SECRET: "secreto" };

test("parseEnv acepta un entorno válido y aplica el default de NODE_ENV", () => {
  const e = parseEnv(base);
  assert.equal(e.DATABASE_URL, base.DATABASE_URL);
  assert.equal(e.NODE_ENV, "development");
});

test("parseEnv rechaza si falta DATABASE_URL", () => {
  assert.throws(() => parseEnv({ AUTH_SECRET: "x" }), /DATABASE_URL/);
});

test("parseEnv rechaza una URL inválida", () => {
  assert.throws(() => parseEnv({ ...base, DATABASE_URL: "no-es-url" }), /DATABASE_URL/);
});

test("parseEnv rechaza si falta AUTH_SECRET", () => {
  assert.throws(() => parseEnv({ DATABASE_URL: base.DATABASE_URL }), /AUTH_SECRET/);
});
