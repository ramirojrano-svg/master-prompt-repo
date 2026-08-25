// src/servicios/plata/liquidacion-pdf.ts — la liquidación como archivo.
//
// Existe porque "Imprimir o guardar PDF" pasa por el diálogo del navegador: hay que elegir
// destino, esperar la vista previa y acordarse de sacar los encabezados. Para bajar veintinueve
// liquidaciones eso son veintinueve diálogos.
//
// El diseño sigue al de la pantalla —membrete azul con el logo, las dos fechas, el detalle día por
// día, el total y a dónde transferir— pero no comparte código con ella: uno es HTML que se adapta
// al ancho y el otro es una hoja A4 con coordenadas fijas. Intentar unificarlos daría una
// abstracción que no le sirve bien a ninguno de los dos.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { armarPdf, mm, A4, type Orden } from "../../dominio/pdf.ts";
import { achicar, leerPng, type Imagen } from "../../dominio/png.ts";
import { formatearPesos } from "../../dominio/tarifa.ts";
import { horasYMinutos, nombreDePeriodo } from "../../dominio/reporte.ts";
import { hayDatosDeCobro, type DatosDeCobro } from "../config/cobro.ts";
import type { DetalleLiquidacion } from "./detalle-liquidacion.ts";

const MARCA = { r: 16, g: 54, b: 92 }; // el azul profundo del logo
const TENUE = { r: 92, g: 115, b: 130 };
const TEXTO = { r: 15, g: 44, b: 63 };
const ERROR = { r: 192, g: 52, b: 43 };
const BORDE = { r: 219, g: 232, b: 238 };
const SUAVE = { r: 244, g: 249, b: 251 };

const IZQ = mm(18);
const DER = A4.ancho - mm(18);

/**
 * El logo, leído una sola vez.
 *
 * Se cachea en el módulo porque decodificar el PNG cuesta —hay que inflar y desfiltrar 794×647— y
 * el archivo no cambia entre una liquidación y otra. Se achica a un cuarto: en la hoja entra a
 * menos de 200 px de ancho, y mandar el original serían cientos de kilobytes para dibujar algo del
 * tamaño de una estampilla.
 *
 * Si el archivo no está o el PNG no es de los que sabemos leer, queda en null y el membrete sale
 * sin logo. Una liquidación sin logo sirve igual; una que no se puede descargar, no.
 */
let logoCache: Imagen | null | undefined;
function logo(): Imagen | null {
  if (logoCache !== undefined) return logoCache;
  try {
    const png = leerPng(readFileSync(join(process.cwd(), "public", "logo.png")));
    logoCache = png ? achicar(png, 4) : null;
  } catch {
    logoCache = null;
  }
  return logoCache;
}

const dia = (d: Date) => d.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" });
const fechaLarga = (d: Date) => d.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });

/** Corta un texto que no entra, con puntos suspensivos: en una hoja A4 el ancho no es negociable. */
function recortar(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function pdfDeLiquidacion(d: DetalleLiquidacion, cobro: DatosDeCobro): Uint8Array {
  const plata = (n: bigint) => formatearPesos(n, d.moneda);
  const o: Orden[] = [];
  let y = 0;

  // ── Membrete ──────────────────────────────────────────────────────────────
  // Igual que en pantalla: banda azul, el logo en blanco a la izquierda y el nombre al lado.
  o.push({ tipo: "caja", x: 0, y: 0, ancho: A4.ancho, alto: mm(26), color: MARCA });

  const img = logo();
  let xTexto = IZQ;
  if (img) {
    // Alto fijo y ancho proporcional: el logo no se deforma aunque cambie el archivo.
    const alto = mm(14);
    const ancho = (alto * img.ancho) / img.alto;
    o.push({
      tipo: "imagen", x: IZQ, y: mm(6), ancho, alto,
      rgba: img.rgba, pxAncho: img.ancho, pxAlto: img.alto,
      // El PNG es azul sobre transparente y la banda es azul oscuro: sin el tinte, el logo
      // desaparecería contra el fondo. Es lo mismo que en pantalla hace un filtro de CSS.
      tinte: { r: 255, g: 255, b: 255 },
    });
    xTexto = IZQ + ancho + mm(5);
  }

  o.push({ tipo: "texto", x: xTexto, y: mm(13), texto: d.centro.nombre, tam: 15, fuente: "Helvetica-Bold", color: { r: 255, g: 255, b: 255 } });
  o.push({ tipo: "texto", x: xTexto, y: mm(19), texto: `Liquidación de ${nombreDePeriodo(d.periodo)}`, tam: 10, color: { r: 200, g: 218, b: 233 } });

  // ── Las dos fechas y el destinatario ──────────────────────────────────────
  y = mm(38);
  o.push({ tipo: "texto", x: IZQ, y, texto: "Fecha de emisión", tam: 8, color: TENUE });
  o.push({ tipo: "texto", x: IZQ + mm(45), y, texto: "Vence el", tam: 8, color: TENUE });
  o.push({ tipo: "texto-der", x: DER, y, texto: "Emitida a", tam: 8, color: TENUE });
  y += mm(6);
  o.push({ tipo: "texto", x: IZQ, y, texto: d.emitidaAt ? fechaLarga(d.emitidaAt) : "Sin emitir", tam: 10, color: TEXTO });
  // El vencimiento en rojo y en negrita: es el único dato del papel que tiene consecuencias.
  o.push({ tipo: "texto", x: IZQ + mm(45), y, texto: fechaLarga(d.venceEl), tam: 10, fuente: "Helvetica-Bold", color: ERROR });
  o.push({ tipo: "texto-der", x: DER, y, texto: recortar(d.receptor, 40), tam: 10, fuente: "Helvetica-Bold", color: TEXTO });

  // ── El resumen del mes ────────────────────────────────────────────────────
  y += mm(12);
  if (d.sesiones > 0) {
    const s = `Para ${nombreDePeriodo(d.periodo)} reservó ${horasYMinutos(d.minutosUsados)} de consultorio, en ${d.sesiones} ${d.sesiones === 1 ? "sesión" : "sesiones"}.`;
    o.push({ tipo: "texto", x: IZQ, y, texto: s, tam: 10, color: TEXTO });
    y += mm(10);
  }

  // ── El detalle ────────────────────────────────────────────────────────────
  o.push({ tipo: "texto", x: IZQ, y, texto: "Detalle día por día", tam: 11, fuente: "Helvetica-Bold", color: TEXTO });
  y += mm(7);
  o.push({ tipo: "texto", x: IZQ, y, texto: "FECHA", tam: 7, color: TENUE });
  o.push({ tipo: "texto", x: IZQ + mm(28), y, texto: "CONCEPTO", tam: 7, color: TENUE });
  o.push({ tipo: "texto-der", x: DER, y, texto: "IMPORTE", tam: 7, color: TENUE });
  y += mm(2);
  o.push({ tipo: "linea", x1: IZQ, y1: y, x2: DER, y2: y, color: BORDE });

  // Lo que entra en una hoja. Si un mes tuviera más renglones, se corta el DETALLE y no el total:
  // el importe a pagar no puede quedar afuera de la hoja por culpa de una lista larga.
  const CABEN = 26;
  d.lineas.slice(0, CABEN).forEach((l, i) => {
    y += mm(6);
    // Rayado alterno, como en pantalla: con veinte renglones de importes parecidos, la banda es
    // lo que evita leer el de la fila de al lado.
    if (i % 2 === 1) o.push({ tipo: "caja", x: IZQ, y: y - mm(4), ancho: DER - IZQ, alto: mm(6), color: SUAVE });
    o.push({ tipo: "texto", x: IZQ, y, texto: dia(l.fecha), tam: 9, color: TEXTO });
    o.push({ tipo: "texto", x: IZQ + mm(28), y, texto: recortar(l.detalle, 46), tam: 9, color: TEXTO });
    o.push({ tipo: "texto-der", x: DER, y, texto: plata(l.montoCent), tam: 9, color: TEXTO });
    o.push({ tipo: "linea", x1: IZQ, y1: y + mm(2), x2: DER, y2: y + mm(2), color: BORDE });
  });
  if (d.lineas.length > CABEN) {
    y += mm(6);
    o.push({ tipo: "texto", x: IZQ, y, texto: `y ${d.lineas.length - CABEN} más — el detalle completo está en la app`, tam: 8, color: TENUE });
  }

  // ── El total ──────────────────────────────────────────────────────────────
  y += mm(11);
  o.push({ tipo: "caja", x: IZQ, y: y - mm(6), ancho: DER - IZQ, alto: mm(11), color: SUAVE });
  y += mm(1);
  o.push({ tipo: "texto", x: IZQ + mm(3), y, texto: "Total", tam: 12, fuente: "Helvetica-Bold", color: TEXTO });
  o.push({ tipo: "texto-der", x: DER - mm(3), y, texto: plata(d.totalCent), tam: 15, fuente: "Helvetica-Bold", color: TEXTO });

  // ── A dónde transferir ────────────────────────────────────────────────────
  if (d.totalCent > 0n && hayDatosDeCobro(cobro)) {
    // `paraCopiar` marca los dos que no se leen sino que se PEGAN en el homebanking.
    //
    // Van en dos renglones —la etiqueta arriba, el valor solo abajo— y no en la misma línea que su
    // rótulo. El motivo es de uso, no de estética: al tocar dos veces, el visor de PDF aplica su
    // propia regla de qué es "una palabra" y corta el alias en el punto o se come el último dígito
    // del CBU. Eso lo decide el visor y no se puede cambiar desde el archivo —está verificado: acá
    // adentro cada valor viaja como UNA cadena entera—. Lo que sí se puede es dejar el valor solo
    // en su renglón, para que arrastrar el dedo sobre esa línea lo tome completo sin pelearse con
    // dónde el visor cree que termina la palabra.
    const filas = [
      cobro.titular && { rotulo: "Titular", valor: cobro.titular, paraCopiar: false },
      cobro.cuit && { rotulo: "CUIT", valor: cobro.cuit, paraCopiar: false },
      cobro.banco && { rotulo: "Banco", valor: cobro.banco, paraCopiar: false },
      cobro.alias && { rotulo: "Alias", valor: cobro.alias, paraCopiar: true },
      cobro.cbu && { rotulo: "CBU/CVU", valor: cobro.cbu, paraCopiar: true },
    ].filter(Boolean) as { rotulo: string; valor: string; paraCopiar: boolean }[];

    y += mm(10);
    const altoFilas = filas.reduce((acc, f) => acc + (f.paraCopiar ? mm(9) : mm(5.5)), 0);
    const alto = mm(12) + altoFilas + (cobro.nota ? mm(6) : 0);
    o.push({ tipo: "caja", x: IZQ, y, ancho: DER - IZQ, alto, color: SUAVE });
    y += mm(7);
    o.push({ tipo: "texto", x: IZQ + mm(5), y, texto: "Para transferir", tam: 10, fuente: "Helvetica-Bold", color: TEXTO });
    for (const f of filas) {
      if (f.paraCopiar) {
        y += mm(4.5);
        o.push({ tipo: "texto", x: IZQ + mm(5), y, texto: f.rotulo, tam: 8, color: TENUE });
        y += mm(4.5);
        o.push({ tipo: "texto", x: IZQ + mm(5), y, texto: f.valor, tam: 11, fuente: "Helvetica-Bold", color: TEXTO });
      } else {
        y += mm(5.5);
        o.push({ tipo: "texto", x: IZQ + mm(5), y, texto: f.rotulo, tam: 9, color: TENUE });
        o.push({ tipo: "texto", x: IZQ + mm(28), y, texto: f.valor, tam: 9, fuente: "Helvetica-Bold", color: TEXTO });
      }
    }
    if (cobro.nota) {
      y += mm(5.5);
      o.push({ tipo: "texto", x: IZQ + mm(5), y, texto: recortar(cobro.nota, 90), tam: 8, color: TENUE });
    }
  }

  return armarPdf(o);
}

/** El nombre con el que baja el archivo: se reconoce en la carpeta de descargas sin abrirlo. */
export function nombreDelArchivo(d: DetalleLiquidacion): string {
  const quien = d.receptor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `liquidacion-${d.periodo}-${quien || "profesional"}.pdf`;
}
