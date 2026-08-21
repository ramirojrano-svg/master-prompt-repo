// src/dominio/perfil.test.ts — cómo se escribe el nombre de alguien.
//
// Parece cosmético y no lo es: el nombre limpio es el que va en el documento que el profesional
// recibe. Un guion colgando o media especialidad cortada se ven como descuido en el único papel
// que él lee con atención.

import { test } from "node:test";
import assert from "node:assert/strict";
import { nombreSinEspecialidad, telefonoAWa } from "./perfil.ts";

test("nombreSinEspecialidad saca el paréntesis y no toca el resto", () => {
  assert.equal(nombreSinEspecialidad("Marta Terrón (Alergista)"), "Marta Terrón");
  assert.equal(nombreSinEspecialidad("Laila (PAMI)"), "Laila");
  assert.equal(nombreSinEspecialidad("Ruben Raño"), "Ruben Raño");
});

test("nombreSinEspecialidad no deja un guion colgando", () => {
  // Pasa de verdad: "Verónica Sorasio - Guillermina Inés Ortega (Dermatología)".
  assert.equal(nombreSinEspecialidad("Verónica Sorasio - Guillermina Ortega (Dermatología)"), "Verónica Sorasio - Guillermina Ortega");
  assert.equal(nombreSinEspecialidad("Macrogroup SRL - (Carolina)"), "Macrogroup SRL");
});

test("nombreSinEspecialidad deja en paz un nombre sin paréntesis", () => {
  assert.equal(nombreSinEspecialidad("VGF Meats and Services SRL - Víctor"), "VGF Meats and Services SRL - Víctor");
});

test("telefonoAWa arma el número como lo quiere wa.me", () => {
  // Todas estas son formas en que la misma persona escribe su celular.
  assert.equal(telefonoAWa("11 2233-4455"), "5491122334455");
  assert.equal(telefonoAWa("+54 9 11 2233 4455"), "5491122334455");
  assert.equal(telefonoAWa("011 15 2233 4455"), "5491122334455");
  assert.equal(telefonoAWa("5491122334455"), "5491122334455");
});

test("telefonoAWa devuelve null en vez de un link roto", () => {
  // Mejor no ofrecer el botón que ofrecer uno que abre un chat con nadie.
  assert.equal(telefonoAWa(""), null);
  assert.equal(telefonoAWa(null), null);
  assert.equal(telefonoAWa("1234"), null);
});
