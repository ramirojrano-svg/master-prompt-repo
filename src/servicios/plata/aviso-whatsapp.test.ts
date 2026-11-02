// src/servicios/plata/aviso-whatsapp.test.ts — el mensaje que se manda por WhatsApp.
//
// Acá se cobra por WhatsApp, así que este texto es el documento que de verdad lee el profesional.
// Lo que se prueba es que lleve TODO lo necesario para pagar sin tener que preguntar nada — que
// era el problema de fondo: la liquidación decía cuánto y no a dónde, y el circuito terminaba
// igual en un mensaje preguntando el alias.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mensajeDeAviso } from "./aviso-whatsapp.ts";

const COBRO = {
  titular: "Espacio Montes de Oca SRL",
  alias: "espacio.moca.ars",
  cbu: "0170099220000067797777",
  cuit: "30-71234567-8",
  banco: "Galicia",
};

const base = {
  whatsapp: "5491122334455",
  nombre: "Marta Gil (PAMI)",
  periodo: "2026-11",
  totalCent: 25_560_000n,
  venceEl: "2026-11-07",
  moneda: "ARS",
  cobro: COBRO,
};

test("sin teléfono cargado no hay mensaje: no se ofrece un botón roto", () => {
  assert.equal(mensajeDeAviso({ ...base, whatsapp: null }), null);
  assert.equal(mensajeDeAviso({ ...base, whatsapp: "" }), null);
});

test("abre el chat de ESA persona", () => {
  const m = mensajeDeAviso(base)!;
  assert.ok(m.href.startsWith("https://wa.me/5491122334455?text="), m.href);
});

test("lleva el mes, el total y el vencimiento", () => {
  const m = mensajeDeAviso(base)!;
  assert.match(m.texto, /noviembre de 2026/);
  assert.match(m.texto, /255\.600,00/);
  assert.match(m.texto, /7 de noviembre/);
});

test("lleva a dónde transferir, que es lo que evita el mensaje preguntando el alias", () => {
  const m = mensajeDeAviso(base)!;
  assert.match(m.texto, /Alias: espacio\.moca\.ars/);
  assert.match(m.texto, /CBU: 0170099220000067797777/);
  assert.match(m.texto, /Titular: Espacio Montes de Oca SRL/);
});

test("cada dato de cobro en su propio renglón", () => {
  // En WhatsApp se copia tocando y manteniendo: un alias pegado al CBU en la misma línea obliga a
  // seleccionar a mano, que es exactamente el problema que ya costó una vuelta en el PDF.
  const m = mensajeDeAviso(base)!;
  const renglones = m.texto.split("\n");
  assert.ok(renglones.some((l) => l === `Alias: ${COBRO.alias}`), "el alias, solo en su renglón");
  assert.ok(renglones.some((l) => l === `CBU: ${COBRO.cbu}`), "el CBU, solo en su renglón");
});

test("saluda por el nombre de pila, sin la especialidad", () => {
  // Es un WhatsApp, no el encabezado de un papel: "Hola Marta", no "Hola Marta Gil (PAMI)".
  assert.match(mensajeDeAviso(base)!.texto, /^Hola Marta,/);
});

test("sin datos de cobro cargados no inventa un renglón vacío", () => {
  const m = mensajeDeAviso({ ...base, cobro: { titular: null, alias: null, cbu: null, cuit: null, banco: null } })!;
  assert.doesNotMatch(m.texto, /Para transferir/);
  assert.match(m.texto, /255\.600,00/, "el total sigue estando");
});

test("el texto viaja escapado, o el link se corta en el primer salto de línea", () => {
  const m = mensajeDeAviso(base)!;
  assert.doesNotMatch(m.href, /\n/);
  assert.ok(m.href.includes("%0A"), "los saltos de línea van codificados");
  // Y lo que se escapó es exactamente el texto que se muestra.
  assert.equal(decodeURIComponent(m.href.split("?text=")[1]!), m.texto);
});

test("el link al PDF va al final y en su propio renglón", () => {
  // WhatsApp detecta el enlace solo si está suelto: pegado a otra palabra se lo come o lo corta.
  const m = mensajeDeAviso({ ...base, urlPdf: "https://emoapp-beta.vercel.app/l/abc.123.xyz" })!;
  const renglones = m.texto.split("\n");
  assert.ok(renglones.includes("https://emoapp-beta.vercel.app/l/abc.123.xyz"), "el link, solo en su renglón");
  assert.match(m.texto, /Tu liquidación en PDF:/);
});

test("sin link, el mensaje sale igual y completo", () => {
  // Si no hay dirección configurada, mandar "https://undefined/..." sería peor que no mandar nada.
  const m = mensajeDeAviso({ ...base, urlPdf: null })!;
  assert.doesNotMatch(m.texto, /PDF/);
  assert.match(m.texto, /255\.600,00/);
  assert.match(m.texto, /Alias: espacio\.moca\.ars/);
});

test("con link, el total y el alias SIGUEN en el texto", () => {
  // Obligar a abrir un PDF para sacar un CBU es el trabajo de más que esto viene a sacar.
  const m = mensajeDeAviso({ ...base, urlPdf: "https://x.test/l/t" })!;
  // El separador después del "$" lo pone Intl y es un espacio especial: se compara sin él.
  assert.match(m.texto, /Total:.*255\.600,00/);
  assert.match(m.texto, /CBU: 0170099220000067797777/);
});
