// scripts/iconos.mjs — genera los íconos de la app desde public/logo.png.
//
// Se corre a mano cuando cambia el logo: `node scripts/iconos.mjs`. No va en el build porque los
// íconos son archivos estáticos que casi nunca cambian, y decodificar el PNG en cada despliegue
// sería trabajo por las dudas.
//
// Hace dos juegos distintos, y la diferencia importa:
//
//  · TRANSPARENTES (purpose "any"): el logo lo más grande que entre, sin fondo. Es el que usa la
//    barra de tareas del escritorio, y ahí un fondo blanco se ve como un recuadro pegado entre
//    íconos que no lo tienen.
//  · CON FONDO (purpose "maskable"): Android recorta el ícono con la forma que use el teléfono
//    —círculo, óvalo, cuadrado redondeado— y para eso el dibujo tiene que llegar hasta el borde y
//    el logo quedar dentro de la zona segura (el 80% central). Un maskable transparente deja que
//    el recorte muestre el fondo del launcher, que es justo lo que no se quiere.

import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { leerPng } from "../src/dominio/png.ts";

// ── Escribir un PNG ─────────────────────────────────────────────────────────
// Un PNG es firma + IHDR + IDAT + IEND, cada trozo con su CRC. El IDAT es el deflate de las filas
// con un byte de filtro adelante; con filtro 0 (ninguno) alcanza y sobra para un ícono.

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function trozo(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

function escribirPng({ ancho, alto, rgba }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // color 6 = RGBA
  // compresión, filtro y entrelazado: los tres en su único valor estándar

  const filas = Buffer.alloc(alto * (ancho * 4 + 1));
  for (let y = 0; y < alto; y++) {
    filas[y * (ancho * 4 + 1)] = 0; // filtro "ninguno"
    Buffer.from(rgba.buffer, rgba.byteOffset + y * ancho * 4, ancho * 4).copy(filas, y * (ancho * 4 + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", ihdr),
    trozo("IDAT", deflateSync(filas, { level: 9 })),
    trozo("IEND", Buffer.alloc(0)),
  ]);
}

// ── Dibujar el ícono ────────────────────────────────────────────────────────

/** El recuadro que ocupa el dibujo de verdad, ignorando el borde transparente. */
function recorte(img) {
  let minX = img.ancho, maxX = -1, minY = img.alto, maxY = -1;
  for (let y = 0; y < img.alto; y++) {
    for (let x = 0; x < img.ancho; x++) {
      if (img.rgba[(y * img.ancho + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { x: minX, y: minY, ancho: maxX - minX + 1, alto: maxY - minY + 1 };
}

/** Promedio bilineal del origen para el píxel destino: sin esto el logo sale dentado. */
function muestrear(img, fx, fy) {
  const x = Math.min(img.ancho - 1, Math.max(0, fx));
  const y = Math.min(img.alto - 1, Math.max(0, fy));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(img.ancho - 1, x0 + 1), y1 = Math.min(img.alto - 1, y0 + 1);
  const tx = x - x0, ty = y - y0;
  const salida = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const a = img.rgba[(y0 * img.ancho + x0) * 4 + c] * (1 - tx) + img.rgba[(y0 * img.ancho + x1) * 4 + c] * tx;
    const b = img.rgba[(y1 * img.ancho + x0) * 4 + c] * (1 - tx) + img.rgba[(y1 * img.ancho + x1) * 4 + c] * tx;
    salida[c] = Math.round(a * (1 - ty) + b * ty);
  }
  return salida;
}

/**
 * Dibuja el logo centrado en un lienzo cuadrado.
 *
 * `ocupa` es qué fracción del lado toma el logo. Transparente va a 0.94 —lo más grande que entra
 * sin tocar el borde— y maskable a 0.62, que es lo que deja el logo entero dentro del círculo
 * central aunque el teléfono recorte fuerte.
 */
function armarIcono(logo, lado, ocupa, fondo) {
  const rgba = new Uint8Array(lado * lado * 4);
  if (fondo) {
    for (let i = 0; i < lado * lado; i++) {
      rgba[i * 4] = fondo[0]; rgba[i * 4 + 1] = fondo[1]; rgba[i * 4 + 2] = fondo[2]; rgba[i * 4 + 3] = 255;
    }
  }

  const r = recorte(logo);
  const escala = (lado * ocupa) / Math.max(r.ancho, r.alto);
  const anchoDest = Math.round(r.ancho * escala);
  const altoDest = Math.round(r.alto * escala);
  const offX = Math.round((lado - anchoDest) / 2);
  const offY = Math.round((lado - altoDest) / 2);

  for (let y = 0; y < altoDest; y++) {
    for (let x = 0; x < anchoDest; x++) {
      const [sr, sg, sb, sa] = muestrear(logo, r.x + (x / anchoDest) * r.ancho, r.y + (y / altoDest) * r.alto);
      const k = ((offY + y) * lado + (offX + x)) * 4;
      if (!fondo) {
        rgba[k] = sr; rgba[k + 1] = sg; rgba[k + 2] = sb; rgba[k + 3] = sa;
      } else {
        // Sobre fondo opaco se mezcla, en vez de pisar: si no, el borde suavizado del logo deja
        // un halo del color de atrás del archivo original.
        const a = sa / 255;
        rgba[k] = Math.round(sr * a + rgba[k] * (1 - a));
        rgba[k + 1] = Math.round(sg * a + rgba[k + 1] * (1 - a));
        rgba[k + 2] = Math.round(sb * a + rgba[k + 2] * (1 - a));
        rgba[k + 3] = 255;
      }
    }
  }
  return { ancho: lado, alto: lado, rgba };
}

const logo = leerPng(readFileSync("public/logo.png"));
if (!logo) throw new Error("no pude leer public/logo.png");

const BLANCO = [255, 255, 255];
const salidas = [
  ["public/icono-192.png", 192, 0.94, null],
  ["public/icono-512.png", 512, 0.94, null],
  ["public/icono-maskable-512.png", 512, 0.62, BLANCO],
  // iOS no respeta la transparencia: compone el ícono sobre negro y le aplica su propia esquina
  // redondeada. Así que este va con fondo sí o sí, y con menos margen que el maskable de Android
  // porque el recorte de iOS es siempre el mismo y no se come las esquinas.
  ["app/apple-icon.png", 180, 0.82, BLANCO],
];

for (const [ruta, lado, ocupa, fondo] of salidas) {
  const png = escribirPng(armarIcono(logo, lado, ocupa, fondo));
  writeFileSync(ruta, png);
  console.log(`${ruta}  ${lado}x${lado}  ${fondo ? "con fondo" : "transparente"}  ${Math.round(png.length / 1024)} KB`);
}
