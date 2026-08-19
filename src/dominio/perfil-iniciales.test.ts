// src/dominio/perfil-iniciales.test.ts — las iniciales del avatar.
// Importan porque son lo que ve quien no cargó foto, y en este centro los nombres vienen con la
// especialidad pegada entre paréntesis: sacarla no es cosmético, es la diferencia entre "MT" y "MA".
import { test } from "node:test";
import assert from "node:assert/strict";
import { inicialesDe } from "./perfil.ts";

test("nombre y apellido", () => {
  assert.equal(inicialesDe("Marta Terrón"), "MT");
});

test("la especialidad entre paréntesis NO cuenta", () => {
  assert.equal(inicialesDe("Marta Terrón (Alergista)"), "MT");
  assert.equal(inicialesDe("Mariano Farías (PAMI)"), "MF");
});

test("el título tampoco: se busca a la persona, no al 'Dr.'", () => {
  assert.equal(inicialesDe("Dra. María Gómez"), "MG");
  assert.equal(inicialesDe("Lic. Ana Ruiz Díaz"), "AR");
});

test("un solo nombre da una sola letra", () => {
  assert.equal(inicialesDe("luz depilacion"), "LD");
  assert.equal(inicialesDe("Carolina"), "C");
});

test("nunca queda vacío: un hueco desalinea la columna", () => {
  assert.equal(inicialesDe(""), "?");
  assert.equal(inicialesDe("   "), "?");
  assert.equal(inicialesDe("(Perito)"), "?");
});
