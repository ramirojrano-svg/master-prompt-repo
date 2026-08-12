// src/dominio/motor/intervalos.ts
// La ÚNICA aritmética de rangos del repo. Ninguna otra comparación de solapamiento
// puede existir fuera de este archivo (regla dura §14.1 / §4.2).

import type { Intervalo } from "./tipos.ts";

/**
 * Solapamiento de intervalos SEMIABIERTOS [inicio, fin).
 * NUNCA `<=`: con `<=`, una reserva 09:00-10:00 y otra 10:00-11:00 se detectan
 * como choque y la sala se ve llena con la mitad de las horas libres. El operador
 * pierde plata y no ve un solo error en pantalla.
 */
export function seSolapan(a: Intervalo, b: Intervalo): boolean {
  return a.inicio < b.fin && b.inicio < a.fin;
}

/** a menos b. Devuelve 0, 1 o 2 pedazos (b puede partir a por el medio). */
export function restar(a: Intervalo, b: Intervalo): Intervalo[] {
  if (!seSolapan(a, b)) return [a];
  const out: Intervalo[] = [];
  if (a.inicio < b.inicio) out.push({ inicio: a.inicio, fin: b.inicio });
  if (b.fin < a.fin) out.push({ inicio: b.fin, fin: a.fin });
  return out; // contención total => []
}

/** Resta una lista de intervalos de una base. Cada quitar puede partir cada pedazo. */
export function restarTodos(base: Intervalo[], quitar: Intervalo[]): Intervalo[] {
  return quitar.reduce<Intervalo[]>((acc, q) => acc.flatMap((i) => restar(i, q)), base);
}

/** Duración en minutos de un intervalo. */
export function duracionMin(i: Intervalo): number {
  return Math.round((i.fin.getTime() - i.inicio.getTime()) / 60_000);
}
