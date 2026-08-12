// src/dominio/motor/horarios.ts
// Los horarios semanales son un blob JSON sanitizado (no una tabla): keys 0-6, rangos HH:MM
// con desde<hasta, ordenados, sin solapes internos, con tope POR DÍA aplicado DESPUÉS de
// validar, y caída al default ante JSON irrecuperable (§9). Nunca crashea, nunca un día vacío
// por error (siempre devuelve las 7 keys).

import type { Dia, Franja, HorarioSemanal } from "./tipos.ts";
import { diaSemanaDeFecha, horaAMinutos } from "./zona.ts";
import type { FechaLocal } from "./tipos.ts";

const DIAS: readonly Dia[] = [0, 1, 2, 3, 4, 5, 6];
const CAP_CRUDO = 100; // cota anti-DoS sobre la lista cruda de un día
const CAP_DIA = 4; // tope real de franjas por día, aplicado DESPUÉS de validar

/** L-V 09-13 / 16-20, fin de semana cerrado. Todas las keys existen. */
export const HORARIO_DEFAULT: HorarioSemanal = Object.freeze({
  0: [],
  1: [{ desde: "09:00", hasta: "13:00" }, { desde: "16:00", hasta: "20:00" }],
  2: [{ desde: "09:00", hasta: "13:00" }, { desde: "16:00", hasta: "20:00" }],
  3: [{ desde: "09:00", hasta: "13:00" }, { desde: "16:00", hasta: "20:00" }],
  4: [{ desde: "09:00", hasta: "13:00" }, { desde: "16:00", hasta: "20:00" }],
  5: [{ desde: "09:00", hasta: "13:00" }, { desde: "16:00", hasta: "20:00" }],
  6: [],
}) as HorarioSemanal;

function vacio(): HorarioSemanal {
  return { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
}

function clon(h: HorarioSemanal): HorarioSemanal {
  const out = vacio();
  for (const d of DIAS) out[d] = h[d].map((f) => ({ ...f }));
  return out;
}

/**
 * Choque de dos franjas HH:MM. ÚNICA implementación (§4.2): semiabierto, con `<`, nunca `<=`
 * — 09-13 y 13-16 no se pisan. La comparación de strings 'HH:MM' del mismo formato es
 * cronológica.
 */
export function solapanHora(a: Franja, b: Franja): boolean {
  return a.desde < b.hasta && b.desde < a.hasta;
}

function franjaValida(item: unknown): Franja | null {
  if (item == null || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const { desde, hasta } = o;
  if (typeof desde !== "string" || typeof hasta !== "string") return null;
  const a = horaAMinutos(desde);
  const b = horaAMinutos(hasta);
  if (a == null || b == null || a >= b) return null;
  return { desde, hasta };
}

/** Sanitiza una estructura ya parseada. Siempre devuelve las 7 keys. */
export function sanitizarHorarios(raw: unknown): HorarioSemanal {
  if (raw == null || typeof raw !== "object") return clon(HORARIO_DEFAULT);
  const obj = raw as Record<string, unknown>;
  const out = vacio();

  for (const d of DIAS) {
    const lista = obj[String(d)];
    if (!Array.isArray(lista)) continue; // queda [], nunca undefined

    // 1) validar (con cota anti-DoS sobre la lista cruda)
    const validas: Franja[] = [];
    for (const item of lista.slice(0, CAP_CRUDO)) {
      const f = franjaValida(item);
      if (f) validas.push(f);
    }
    // 2) ordenar por 'desde'
    validas.sort((a, b) => (a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : 0));
    // 3) quitar solapes internos, quedándose con el PRIMERO de cada choque
    const sinSolape: Franja[] = [];
    for (const f of validas) {
      if (!sinSolape.some((g) => solapanHora(g, f))) sinSolape.push(f);
    }
    // 4) tope por día RECIÉN acá, para que basura al principio no descarte rangos válidos
    out[d] = sinSolape.slice(0, CAP_DIA);
  }
  return out;
}

/** Parsea un blob (string JSON o valor). Ante JSON roto cae al default, nunca crashea. */
export function parseHorarios(blob: unknown): HorarioSemanal {
  if (typeof blob === "string") {
    try {
      return sanitizarHorarios(JSON.parse(blob));
    } catch {
      return clon(HORARIO_DEFAULT);
    }
  }
  return sanitizarHorarios(blob);
}

/** Franjas de apertura de una fecha concreta (por su día de semana en la zona de la sede). */
export function franjasDelDia(horario: HorarioSemanal, fecha: FechaLocal): Franja[] {
  const d = diaSemanaDeFecha(fecha);
  if (d == null) return [];
  return horario[d];
}

const NOMBRE: Record<Dia, string> = { 0: "Dom", 1: "Lun", 2: "Mar", 3: "Mié", 4: "Jue", 5: "Vie", 6: "Sáb" };
// Orden de presentación: la semana empieza el lunes.
const ORDEN: readonly Dia[] = [1, 2, 3, 4, 5, 6, 0];

function firma(franjas: Franja[]): string {
  return franjas.map((f) => `${f.desde}-${f.hasta}`).join(", ");
}

/**
 * Resumen legible, agrupando días CONSECUTIVOS con el mismo horario.
 * Ej: 'Lun a Vie 09:00-20:00 · Sáb 09:00-13:00'. Los días cerrados se omiten.
 */
export function resumenHorarios(horario: HorarioSemanal): string {
  const grupos: string[] = [];
  let i = 0;
  while (i < ORDEN.length) {
    const dia = ORDEN[i]!;
    const sig = firma(horario[dia]);
    if (sig === "") {
      i++;
      continue; // día cerrado
    }
    let j = i;
    while (j + 1 < ORDEN.length && firma(horario[ORDEN[j + 1]!]) === sig) j++;
    const etiqueta = i === j ? NOMBRE[dia] : `${NOMBRE[dia]} a ${NOMBRE[ORDEN[j]!]}`;
    grupos.push(`${etiqueta} ${sig}`);
    i = j + 1;
  }
  return grupos.join(" · ");
}
