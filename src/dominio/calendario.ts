// src/dominio/calendario.ts — la aritmética del calendario (día / semana / mes). PURA.
//
// Todo lo que en Google Calendar parece obvio y acá se rompe si se hace con Date:
//  · La semana arranca en DOMINGO (como la del calendario que se usa de referencia).
//  · La grilla del mes SIEMPRE tiene 6 filas de 7 días, aunque sobren días del mes anterior y del
//    siguiente: si el alto cambia según el mes, la pantalla salta al navegar.
//  · Navegar de mes en mes desde un 31 no puede caer en el mes equivocado (31 de marzo + 1 mes).
//
// Nada de esto toca zonas horarias: son fechas de calendario ('YYYY-MM-DD'). El instante real lo
// resuelve zona.ts con la zona de la SEDE.

import { diaSemanaDeFecha, esFechaCalendarioValida, sumarDiasLocal } from "./motor/zona.ts";

export type Vista = "dia" | "semana" | "mes";
export type FechaLocal = string;

export const VISTAS: Vista[] = ["dia", "semana", "mes"];

export function esVista(v: string): v is Vista {
  return (VISTAS as string[]).includes(v);
}

const NOMBRE_MES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const NOMBRE_DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export const DIA_CORTO = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];

/** El domingo de la semana de `fecha` (la semana arranca en domingo). */
export function domingoDe(fecha: FechaLocal): FechaLocal {
  const d = diaSemanaDeFecha(fecha);
  return d == null ? fecha : sumarDiasLocal(fecha, -d)!;
}

/** El día 1 del mes de `fecha`. */
export function primeroDelMes(fecha: FechaLocal): FechaLocal {
  return `${fecha.slice(0, 7)}-01`;
}

/** Cantidad de días del mes de `fecha`. */
export function diasDelMes(fecha: FechaLocal): number {
  const anio = Number(fecha.slice(0, 4));
  const mes = Number(fecha.slice(5, 7));
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/**
 * Los días que muestra cada vista.
 *   día    → 1
 *   semana → 7, de domingo a sábado
 *   mes    → 42 (6 semanas), arrancando en el domingo previo al día 1
 * Que el mes sean SIEMPRE 42 días es a propósito: una grilla que cambia de alto según el mes hace
 * saltar la pantalla al navegar, y es el detalle que delata a un calendario hecho a mano.
 */
export function diasDeVista(vista: Vista, fecha: FechaLocal): FechaLocal[] {
  if (vista === "dia") return [fecha];
  if (vista === "semana") {
    const dom = domingoDe(fecha);
    return Array.from({ length: 7 }, (_, k) => sumarDiasLocal(dom, k)!);
  }
  const inicio = domingoDe(primeroDelMes(fecha));
  return Array.from({ length: 42 }, (_, k) => sumarDiasLocal(inicio, k)!);
}

/**
 * Navegar con las flechas. `delta` es -1 (atrás) o +1 (adelante) en unidades de la vista.
 * En vista mes se ancla al día 1 antes de sumar: si no, ir "un mes adelante" desde el 31 de marzo
 * caería en mayo (marzo tiene 31 días, abril 30) y el operador perdería abril entero.
 */
export function navegar(vista: Vista, fecha: FechaLocal, delta: number): FechaLocal {
  if (vista === "dia") return sumarDiasLocal(fecha, delta)!;
  if (vista === "semana") return sumarDiasLocal(fecha, delta * 7)!;

  const anio = Number(fecha.slice(0, 4));
  const mes = Number(fecha.slice(5, 7)) - 1 + delta; // 0-indexed, puede quedar -1 o 12
  const anioFinal = anio + Math.floor(mes / 12);
  const mesFinal = ((mes % 12) + 12) % 12;
  return `${anioFinal}-${String(mesFinal + 1).padStart(2, "0")}-01`;
}

/** El título que va arriba: "13 de agosto de 2026" · "9 – 15 de agosto de 2026" · "Agosto 2026". */
export function tituloDeVista(vista: Vista, fecha: FechaLocal): string {
  const [anio, mes, dia] = [fecha.slice(0, 4), Number(fecha.slice(5, 7)), Number(fecha.slice(8, 10))];
  if (vista === "dia") {
    const d = diaSemanaDeFecha(fecha);
    const nombre = d == null ? "" : `${NOMBRE_DIA[d]}, `;
    return `${nombre}${dia} de ${NOMBRE_MES[mes - 1]} de ${anio}`;
  }
  if (vista === "mes") {
    const m = NOMBRE_MES[mes - 1]!;
    return `${m[0]!.toUpperCase()}${m.slice(1)} ${anio}`;
  }
  const dias = diasDeVista("semana", fecha);
  const a = dias[0]!;
  const b = dias[6]!;
  const diaA = Number(a.slice(8, 10));
  const diaB = Number(b.slice(8, 10));
  const mesA = NOMBRE_MES[Number(a.slice(5, 7)) - 1]!;
  const mesB = NOMBRE_MES[Number(b.slice(5, 7)) - 1]!;
  // Una semana puede cruzar mes y hasta año: se escribe lo mínimo que alcanza para no repetir.
  if (a.slice(0, 7) === b.slice(0, 7)) return `${diaA} – ${diaB} de ${mesA} de ${a.slice(0, 4)}`;
  if (a.slice(0, 4) === b.slice(0, 4)) return `${diaA} de ${mesA} – ${diaB} de ${mesB} de ${a.slice(0, 4)}`;
  return `${diaA} de ${mesA} de ${a.slice(0, 4)} – ${diaB} de ${mesB} de ${b.slice(0, 4)}`;
}

/** La matriz del mini-calendario: 6 semanas × 7 días, con la marca de "es de otro mes". */
export function matrizMensual(fecha: FechaLocal): { fecha: FechaLocal; delMes: boolean }[][] {
  const mes = fecha.slice(0, 7);
  const dias = diasDeVista("mes", fecha).map((f) => ({ fecha: f, delMes: f.slice(0, 7) === mes }));
  return Array.from({ length: 6 }, (_, s) => dias.slice(s * 7, s * 7 + 7));
}

/** Normaliza un `?fecha=` que vino de la URL. Basura => null (la página cae a HOY, §9). */
export function fechaDeParam(v: string | undefined | null): FechaLocal | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !esFechaCalendarioValida(v)) return null;
  return v;
}

/**
 * El nombre como entra en un chip angosto: sin la especialidad entre paréntesis. En una celda de
 * mes, "María Gómez (Psicología)" se corta en "María Gómez (Psico…" y se pierde el apellido, que
 * es justo lo que el operador busca. La especialidad sigue en el tooltip y en la vista día.
 */
export function nombreCorto(titulo: string): string {
  return titulo.replace(/\s*\([^)]*\)\s*$/, "").trim() || titulo;
}
