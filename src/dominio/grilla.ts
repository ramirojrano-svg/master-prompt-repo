// src/dominio/grilla.ts — aritmética de la GRILLA de agenda. Función PURA y testeada: el
// componente no calcula nada (§6.4). Devuelve {fila, span, carril, carriles} por bloque.
//
// Tres cosas se rompieron en el SaaS anterior y están fijadas acá:
//  1. Las subcolumnas eran 12 FIJAS: un cluster de 13 simultáneos pedía gridColumn 13, CSS Grid
//     creaba una columna implícita y la fila se desbordaba — rompía la PANTALLA ENTERA, no solo
//     ese bloque. Ahora: carriles = max(MIN_SUBCOLS, maxCarriles) por columna, más clamp.
//  2. Un bloque que empieza ANTES de la apertura pedía grid-row 0 o negativa: se clampea a la
//     fila 1 mostrando solo su porción visible.
//  3. Un bloque que cruza la medianoche (23:30 + 60') desbordaba filas que el grid no tiene: se
//     recorta al cierre.
// El recorte es del LAYOUT, jamás del dato.

import type { Instante, Tz } from "./motor/tipos.ts";
import { partesEnZona } from "./motor/zona.ts";

export const MIN_SUBCOLS = 12;

export type BloqueEntrada = {
  id: string;
  columnaId: string; // la SALA en vista día; el DÍA en vista semana
  inicio: Instante;
  fin: Instante;
};

export type BloqueUbicado = {
  id: string;
  columnaId: string;
  fila: number; // 1-indexed (grid-row start)
  span: number; // cantidad de filas (>= 1)
  carril: number; // 0-indexed dentro de la columna
  carriles: number; // subcolumnas de ESA columna
  recortadoArriba: boolean; // empezaba antes de la apertura
  recortadoAbajo: boolean; // terminaba después del cierre
};

export type RangoVisible = {
  inicioDia: Instante; // instante de 00:00 local del día mostrado
  aperturaMin: number; // minutos desde medianoche local
  cierreMin: number;
  pasoMin: number;
};

/** Minutos desde el inicio del día local. Aritmética de INSTANTES: DST-safe y >1440 si cruza. */
function minutosDesde(inicioDia: Instante, i: Instante): number {
  return Math.round((i.getTime() - inicioDia.getTime()) / 60_000);
}

/** Minutos desde medianoche local de un instante (para derivar el rango visible). */
export function minutosDelDia(i: Instante, tz: Tz): number {
  const p = partesEnZona(i, tz);
  return p.hour * 60 + p.minute;
}

/**
 * Rango vertical visible: unión de los horarios de apertura y de los bloques del día, con una
 * hora de margen a cada lado. Nunca un rango fijo: hay salas que abren sábado a la mañana (§6.4).
 */
export function rangoVisible(a: {
  aperturas: { desdeMin: number; hastaMin: number }[];
  bloques: { desdeMin: number; hastaMin: number }[];
  defaultDesde?: number;
  defaultHasta?: number;
}): { aperturaMin: number; cierreMin: number } {
  const todos = [...a.aperturas, ...a.bloques];
  if (todos.length === 0) {
    return { aperturaMin: a.defaultDesde ?? 8 * 60, cierreMin: a.defaultHasta ?? 20 * 60 };
  }
  const min = Math.min(...todos.map((t) => t.desdeMin));
  const max = Math.max(...todos.map((t) => t.hastaMin));
  return {
    aperturaMin: Math.max(0, Math.floor((min - 60) / 60) * 60),
    cierreMin: Math.min(24 * 60, Math.ceil((max + 60) / 60) * 60),
  };
}

type Interno = BloqueEntrada & { desdeMin: number; hastaMin: number };

/** Clusters de bloques encadenados por solapamiento, dentro de una columna. */
function clusters(bloques: Interno[]): Interno[][] {
  const orden = [...bloques].sort((a, b) => a.desdeMin - b.desdeMin || a.hastaMin - b.hastaMin);
  const out: Interno[][] = [];
  let actual: Interno[] = [];
  let finMax = -Infinity;

  for (const b of orden) {
    // Semiabierto: un bloque que arranca justo cuando termina el anterior NO solapa.
    if (actual.length > 0 && b.desdeMin < finMax) {
      actual.push(b);
      finMax = Math.max(finMax, b.hastaMin);
    } else {
      if (actual.length > 0) out.push(actual);
      actual = [b];
      finMax = b.hastaMin;
    }
  }
  if (actual.length > 0) out.push(actual);
  return out;
}

/** Primer carril libre: el menor índice cuyo último bloque ya terminó. */
function asignarCarriles(cluster: Interno[]): Map<string, number> {
  const finDeCarril: number[] = [];
  const asignado = new Map<string, number>();
  for (const b of cluster) {
    let carril = finDeCarril.findIndex((fin) => fin <= b.desdeMin);
    if (carril === -1) {
      carril = finDeCarril.length;
      finDeCarril.push(b.hastaMin);
    } else {
      finDeCarril[carril] = b.hastaMin;
    }
    asignado.set(b.id, carril);
  }
  return asignado;
}

/** Ubica los bloques de TODAS las columnas. Las subcolumnas se calculan POR COLUMNA. */
export function ubicarBloques(bloques: BloqueEntrada[], r: RangoVisible): BloqueUbicado[] {
  const paso = r.pasoMin > 0 ? r.pasoMin : 30; // paso 0 => grilla imposible: cae al default
  const porColumna = new Map<string, Interno[]>();

  for (const b of bloques) {
    const desdeMin = minutosDesde(r.inicioDia, b.inicio);
    const hastaMin = minutosDesde(r.inicioDia, b.fin);
    if (hastaMin <= r.aperturaMin || desdeMin >= r.cierreMin) continue; // fuera del rango visible
    const lista = porColumna.get(b.columnaId) ?? [];
    lista.push({ ...b, desdeMin, hastaMin });
    porColumna.set(b.columnaId, lista);
  }

  const out: BloqueUbicado[] = [];

  for (const [columnaId, lista] of porColumna) {
    const grupos = clusters(lista);
    // Subcolumnas de ESTA columna: nunca menos que MIN_SUBCOLS, nunca menos que lo necesario.
    const maxCarriles = Math.max(1, ...grupos.map((g) => Math.max(...asignarCarriles(g).values()) + 1));
    const carriles = Math.max(MIN_SUBCOLS, maxCarriles);

    for (const g of grupos) {
      const asignado = asignarCarriles(g);
      for (const b of g) {
        const recortadoArriba = b.desdeMin < r.aperturaMin;
        const recortadoAbajo = b.hastaMin > r.cierreMin;
        const desde = Math.max(b.desdeMin, r.aperturaMin);
        const hasta = Math.min(b.hastaMin, r.cierreMin);

        const fila = Math.floor((desde - r.aperturaMin) / paso) + 1; // 1-indexed, nunca 0 ni negativa
        const filaFin = Math.ceil((hasta - r.aperturaMin) / paso) + 1;
        const span = Math.max(1, filaFin - fila); // un bloque siempre ocupa al menos una fila

        out.push({
          id: b.id,
          columnaId,
          fila,
          span,
          // clamp: aunque algo salga mal, el carril nunca pide una columna que el grid no tiene
          carril: Math.min(asignado.get(b.id) ?? 0, carriles - 1),
          carriles,
          recortadoArriba,
          recortadoAbajo,
        });
      }
    }
  }

  return out;
}

/** Filas totales de la grilla, para el CSS `grid-template-rows`. */
export function filasTotales(r: RangoVisible): number {
  const paso = r.pasoMin > 0 ? r.pasoMin : 30;
  return Math.max(1, Math.ceil((r.cierreMin - r.aperturaMin) / paso));
}
