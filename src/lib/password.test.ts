// src/lib/password.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verificarPassword } from "./password.ts";

test("hash + verify: la contraseña correcta valida, la incorrecta no", async () => {
  const hash = await hashPassword("un-secreto-123");
  assert.notEqual(hash, "un-secreto-123"); // no se guarda en claro
  assert.equal(await verificarPassword("un-secreto-123", hash), true);
  assert.equal(await verificarPassword("otra-cosa", hash), false);
});
