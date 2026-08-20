// src/dominio/csv.ts — armar un CSV que Excel abra sin pelear.
//
// Módulo PURO: no sabe de qué se exporta. Existe porque hacer un CSV "a ojo" —pegar valores con
// comas— funciona hasta que un nombre trae una coma ("Terrón, Marta") o un importe trae comillas,
// y ahí el archivo se corre una columna y nadie se entera hasta que los números no cierran.

/** Escapa un valor según el RFC: comillas dobles si hay coma, comilla o salto; las comillas se duplican. */
export function celda(v: string | number | bigint | Date | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Arma el CSV completo.
 *
 * Dos decisiones que parecen manías y no lo son:
 *  · CRLF como fin de línea: es lo que pide el RFC y lo que Excel de Windows espera.
 *  · BOM al principio: sin él, Excel abre el archivo en su codificación local y "Terrón" se lee
 *    "TerrÃ³n". Media agenda de este centro tiene tildes o eñes.
 */
export function armarCsv(encabezados: string[], filas: (string | number | bigint | Date | null | undefined)[][]): string {
  const lineas = [encabezados.map(celda).join(","), ...filas.map((f) => f.map(celda).join(","))];
  return "﻿" + lineas.join("\r\n") + "\r\n";
}
