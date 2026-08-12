// src/dominio/motor/zona.ts
// Conversión hora-de-pared <-> instante UTC con la IANA tz real, vía Intl.
// PROHIBIDO: offsets fijos en strings, +24h para el día, +7*24h para la semana,
// iteración de offsets hasta converger (regla dura §14.6 / §4.3).
//
// Ninguna función de este archivo tiene default de zona: `tz` es parámetro
// obligatorio y el tipo rompe si falta (invariante §14.3).

import type { Dia, FechaLocal, HoraPared, Instante, Tz } from "./tipos.ts";

const MIN = 60_000; // ms en un minuto
const DIA_MS = 86_400_000; // 24h fijas SOLO para muestrear offsets vecinos (no para calcular días)

type Partes = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** Descompone un instante en sus partes de pared en `tz`, usando Intl. */
export function partesEnZona(instante: Instante, tz: Tz): Partes {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const { type, value } of dtf.formatToParts(instante)) p[type] = value;
  const rawHour = p.hour === "24" ? "0" : (p.hour ?? "0"); // algunos ICU devuelven "24" en medianoche
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(rawHour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** Offset de `tz` en ese instante, en minutos (local - UTC). BsAs => -180. */
export function offsetMinutos(instante: Instante, tz: Tz): number {
  const p = partesEnZona(instante, tz);
  const comoUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((comoUTC - instante.getTime()) / MIN);
}

/** 'HH:MM' -> minutos desde medianoche. null si el string es inválido. */
export function horaAMinutos(hm: HoraPared): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** minutos desde medianoche -> 'HH:MM'. */
export function minutosAHora(mm: number): HoraPared {
  const h = Math.floor(mm / 60);
  const m = mm % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * ¿La fecha EXISTE en el calendario? Round-trip por Date.UTC: `new Date("2026-02-30")`
 * en V8 NO es Invalid Date, es el 2 de marzo (invariante §14.19). Clave para no
 * guardar una reserva un día que el inquilino no eligió.
 */
export function esFechaCalendarioValida(fecha: FechaLocal): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const [ys, ms, ds] = fecha.split("-");
  const Y = Number(ys);
  const M = Number(ms);
  const D = Number(ds);
  const d = new Date(Date.UTC(Y, M - 1, D));
  return d.getUTCFullYear() === Y && d.getUTCMonth() === M - 1 && d.getUTCDate() === D;
}

/** 'YYYY-MM-DD' del instante en `tz`. */
export function fechaEnZona(instante: Instante, tz: Tz): FechaLocal {
  const p = partesEnZona(instante, tz);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** 'HH:MM' del instante en `tz`. `tz` OBLIGATORIO, sin default. */
export function formatHora(instante: Instante, tz: Tz): string {
  const p = partesEnZona(instante, tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/**
 * Hora de pared (fecha + HH:MM en `tz`) -> instante UTC.
 * DOS candidatos, no iteración: el offset vigente 24h ANTES y 24h DESPUÉS.
 *  - El de "antes" va primero => en la hora AMBIGUA (vuelta del DST) devuelve la
 *    PRIMERA ocurrencia, que es la convención de todo calendario.
 *  - Si ninguno lee la hora pedida, esa hora de pared NO EXISTE (salto de primavera):
 *    NO devuelve null, corre hacia adelante. Una reserva no puede desaparecer por
 *    un detalle del cambio de hora.
 * Devuelve null solo si la fecha o la hora son inválidas de entrada.
 */
export function instanteDeHoraLocal(fecha: FechaLocal, hm: HoraPared, tz: Tz): Instante | null {
  if (!esFechaCalendarioValida(fecha)) return null;
  const mm = horaAMinutos(hm);
  if (mm == null) return null;

  const [ys, ms, ds] = fecha.split("-");
  const Y = Number(ys);
  const M = Number(ms);
  const D = Number(ds);
  const h = Math.floor(mm / 60);
  const min = mm % 60;
  const wallUTC = Date.UTC(Y, M - 1, D, h, min);

  const offAntes = offsetMinutos(new Date(wallUTC - DIA_MS), tz);
  const offDespues = offsetMinutos(new Date(wallUTC + DIA_MS), tz);

  for (const off of [offAntes, offDespues]) {
    const cand = new Date(wallUTC - off * MIN);
    const p = partesEnZona(cand, tz);
    if (p.year === Y && p.month === M && p.day === D && p.hour === h && p.minute === min) {
      return cand;
    }
  }
  // Hora inexistente (salto de primavera): correr hacia adelante con el offset "de antes".
  return new Date(wallUTC - offAntes * MIN);
}

/**
 * Rango [inicio, fin) del día calendario `fecha` en `tz`. Busca la SIGUIENTE
 * medianoche local (no suma 24h fijas): el día del cambio de DST dura 23 o 25 h.
 */
export function rangoDiaEnZona(fecha: FechaLocal, tz: Tz): { inicio: Instante; fin: Instante } | null {
  const inicio = instanteDeHoraLocal(fecha, "00:00", tz);
  if (!inicio) return null;
  // Sumar 26h y reconvertir aterriza siempre en el día siguiente (un día dura 23..25h).
  const tanteo = new Date(inicio.getTime() + 26 * 3600 * 1000);
  const fechaSiguiente = fechaEnZona(tanteo, tz);
  const fin = instanteDeHoraLocal(fechaSiguiente, "00:00", tz);
  if (!fin) return null;
  return { inicio, fin };
}

/**
 * Día de la semana (0 = domingo) de una fecha local. El mediodía UTC es inmune a
 * cualquier offset del planeta. null si la fecha no existe.
 */
export function diaSemanaDeFecha(fecha: FechaLocal): Dia | null {
  if (!esFechaCalendarioValida(fecha)) return null;
  return new Date(`${fecha}T12:00:00Z`).getUTCDay() as Dia;
}

/**
 * Suma `dias` a una fecha local, con el mediodía UTC como pivote. Inmune al DST porque
 * la aritmética y la lectura son en UTC: NUNCA sumar días a un INSTANTE local (el día del
 * cambio dura 23 o 25 h). La usan el horizonte de reserva y la expansión de series (§4.9).
 */
export function sumarDiasLocal(fecha: FechaLocal, dias: number): FechaLocal | null {
  if (!esFechaCalendarioValida(fecha)) return null;
  const d = new Date(new Date(`${fecha}T12:00:00Z`).getTime() + dias * 86_400_000);
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Período contable 'YYYY-MM' de un instante, EN LA ZONA DEL CENTRO (§5.12). Una reserva del
 * 31 a las 23:30 hora de la sede cae en el mes correcto; `new Date(año, mes)` en un server UTC
 * la pondría en el mes siguiente. El caller pasa este período al ledger de minutos y de plata.
 */
export function periodoDeInstante(instante: Instante, tz: Tz): string {
  const p = partesEnZona(instante, tz);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}`;
}

/**
 * DTSTART de un ICS: UTC con Z (formato 'YYYYMMDDTHHMMSSZ'). El instante ya está
 * en UTC; el ICS lo lleva absoluto y el cliente lo muestra en su zona. El artefacto
 * donde el error de zona se hace visible (§6.14): probado con dos zonas en los tests.
 */
export function formatIcsUtc(instante: Instante): string {
  return instante.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
