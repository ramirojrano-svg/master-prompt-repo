// src/dominio/motor/limites.ts — LA fuente única de constantes del motor (§4.7.1).
// El acoplamiento invisible: LOOKBACK_MIN tiene que ser >= DURACION_MAX_MIN + BUFFER_MAX_MIN,
// y hay un test que falla si se rompe. Si alguien sube el máximo de duración y no el lookback,
// una reserva en curso se vuelve invisible para el cálculo de solapamiento y vuelve la doble
// reserva, sin error y sin test que la agarre.

import type { PasoMin } from "./tipos.ts";

export const DURACION_MIN_MIN = 15;
export const DURACION_MAX_MIN = 720; // día completo de 12 h
export const BUFFER_MAX_MIN = 60;
export const PASOS_VALIDOS: readonly PasoMin[] = [10, 15, 20, 30, 60];
export const PASO_DEFAULT: PasoMin = 30;
export const HORIZONTE_PORTAL_DIAS = 60; // lo que ve el inquilino
export const HORIZONTE_SERIE_DIAS = 400; // lo que puede agendar el operador / una membresía anual

/** Cuánto hacia atrás hay que mirar para no perder una ocupación en curso. */
export const LOOKBACK_MIN = DURACION_MAX_MIN + BUFFER_MAX_MIN;

/**
 * pasoMin nunca se lee crudo de un JSON: lista cerrada, y basura cae al default.
 * Un pasoMin: 0 hace que slotsDe devuelva cero horarios y el link público quede muerto
 * sin ningún error visible (§4.5, invariante §14.15).
 */
export function pasoValido(n: unknown): PasoMin {
  return (PASOS_VALIDOS as readonly number[]).includes(n as number) ? (n as PasoMin) : PASO_DEFAULT;
}
