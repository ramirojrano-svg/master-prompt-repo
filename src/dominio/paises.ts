// src/dominio/paises.ts — registro central por país (§7.19). ESTE es el único lugar donde las
// zonas IANA son literales legítimos: la zona se DERIVA del país en el alta y viaja como
// parámetro a todo el resto (regla dura §14.4). Nunca se inventa una ley: lo no verificado cae
// a una frase genérica. Un test (§7.19) impide agregar un país a medias.

import type { Tz } from "./motor/tipos.ts";

export type Pais = "AR" | "UY" | "CL" | "MX";

export type InfoPais = {
  moneda: string; // ISO 4217
  tz: Tz; // IANA, verificada contra Intl
  prefijo: number; // prefijo telefónico E.164
  fraseLegal: string; // referencia verificada o genérica; JAMÁS una ley inventada
};

const GENERICA =
  "Verificá con un profesional matriculado la normativa de protección de datos y las " +
  "obligaciones fiscales vigentes en tu país. Este software no constituye asesoramiento legal.";

export const PAISES: Readonly<Record<Pais, InfoPais>> = {
  AR: { moneda: "ARS", tz: "America/Argentina/Buenos_Aires", prefijo: 54, fraseLegal: GENERICA },
  UY: { moneda: "UYU", tz: "America/Montevideo", prefijo: 598, fraseLegal: GENERICA },
  CL: { moneda: "CLP", tz: "America/Santiago", prefijo: 56, fraseLegal: GENERICA },
  MX: { moneda: "MXN", tz: "America/Mexico_City", prefijo: 52, fraseLegal: GENERICA },
};

export function esPaisSoportado(p: string): p is Pais {
  return Object.prototype.hasOwnProperty.call(PAISES, p);
}

/** Zona horaria del país, o null si no está soportado. Se setea en el alta, nunca por default. */
export function zonaDePais(p: string): Tz | null {
  return esPaisSoportado(p) ? PAISES[p].tz : null;
}

export function monedaDePais(p: string): string | null {
  return esPaisSoportado(p) ? PAISES[p].moneda : null;
}
