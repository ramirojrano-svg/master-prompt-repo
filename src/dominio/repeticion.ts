// src/dominio/repeticion.ts — qué fechas genera cada patrón de repetición. Motor PURO.
//
// Solo calendario: acá no hay horas, ni zonas, ni instantes. Cada fecha que sale de acá la
// convierte a instante quien la use, en la zona de SU sede — sumar días sobre un instante UTC es
// justo el bug que se evita (§4.9).
//
// Los tres bordes que hacen falta pensar, y que están cubiertos por tests:
//
//  · MENSUAL es "el segundo viernes", no "el día 12". Es lo que dice Google Calendar y lo que la
//    gente quiere decir cuando alquila "los segundos viernes". Un mes que no tiene ese quinto
//    viernes SE SALTEA: inventar el último viernes correría el turno a otra semana.
//  · ANUAL sobre un 29 de febrero solo cae en años bisiestos. Los demás años se saltean, por lo
//    mismo: el 1 de marzo no es el 29 de febrero.
//  · HÁBILES cuenta días de lunes a viernes. Arrancando un sábado, la primera ocurrencia es el
//    lunes siguiente, no el sábado.

import type { FechaLocal } from "./motor/tipos.ts";

export type Repeticion = "no" | "diaria" | "habiles" | "semanal" | "mensual" | "anual";

export const REPETICIONES: Repeticion[] = ["no", "diaria", "habiles", "semanal", "mensual", "anual"];

export function esRepeticion(v: string): v is Repeticion {
  return (REPETICIONES as string[]).includes(v);
}

/**
 * Hasta dónde llega una serie. No se pregunta "cuántas veces": si alguien elige "cada semana el
 * sábado", quiere TODOS los sábados, no ocho.
 *
 * El límite es el HORIZONTE de agenda del operador (§4.7.2) — el mismo hasta el que se puede
 * reservar a mano. Una serie de verdad infinita no es posible y no es un detalle de
 * implementación: las ocurrencias se MATERIALIZAN como filas, porque el constraint de exclusión
 * de Postgres es lo que impide vender dos veces la misma hora, y no puede proteger una fila que
 * todavía no existe (§4.9). Así que la serie llega hasta donde llega la agenda; cuando el
 * horizonte avance, se extiende.
 */
export const HORIZONTE_DIAS = 400;

/** Tope duro de filas por serie. Solo lo toca la repetición diaria (400 días ≈ 400 turnos). */
export const OCURRENCIAS_MAX = 420;

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const ORDINALES = ["primer", "segundo", "tercer", "cuarto", "quinto"];

/** Descompone 'YYYY-MM-DD'. Devuelve null si no es una fecha de calendario real. */
function partes(fecha: FechaLocal): { a: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) return null;
  const a = Number(m[1]), mes = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(a, mes - 1, d));
  // Rebote: el 31 de abril se normaliza a mayo, y así se detecta que no existía.
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== d) return null;
  return { a, m: mes, d };
}

const texto = (a: number, m: number, d: number): FechaLocal =>
  `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Día de la semana (0 = domingo) de una fecha de calendario. */
function diaSemana(a: number, m: number, d: number): number {
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

/** ¿Cuántos días tiene ese mes? (con bisiesto real). */
function diasDelMes(a: number, m: number): number {
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/** La fecha del n-ésimo `dow` de ese mes, o null si el mes no llega a tenerlo. */
function nEsimoDiaDelMes(a: number, m: number, dow: number, n: number): FechaLocal | null {
  const primero = diaSemana(a, m, 1);
  const dia = 1 + ((dow - primero + 7) % 7) + (n - 1) * 7;
  return dia <= diasDelMes(a, m) ? texto(a, m, dia) : null;
}

/** En qué semana del mes cae esa fecha: 1 = primer <día>, 2 = segundo, … */
function ordinalEnElMes(d: number): number {
  return Math.floor((d - 1) / 7) + 1;
}

/**
 * Cuántas ocurrencias entran en el horizonte, según el patrón. Es lo que reemplaza al "¿cuántas
 * veces?": el número sale del calendario, no de una pregunta al operador.
 */
export function ocurrenciasEnElHorizonte(repeticion: Repeticion): number {
  switch (repeticion) {
    case "no":
      return 1;
    case "diaria":
      return HORIZONTE_DIAS;
    case "habiles":
      return Math.floor((HORIZONTE_DIAS / 7) * 5);
    case "semanal":
      return Math.floor(HORIZONTE_DIAS / 7);
    case "mensual":
      return Math.floor(HORIZONTE_DIAS / 30);
    case "anual":
      return Math.max(1, Math.floor(HORIZONTE_DIAS / 365));
  }
}

/**
 * Las fechas de la serie, empezando por `desde` (que SIEMPRE es la primera ocurrencia).
 * `cantidad` es cuántas ocurrencias se quieren; los meses/años que no tienen la fecha se saltean
 * sin consumir cupo, así "12 veces, el segundo viernes" da doce segundos viernes de verdad.
 */
export function fechasDeSerie(desde: FechaLocal, repeticion: Repeticion, cantidad: number): FechaLocal[] {
  const p = partes(desde);
  if (!p) return [];
  const cuantas = Math.min(Math.max(1, Math.floor(cantidad)), OCURRENCIAS_MAX);
  if (repeticion === "no") return [desde];

  const dow = diaSemana(p.a, p.m, p.d);
  const fechas: FechaLocal[] = [];

  if (repeticion === "diaria" || repeticion === "habiles") {
    const base = new Date(Date.UTC(p.a, p.m - 1, p.d));
    // `intentos` acota el barrido: sin él, "hábiles" sobre un calendario raro iteraría sin fin.
    for (let i = 0; fechas.length < cuantas && i < cuantas * 3 + 14; i++) {
      const f = new Date(base.getTime() + i * 86_400_000);
      const habil = f.getUTCDay() >= 1 && f.getUTCDay() <= 5;
      if (repeticion === "diaria" || habil) {
        fechas.push(texto(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate()));
      }
    }
    return fechas;
  }

  if (repeticion === "semanal") {
    const base = new Date(Date.UTC(p.a, p.m - 1, p.d));
    for (let k = 0; k < cuantas; k++) {
      const f = new Date(base.getTime() + k * 7 * 86_400_000);
      fechas.push(texto(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate()));
    }
    return fechas;
  }

  if (repeticion === "mensual") {
    const n = ordinalEnElMes(p.d);
    // Se recorren meses, no ocurrencias: los que no tienen ese n-ésimo día no gastan cupo.
    for (let k = 0; fechas.length < cuantas && k < cuantas * 2 + 12; k++) {
      const mes0 = p.m - 1 + k;
      const f = nEsimoDiaDelMes(p.a + Math.floor(mes0 / 12), (mes0 % 12) + 1, dow, n);
      if (f) fechas.push(f);
    }
    return fechas;
  }

  // anual: mismo día y mes. El 29/2 solo existe en bisiestos y los demás años se saltean.
  for (let k = 0; fechas.length < cuantas && k < cuantas * 4 + 8; k++) {
    const a = p.a + k;
    if (p.d <= diasDelMes(a, p.m)) fechas.push(texto(a, p.m, p.d));
  }
  return fechas;
}

/**
 * El texto de cada opción, calculado desde la fecha elegida — igual que en Google Calendar, que
 * no dice "mensual" sino "todos los meses, el segundo viernes". La etiqueta ES la explicación:
 * si hay que aclarar aparte qué hace la opción, la opción está mal nombrada.
 */
export function etiquetaDeRepeticion(fecha: FechaLocal, r: Repeticion): string {
  const p = partes(fecha);
  if (!p) return "";
  const dia = DIAS[diaSemana(p.a, p.m, p.d)];
  switch (r) {
    case "no":
      return "No se repite";
    case "diaria":
      return "Todos los días";
    case "habiles":
      return "Todos los días hábiles (de lunes a viernes)";
    case "semanal":
      return `Cada semana, el ${dia}`;
    case "mensual":
      return `Todos los meses, el ${ORDINALES[ordinalEnElMes(p.d) - 1]} ${dia}`;
    case "anual":
      return `Anualmente, el ${p.d} de ${MESES[p.m - 1]}`;
  }
}
