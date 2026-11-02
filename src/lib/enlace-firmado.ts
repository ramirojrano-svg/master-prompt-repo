// src/lib/enlace-firmado.ts — una llave para UN documento, que vence sola.
//
// Para qué existe: acá se cobra por WhatsApp, y un link de `wa.me` solo puede llevar texto. Para
// que el PDF viaje hace falta una dirección que el profesional pueda abrir SIN entrar a la app —
// la mitad no tiene usuario, y pedirle que se cree uno para ver su propia cuenta es pedirle de
// más.
//
// QUÉ ES Y QUÉ NO. Es una llave de una sola cerradura: abre ese documento y ninguna otra cosa. No
// crea sesión, no da acceso al panel, no sirve para listar nada. Quien la tenga puede ver esa
// liquidación — igual que quien reciba el PDF por mail puede reenviarlo—, así que se trata como lo
// que es: algo que se manda por un canal privado y que caduca.
//
// POR QUÉ FIRMA Y NO UNA TABLA DE TOKENS. El reset de contraseña guarda el hash en la base porque
// tiene que poder QUEMARSE: se usa una vez y muere. Esto es lo contrario — el profesional va a
// abrir su liquidación las veces que quiera mientras la tenga que pagar—, así que no hay estado
// que guardar. Una firma HMAC alcanza, no agrega una tabla ni una escritura por envío, y el
// vencimiento viaja adentro de la propia firma: no se puede correr sin romperla.

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Cuánto vive. Noventa días: la liquidación de un mes se paga en días, pero se consulta después
 * —"¿cuánto era lo de noviembre?"— y un link muerto a la semana obliga a volver a mandarlo. Pasado
 * ese plazo deja de abrir, que es el punto de que venza.
 */
export const DIAS_VIGENCIA = 90;

/** El secreto de la app. Si falta, no se firma nada: mejor sin botón que con una llave de juguete. */
function secreto(): string | null {
  const s = process.env.AUTH_SECRET;
  return s && s.length >= 16 ? s : null;
}

function firma(datos: string, clave: string): string {
  return createHmac("sha256", clave).update(datos).digest("base64url");
}

/**
 * La llave de un documento. `null` si no hay secreto configurado.
 *
 * El id y el vencimiento viajan en claro y firmados: el que recibe el link no tiene por qué
 * poder leerlos, pero tampoco hay nada secreto ahí — lo secreto es la firma, que es lo único
 * que no se puede fabricar.
 */
export function firmarEnlace(id: string, ahora: Date = new Date(), dias = DIAS_VIGENCIA): string | null {
  const clave = secreto();
  if (!clave) return null;
  const vence = Math.floor(ahora.getTime() / 1000) + dias * 86_400;
  const datos = `${id}.${vence}`;
  return `${datos}.${firma(datos, clave)}`;
}

export type Verificacion =
  | { ok: true; id: string }
  | { ok: false; motivo: "sin_secreto" | "malformado" | "firma_invalida" | "vencido" };

/**
 * Qué documento abre esta llave, si es que abre alguno.
 *
 * El orden importa: primero se verifica la FIRMA y recién después el vencimiento. Al revés, un
 * token inventado con una fecha vieja contestaría "vencido" en vez de "inválido", y eso le dice
 * al que prueba que la fecha es un campo que puede tocar.
 */
export function verificarEnlace(token: string, ahora: Date = new Date()): Verificacion {
  const clave = secreto();
  if (!clave) return { ok: false, motivo: "sin_secreto" };

  const partes = token.split(".");
  if (partes.length !== 3) return { ok: false, motivo: "malformado" };
  const [id, venceTexto, recibida] = partes as [string, string, string];
  if (!id || !/^\d+$/.test(venceTexto)) return { ok: false, motivo: "malformado" };

  const esperada = firma(`${id}.${venceTexto}`, clave);
  // Comparación en tiempo constante: una comparación común filtra, por lo que tarda en fallar,
  // cuántos caracteres del principio acertó quien está probando.
  const a = Buffer.from(recibida);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, motivo: "firma_invalida" };

  if (Number(venceTexto) * 1000 <= ahora.getTime()) return { ok: false, motivo: "vencido" };
  return { ok: true, id };
}
