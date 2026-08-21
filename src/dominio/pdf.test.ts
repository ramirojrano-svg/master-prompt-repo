// src/dominio/pdf.test.ts — que el archivo sea un PDF válido.
//
// Un PDF mal armado no da error: el visor abre una hoja en blanco y no dice por qué. Lo que más
// se rompe es la tabla `xref` del final, que lleva el byte exacto donde empieza cada objeto — un
// byte de diferencia y el archivo deja de abrirse.
//
// Por eso los tests leen la estructura del archivo en vez de mirar que "no explote".

import { test } from "node:test";
import assert from "node:assert/strict";
import { anchoTexto, armarPdf, mm, A4 } from "./pdf.ts";

const texto = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

test("empieza con la firma y termina con el fin de archivo", () => {
  const s = texto(armarPdf([{ tipo: "texto", x: 50, y: 50, texto: "Hola", tam: 12 }]));
  assert.ok(s.startsWith("%PDF-1.4"), "sin la firma, ningún visor lo reconoce");
  assert.ok(s.trimEnd().endsWith("%%EOF"));
});

test("los offsets del xref apuntan al byte exacto de cada objeto", () => {
  // ESTE es el test del archivo: si un offset está corrido, el visor abre la hoja en blanco.
  const bytes = armarPdf([{ tipo: "texto", x: 50, y: 50, texto: "Hola", tam: 12 }]);
  const s = texto(bytes);

  const xref = s.indexOf("xref\n");
  const filas = s.slice(xref).split("\n").filter((l) => /^\d{10} 00000 n $/.test(l));
  assert.equal(filas.length, 6, "seis objetos: catálogo, páginas, página, contenido y dos fuentes");

  filas.forEach((fila, i) => {
    const offset = Number(fila.slice(0, 10));
    assert.equal(s.slice(offset, offset + 20).startsWith(`${i + 1} 0 obj`), true, `el objeto ${i + 1} no está en su offset`);
  });
});

test("startxref apunta al comienzo de la tabla xref", () => {
  const s = texto(armarPdf([{ tipo: "texto", x: 10, y: 10, texto: "x", tam: 8 }]));
  const declarado = Number(s.slice(s.lastIndexOf("startxref") + 10).split("\n")[0]);
  assert.equal(s.slice(declarado, declarado + 4), "xref");
});

test("los acentos y la eñe sobreviven", () => {
  // WinAnsiEncoding cubre latin-1, que es todo lo que hace falta en castellano. Sin esto,
  // "Terrón" sale "Terr?n" en el único documento que el profesional lee con atención.
  const s = texto(armarPdf([{ tipo: "texto", x: 10, y: 10, texto: "Terrón Raño é", tam: 10 }]));
  assert.ok(s.includes("Terr\xF3n Ra\xF1o \xE9"));
});

test("un paréntesis en el texto no rompe el archivo", () => {
  // En PDF los paréntesis delimitan las cadenas: uno sin escapar corta el objeto al medio.
  const s = texto(armarPdf([{ tipo: "texto", x: 10, y: 10, texto: "Marta (Alergista)", tam: 10 }]));
  assert.ok(s.includes("Marta \\(Alergista\\)"));
});

test("una barra invertida tampoco", () => {
  const s = texto(armarPdf([{ tipo: "texto", x: 10, y: 10, texto: "a\\b", tam: 10 }]));
  assert.ok(s.includes("a\\\\b"));
});

test("un carácter que no entra en latin-1 sale como ? y no rompe nada", () => {
  const bytes = armarPdf([{ tipo: "texto", x: 10, y: 10, texto: "hola 😀", tam: 10 }]);
  const s = texto(bytes);
  assert.ok(s.includes("hola ?"), "un emoji no puede impedir que la liquidación se descargue");
  assert.ok(s.trimEnd().endsWith("%%EOF"));
});

test("el largo declarado del contenido coincide con el real", () => {
  // Si /Length miente, el visor lee de más o de menos y el flujo queda corrupto.
  const s = texto(armarPdf([{ tipo: "texto", x: 10, y: 10, texto: "Hola mundo", tam: 12 }]));
  const declarado = Number(/<< \/Length (\d+) >>/.exec(s)![1]);
  const ini = s.indexOf("stream\n") + "stream\n".length;
  const fin = s.indexOf("\nendstream");
  assert.equal(fin - ini, declarado);
});

test("la hoja es A4 y las Y se dan vuelta", () => {
  const s = texto(armarPdf([{ tipo: "texto", x: 0, y: 0, texto: "arriba", tam: 10 }]));
  assert.ok(s.includes(`/MediaBox [0 0 ${A4.ancho.toFixed(2)} ${A4.alto.toFixed(2)}]`));
  // En PDF el origen está ABAJO a la izquierda: y=0 desde arriba es el alto de la hoja.
  assert.ok(s.includes(`0.00 ${A4.alto.toFixed(2)} Td`));
});

test("mm convierte a puntos", () => {
  assert.equal(Math.round(mm(210)), 595); // A4 de ancho
  assert.equal(Math.round(mm(25.4)), 72); // una pulgada
});

test("anchoTexto crece con el largo y con el tamaño", () => {
  assert.ok(anchoTexto("aaaa", 10) > anchoTexto("aa", 10));
  assert.ok(anchoTexto("aa", 20) > anchoTexto("aa", 10));
  assert.ok(anchoTexto("aa", 10, "Helvetica-Bold") > anchoTexto("aa", 10));
});
