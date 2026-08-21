// src/dominio/png.ts — leer un PNG sin depender de nada.
//
// Módulo casi puro: lo único que toma prestado es `zlib`, que viene con Node. Existe para poder
// meter el logo del centro dentro del PDF de la liquidación.
//
// El PDF no entiende PNG. Entiende imágenes en crudo comprimidas con deflate, que es justamente
// lo que un PNG tiene adentro — pero con un filtro por fila encima que hay que deshacer. Son unas
// cuarenta líneas, contra el mega y medio de una librería de imágenes que además traería
// decodificadores de formatos que nunca vamos a usar.
//
// Solo soporta lo que hace falta: 8 bits por canal, color 6 (RGBA) o 2 (RGB), sin entrelazado. Un
// PNG fuera de eso devuelve null en vez de dibujar cualquier cosa — el logo se omite y la
// liquidación sale igual, que es mucho mejor que no salir.

import { inflateSync } from "node:zlib";

export type Imagen = { ancho: number; alto: number; rgba: Uint8Array };

const FIRMA = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** El byte de filtro de PNG: cada fila declara con cuál se codificó (§9.2 de la especificación). */
function desfiltrar(cruda: Buffer, ancho: number, alto: number, canales: number): Uint8Array {
  const paso = ancho * canales;
  const salida = new Uint8Array(paso * alto);

  for (let y = 0; y < alto; y++) {
    const filtro = cruda[y * (paso + 1)]!;
    const origen = y * (paso + 1) + 1;
    const destino = y * paso;

    for (let x = 0; x < paso; x++) {
      const bruto = cruda[origen + x]!;
      // `a` es el píxel de la izquierda, `b` el de arriba, `c` el de arriba a la izquierda.
      const a = x >= canales ? salida[destino + x - canales]! : 0;
      const b = y > 0 ? salida[destino - paso + x]! : 0;
      const c = x >= canales && y > 0 ? salida[destino - paso + x - canales]! : 0;

      let valor: number;
      switch (filtro) {
        case 0: valor = bruto; break;
        case 1: valor = bruto + a; break;
        case 2: valor = bruto + b; break;
        case 3: valor = bruto + ((a + b) >> 1); break;
        case 4: {
          // Paeth: elige el vecino que menos se aparta de la predicción a+b−c.
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          valor = bruto + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: return salida; // filtro desconocido: se corta acá en vez de inventar píxeles
      }
      salida[destino + x] = valor & 0xff;
    }
  }
  return salida;
}

/** Devuelve la imagen en RGBA, o `null` si el PNG no es de los que sabemos leer. */
export function leerPng(datos: Buffer): Imagen | null {
  if (datos.length < 8 || FIRMA.some((b, i) => datos[i] !== b)) return null;

  let ancho = 0;
  let alto = 0;
  let canales = 0;
  const trozos: Buffer[] = [];

  let p = 8;
  while (p + 8 <= datos.length) {
    const largo = datos.readUInt32BE(p);
    const tipo = datos.toString("ascii", p + 4, p + 8);
    const cuerpo = datos.subarray(p + 8, p + 8 + largo);

    if (tipo === "IHDR") {
      ancho = cuerpo.readUInt32BE(0);
      alto = cuerpo.readUInt32BE(4);
      const profundidad = cuerpo[8]!;
      const color = cuerpo[9]!;
      const entrelazado = cuerpo[12]!;
      if (profundidad !== 8 || entrelazado !== 0) return null;
      if (color === 6) canales = 4;
      else if (color === 2) canales = 3;
      else return null; // paleta y escala de grises: no hacen falta acá
    } else if (tipo === "IDAT") {
      trozos.push(cuerpo);
    } else if (tipo === "IEND") {
      break;
    }
    p += 12 + largo; // largo + tipo + datos + CRC
  }
  if (!ancho || !alto || !canales || trozos.length === 0) return null;

  const plano = desfiltrar(inflateSync(Buffer.concat(trozos)), ancho, alto, canales);

  // Se normaliza todo a RGBA: quien lo usa no tiene que preguntarse si había alfa.
  const rgba = new Uint8Array(ancho * alto * 4);
  for (let i = 0, j = 0; i < ancho * alto; i++, j += 4) {
    const k = i * canales;
    rgba[j] = plano[k]!;
    rgba[j + 1] = plano[k + 1]!;
    rgba[j + 2] = plano[k + 2]!;
    rgba[j + 3] = canales === 4 ? plano[k + 3]! : 255;
  }
  return { ancho, alto, rgba };
}

/**
 * Achica la imagen promediando bloques de `factor`×`factor`.
 *
 * El logo mide 794 px de ancho y en la hoja entra a menos de 200: mandar el original al PDF sería
 * medio mega para dibujar algo del tamaño de una estampilla. Promediar y no saltear píxeles
 * porque el logo tiene texto chico abajo, y saltear lo deja dentado.
 */
export function achicar(img: Imagen, factor: number): Imagen {
  if (factor <= 1) return img;
  const ancho = Math.max(1, Math.floor(img.ancho / factor));
  const alto = Math.max(1, Math.floor(img.alto / factor));
  const rgba = new Uint8Array(ancho * alto * 4);

  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const sy = y * factor + dy;
          const sx = x * factor + dx;
          if (sy >= img.alto || sx >= img.ancho) continue;
          const k = (sy * img.ancho + sx) * 4;
          r += img.rgba[k]!; g += img.rgba[k + 1]!; b += img.rgba[k + 2]!; a += img.rgba[k + 3]!;
          n++;
        }
      }
      const k = (y * ancho + x) * 4;
      rgba[k] = Math.round(r / n); rgba[k + 1] = Math.round(g / n);
      rgba[k + 2] = Math.round(b / n); rgba[k + 3] = Math.round(a / n);
    }
  }
  return { ancho, alto, rgba };
}
