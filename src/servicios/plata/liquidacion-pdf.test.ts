// src/servicios/plata/liquidacion-pdf.test.ts — que el papel salga bien armado.
//
// El PDF se genera a mano, sin librería: objetos, tabla `xref` con los desplazamientos exactos en
// bytes y el texto en operadores `Tj`. Nada de eso lanza una excepción si sale mal — un PDF
// malformado se abre como una hoja en blanco, y eso se descubre cuando alguien no puede leer su
// liquidación.
//
// Lo que se prueba, sobre todo, es una propiedad que se pagó cara: que el ALIAS y el CBU viajen
// como UNA cadena entera. El profesional no los lee, los pega en el homebanking, y si el archivo
// los partiera en pedazos no habría forma de copiarlos completos. (Que el visor igual los corte al
// tocar dos veces es otra cosa, y esa no depende del archivo.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { pdfDeLiquidacion, nombreDelArchivo } from "./liquidacion-pdf.ts";
import type { DetalleLiquidacion } from "./detalle-liquidacion.ts";
import type { DatosDeCobro } from "../config/cobro.ts";

const ALIAS = "ramirorano.astropay";
const CBU = "0000177500099146760167";

const detalle: DetalleLiquidacion = {
  id: "liq1", numero: 7, periodo: "2026-09", estado: "emitida",
  emitidaAt: new Date("2026-08-31T12:00:00Z"), venceEl: new Date("2026-10-07T12:00:00Z"),
  receptor: "Marta Gil", receptorCuit: null, receptorCondIva: "no informada",
  inquilinoId: "in1",
  subtotalCent: 252_000_00n, ivaCent: 0n, alicuota: 0, totalCent: 252_000_00n, moneda: "ARS",
  lineas: [
    { concepto: "cargo_uso", detalle: "reservó 1 h · Consultorio 1", montoCent: 18_000_00n, minutos: 60, fecha: new Date("2026-09-01T13:00:00Z") },
  ],
  minutosUsados: 840, sesiones: 14,
  pagos: [], pagadoCent: 0n, saldoCent: 252_000_00n,
  centro: { nombre: "Espacio Montes de Oca" },
};

const cobro: DatosDeCobro = {
  titular: "Ramiro Julian Raño", cuit: "20-39770377-1", banco: "Astropay",
  alias: ALIAS, cbu: CBU, nota: null, diaVencimiento: 7,
};

/** Todo el texto que el PDF dibuja, sacado de sus operadores `Tj`. */
function textosDel(pdf: Uint8Array): string[] {
  const crudo = Buffer.from(pdf);
  const salida: string[] = [];
  const re = /stream\r?\n/g;
  for (let m = re.exec(crudo.toString("latin1")); m; m = re.exec(crudo.toString("latin1"))) {
    const fin = crudo.toString("latin1").indexOf("endstream", m.index);
    if (fin === -1) continue;
    let cuerpo = crudo.subarray(m.index + m[0].length, fin);
    try { cuerpo = inflateSync(cuerpo); } catch { /* sin comprimir */ }
    for (const t of cuerpo.toString("latin1").matchAll(/\((.*?)\) Tj/g)) salida.push(t[1]!);
  }
  return salida;
}

test("el archivo es un PDF de verdad", () => {
  const pdf = pdfDeLiquidacion(detalle, cobro);
  assert.equal(Buffer.from(pdf.subarray(0, 5)).toString(), "%PDF-", "sin la firma no lo abre nadie");
  assert.ok(Buffer.from(pdf).toString("latin1").includes("%%EOF"), "y tiene que cerrar");
  assert.ok(pdf.length > 1000, "un PDF de una liquidación no puede pesar cuatro bytes");
});

test("el ALIAS viaja como una sola cadena entera", () => {
  const textos = textosDel(pdfDeLiquidacion(detalle, cobro));
  assert.ok(
    textos.includes(ALIAS),
    `el alias tiene que estar entero en un solo Tj. Lo que hay: ${JSON.stringify(textos.filter((t) => t.includes("astropay") || t.includes("ramiro")))}`,
  );
});

test("el CBU viaja entero, con sus 22 dígitos y el último incluido", () => {
  const textos = textosDel(pdfDeLiquidacion(detalle, cobro));
  const cbu = textos.find((t) => t.startsWith("00001775"));
  assert.equal(cbu, CBU, "partido, el CBU no se puede copiar de una");
  assert.equal(cbu?.length, 22);
  assert.ok(cbu?.endsWith("7"), "el último dígito es el que se perdía");
});

test("el alias y el CBU van SOLOS en su renglón, sin el rótulo pegado", () => {
  // Es lo que permite seleccionarlos de una pasada con el dedo: si el rótulo compartiera la línea,
  // arrastrar sobre ella se llevaría "CBU/CVU" adentro del valor pegado en el homebanking.
  const textos = textosDel(pdfDeLiquidacion(detalle, cobro));
  assert.ok(textos.includes("Alias"), "el rótulo existe…");
  assert.ok(textos.includes(ALIAS), "…y el valor va aparte");
  assert.ok(!textos.some((t) => t.includes("Alias") && t.includes("astropay")), "nunca en la misma cadena");
  assert.ok(!textos.some((t) => t.includes("CBU") && t.includes("00001775")), "ni el CBU con su rótulo");
});

test("sin datos de cobro cargados no inventa la sección", () => {
  const vacio: DatosDeCobro = { titular: null, cuit: null, banco: null, alias: null, cbu: null, nota: null, diaVencimiento: 7 };
  const textos = textosDel(pdfDeLiquidacion(detalle, vacio));
  assert.ok(!textos.includes("Para transferir"), "un papel sin a dónde pagar no promete a dónde pagar");
});

test("el nombre del archivo se reconoce en la carpeta de descargas", () => {
  const n = nombreDelArchivo(detalle);
  assert.match(n, /\.pdf$/);
  assert.ok(n.includes("2026-09"), "el mes es lo que uno busca cuando tiene doce");
});
