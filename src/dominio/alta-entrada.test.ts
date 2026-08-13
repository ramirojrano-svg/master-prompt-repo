// src/dominio/alta-entrada.test.ts — el borde de entrada del alta (puro, §11.2 regla 3)
import { test } from "node:test";
import assert from "node:assert/strict";
import { AltaInput } from "./alta-entrada.ts";

const base = {
  nombreOperador: "Espacio Montes de Oca",
  slug: "espacio-moca",
  pais: "AR",
  nombreSede: "Sede Montes de Oca",
  nombreUsuario: "Ramiro",
  email: "duenio@centro.test",
  password: "clave-larga-1",
};

test("input válido pasa", () => {
  assert.equal(AltaInput.safeParse(base).success, true);
});

test("slug con mayúsculas o espacios se rechaza", () => {
  assert.equal(AltaInput.safeParse({ ...base, slug: "Espacio MOCA" }).success, false);
});

test("un slug RESERVADO se rechaza (no puede chocar con rutas de la app)", () => {
  for (const s of ["admin", "api", "login", "panel", "pagos"]) {
    assert.equal(AltaInput.safeParse({ ...base, slug: s }).success, false, `${s} debería estar reservado`);
  }
});

test("email inválido y contraseña corta se rechazan", () => {
  assert.equal(AltaInput.safeParse({ ...base, email: "no-es-mail" }).success, false);
  assert.equal(AltaInput.safeParse({ ...base, password: "corta" }).success, false);
});
