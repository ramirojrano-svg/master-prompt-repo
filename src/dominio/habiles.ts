// src/dominio/habiles.ts — el último día hábil del mes.
//
// Módulo PURO. Existe porque "el último día hábil" no es "el día 30": en agosto de 2026 el 31 es
// lunes, pero en mayo el 31 es domingo y el que corresponde es el viernes 29. Mandar la
// liquidación un domingo significa que nadie la lee hasta el lunes, con el vencimiento un día más
// cerca.
//
// NO contempla feriados. Sería mentir decir que sí: un calendario de feriados argentinos hay que
// mantenerlo todos los años, y uno desactualizado es peor que no tenerlo — manda el aviso en un
// feriado creyendo que es hábil y nadie se entera de que falló. Sábado y domingo cubren el 90% de
// los casos y no requieren mantenimiento.

export type FechaLocal = string; // 'YYYY-MM-DD'

/** Días del mes, sin depender de la zona del proceso: `Date.UTC(a, m, 0)` da el último de `m`. */
function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/** 0 = domingo … 6 = sábado, en el calendario, sin husos de por medio. */
function diaSemana(anio: number, mes: number, dia: number): number {
  return new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
}

/**
 * El último día hábil del mes de `periodo` ('YYYY-MM'), como 'YYYY-MM-DD'.
 *
 * Se retrocede desde el último día hasta caer en un día de semana. Nunca hay que retroceder más de
 * dos: un mes no puede terminar en tres findes seguidos.
 */
export function ultimoHabilDelMes(periodo: string): FechaLocal {
  const [a, m] = periodo.split("-").map(Number) as [number, number];
  let dia = diasDelMes(a, m);
  while (diaSemana(a, m, dia) === 0 || diaSemana(a, m, dia) === 6) dia--;
  return `${periodo}-${String(dia).padStart(2, "0")}`;
}

/** ¿`fecha` ('YYYY-MM-DD') es el último día hábil de su mes? */
export function esUltimoHabil(fecha: FechaLocal): boolean {
  return ultimoHabilDelMes(fecha.slice(0, 7)) === fecha;
}
