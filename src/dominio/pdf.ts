// src/dominio/pdf.ts — armar un PDF de una página, a mano.
//
// Módulo PURO: no sabe qué se imprime, solo cómo se escribe un PDF.
//
// Sin librería a propósito. Las de PDF pesan entre uno y varios megas, y lo que hace falta acá es
// una hoja con texto, líneas y un logo — el 3% de lo que ofrecen. El formato es texto plano con
// unos pocos objetos numerados; lo caro de un PDF es el layout automático, y el layout de esta
// hoja ya lo decide quien la arma.
//
// Dos cosas que no son obvias y hay que respetar:
//
//  · La tabla `xref` del final lleva el byte EXACTO donde empieza cada objeto. Si eso no cierra,
//    el visor abre el archivo en blanco sin decir por qué. Por eso se construye midiendo el buffer
//    a medida que crece, y no calculando longitudes por separado.
//  · El texto va en WinAnsiEncoding, que es lo que entienden las catorce fuentes que todo visor
//    trae de fábrica. Cubre acentos y la eñe —que es todo lo que hace falta en castellano— sin
//    tener que empotrar un archivo de fuente de 300 KB.

import { deflateSync } from "node:zlib";

/** Milímetros a puntos PostScript, que es la unidad del PDF (72 por pulgada). */
export const mm = (v: number): number => (v * 72) / 25.4;

/** A4 en puntos. El alto se usa para dar vuelta las Y: en PDF el origen está ABAJO a la izquierda. */
export const A4 = { ancho: mm(210), alto: mm(297) };

export type Fuente = "Helvetica" | "Helvetica-Bold";
export type Color = { r: number; g: number; b: number };

/**
 * Una imagen para dibujar. `rgba` viene de `leerPng`.
 *
 * `tinte` pinta la silueta de un color plano usando el alfa como recorte, en vez de los colores
 * originales. Es lo que hace falta para el logo: el archivo es azul sobre transparente y sobre la
 * banda oscura tiene que verse blanco — lo mismo que en pantalla hace un filtro de CSS.
 */
export type ImagenOrden = {
  tipo: "imagen";
  x: number;
  y: number;
  ancho: number;
  alto: number;
  rgba: Uint8Array;
  pxAncho: number;
  pxAlto: number;
  tinte?: Color;
};

export type Orden =
  | { tipo: "texto"; x: number; y: number; texto: string; tam: number; fuente?: Fuente; color?: Color }
  | { tipo: "texto-der"; x: number; y: number; texto: string; tam: number; fuente?: Fuente; color?: Color }
  | { tipo: "linea"; x1: number; y1: number; x2: number; y2: number; grosor?: number; color?: Color }
  | { tipo: "caja"; x: number; y: number; ancho: number; alto: number; color: Color }
  | ImagenOrden;

const NEGRO: Color = { r: 0, g: 0, b: 0 };

/** Ancho aproximado de una cadena, para poder alinear a la derecha sin métricas reales. */
export function anchoTexto(texto: string, tam: number, fuente: Fuente = "Helvetica"): number {
  // Helvetica promedia ~0.5 em por carácter; la negrita, un poco más. Es una aproximación y
  // alcanza: se usa para alinear importes a la derecha, no para justificar párrafos.
  const factor = fuente === "Helvetica-Bold" ? 0.55 : 0.5;
  return texto.length * tam * factor;
}

/** Escapa lo que el PDF trata como sintaxis dentro de una cadena literal. */
function escaparPdf(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/\r/g, "");
}

/**
 * Pasa una cadena JS (UTF-16) a bytes WinAnsi (cp1252).
 *
 * Lo que no entra en cp1252 se reemplaza por un signo de pregunta en vez de romper el archivo: un
 * nombre con un carácter raro tiene que salir feo, no impedir que la liquidación se descargue.
 */
function aWinAnsi(s: string): number[] {
  // Los pocos signos fuera de latin-1 que aparecen de verdad en un texto en castellano: comillas
  // tipográficas y guiones largos, que salen del teclado y de los copiar-pegar. El resto cae al
  // signo de pregunta.
  const especiales: Record<string, number> = {
    "\u20AC": 0x80, "\u2018": 0x91, "\u2019": 0x92, "\u201C": 0x93, "\u201D": 0x94,
    "\u2022": 0x95, "\u2013": 0x96, "\u2014": 0x97, "\u2026": 0x85,
  };
  const bytes: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0x7f || (cp >= 0xa0 && cp <= 0xff)) bytes.push(cp);
    else if (especiales[ch] !== undefined) bytes.push(especiales[ch]!);
    else bytes.push(0x3f); // '?'
  }
  return bytes;
}

const col = (c: Color) => `${(c.r / 255).toFixed(3)} ${(c.g / 255).toFixed(3)} ${(c.b / 255).toFixed(3)}`;

/** El flujo de dibujo de la página, en el lenguaje de contenido del PDF. */
function armarContenido(ordenes: Orden[]): number[] {
  const partes: number[] = [];
  const escribir = (s: string) => partes.push(...aWinAnsi(s));
  let nImagen = 0;

  for (const o of ordenes) {
    if (o.tipo === "imagen") {
      // `cm` deja la matriz de transformación puesta para que la imagen —que en PDF siempre mide
      // 1×1 en su propio espacio— caiga escalada y en su lugar. Va entre q/Q para no arrastrar
      // esa transformación al resto del dibujo.
      const yPdf = A4.alto - o.y - o.alto;
      escribir(`q\n`);
      if (o.tinte) escribir(`${col(o.tinte)} rg\n`);
      escribir(`${o.ancho.toFixed(2)} 0 0 ${o.alto.toFixed(2)} ${o.x.toFixed(2)} ${yPdf.toFixed(2)} cm\n`);
      escribir(`/Im${nImagen++} Do\nQ\n`);
      continue;
    }
    if (o.tipo === "caja") {
      escribir(`${col(o.color)} rg\n${o.x.toFixed(2)} ${(A4.alto - o.y - o.alto).toFixed(2)} ${o.ancho.toFixed(2)} ${o.alto.toFixed(2)} re f\n`);
      continue;
    }
    if (o.tipo === "linea") {
      escribir(
        `${col(o.color ?? NEGRO)} RG ${(o.grosor ?? 0.5).toFixed(2)} w\n` +
          `${o.x1.toFixed(2)} ${(A4.alto - o.y1).toFixed(2)} m ${o.x2.toFixed(2)} ${(A4.alto - o.y2).toFixed(2)} l S\n`,
      );
      continue;
    }
    // El ancho se estima acá y no en quien llama: alinear a la derecha es una decisión de dibujo.
    const x = o.tipo === "texto-der" ? o.x - anchoTexto(o.texto, o.tam, o.fuente ?? "Helvetica") : o.x;
    escribir(`BT /${(o.fuente ?? "Helvetica") === "Helvetica-Bold" ? "F2" : "F1"} ${o.tam} Tf\n`);
    escribir(`${col(o.color ?? NEGRO)} rg\n`);
    escribir(`${x.toFixed(2)} ${(A4.alto - o.y).toFixed(2)} Td (`);
    partes.push(...aWinAnsi(escaparPdf(o.texto)));
    escribir(`) Tj ET\n`);
  }
  return partes;
}

/**
 * Devuelve el PDF completo como bytes.
 *
 * Una sola página: una liquidación de un mes entra de sobra, y paginar sin motivo es complejidad
 * que no se paga. Si un mes llegara a no entrar, lo que se corta es el detalle —el total y los
 * datos para transferir van arriba de todo, que es lo que hay que poder leer siempre.
 */
export function armarPdf(ordenes: Orden[]): Uint8Array {
  const contenido = armarContenido(ordenes);
  const imagenes = ordenes.filter((o): o is ImagenOrden => o.tipo === "imagen");

  // Los seis objetos fijos van primero; las imágenes se numeran a continuación, cada una con su
  // máscara de transparencia al lado. El orden importa porque las referencias son por número.
  const BASE = 6;
  const recursoImagenes = imagenes
    .map((_, i) => `/Im${i} ${BASE + 1 + i * 2} 0 R`)
    .join(" ");

  const objetos: number[][] = [
    aWinAnsi("<< /Type /Catalog /Pages 2 0 R >>"),
    aWinAnsi("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    aWinAnsi(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.ancho.toFixed(2)} ${A4.alto.toFixed(2)}] ` +
        `/Resources << /Font << /F1 5 0 R /F2 6 0 R >>` +
        (imagenes.length ? ` /XObject << ${recursoImagenes} >>` : "") +
        ` >> /Contents 4 0 R >>`,
    ),
    [...aWinAnsi(`<< /Length ${contenido.length} >>\nstream\n`), ...contenido, ...aWinAnsi("\nendstream")],
    aWinAnsi("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
    aWinAnsi("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"),
  ];

  imagenes.forEach((img, i) => {
    const pixeles = img.pxAncho * img.pxAlto;
    const alfa = new Uint8Array(pixeles);
    for (let k = 0; k < pixeles; k++) alfa[k] = img.rgba[k * 4 + 3]!;

    const idMascara = BASE + 2 + i * 2;

    if (img.tinte) {
      // Silueta: el color lo pone el `rg` del contenido y esto solo dice DÓNDE pintar. Un stencil
      // pesa un bit por píxel, pero pierde los bordes suavizados — y el logo tiene texto chico
      // abajo. Así que va como imagen de un color plano con el alfa de máscara, que los conserva.
      const plano = new Uint8Array(pixeles * 3).fill(255);
      const datos = deflateSync(Buffer.from(plano));
      objetos.push([
        ...aWinAnsi(
          `<< /Type /XObject /Subtype /Image /Width ${img.pxAncho} /Height ${img.pxAlto} ` +
            `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode ` +
            `/SMask ${idMascara} 0 R /Length ${datos.length} >>\nstream\n`,
        ),
        ...datos,
        ...aWinAnsi("\nendstream"),
      ]);
    } else {
      const rgb = new Uint8Array(pixeles * 3);
      for (let k = 0; k < pixeles; k++) {
        rgb[k * 3] = img.rgba[k * 4]!;
        rgb[k * 3 + 1] = img.rgba[k * 4 + 1]!;
        rgb[k * 3 + 2] = img.rgba[k * 4 + 2]!;
      }
      const datos = deflateSync(Buffer.from(rgb));
      objetos.push([
        ...aWinAnsi(
          `<< /Type /XObject /Subtype /Image /Width ${img.pxAncho} /Height ${img.pxAlto} ` +
            `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode ` +
            `/SMask ${idMascara} 0 R /Length ${datos.length} >>\nstream\n`,
        ),
        ...datos,
        ...aWinAnsi("\nendstream"),
      ]);
    }

    const mascara = deflateSync(Buffer.from(alfa));
    objetos.push([
      ...aWinAnsi(
        `<< /Type /XObject /Subtype /Image /Width ${img.pxAncho} /Height ${img.pxAlto} ` +
          `/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${mascara.length} >>\nstream\n`,
      ),
      ...mascara,
      ...aWinAnsi("\nendstream"),
    ]);
  });

  const bytes: number[] = [...aWinAnsi("%PDF-1.4\n")];
  const offsets: number[] = [];
  objetos.forEach((cuerpo, i) => {
    // El offset se mide sobre el buffer YA escrito. Calcularlo aparte es como se rompe un PDF:
    // un byte de diferencia y el visor abre la hoja en blanco sin decir nada.
    offsets.push(bytes.length);
    bytes.push(...aWinAnsi(`${i + 1} 0 obj\n`), ...cuerpo, ...aWinAnsi("\nendobj\n"));
  });

  const inicioXref = bytes.length;
  bytes.push(...aWinAnsi(`xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`));
  for (const o of offsets) bytes.push(...aWinAnsi(`${String(o).padStart(10, "0")} 00000 n \n`));
  bytes.push(...aWinAnsi(`trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`));

  return Uint8Array.from(bytes);
}
