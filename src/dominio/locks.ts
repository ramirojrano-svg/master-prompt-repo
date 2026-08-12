// src/dominio/locks.ts — LA fábrica de claves de advisory lock (§4.8.4 / §11.4).
// Dos formatos distintos NO se serializan entre sí y la carrera vuelve por la puerta de atrás:
// todos los caminos que crean ocupación usan ESTAS funciones, y las toman en orden ASCENDENTE
// para no deadlockear (invariante §14.11 / §14.12).

import { fechaEnZona } from "./motor/zona.ts";
import type { Instante, Tz } from "./motor/tipos.ts";

export const claveLockSala = (salaId: string, fecha: string): string => `reserva:sala:${salaId}:${fecha}`;
export const claveLockInquilino = (inqId: string, fecha: string): string => `reserva:inq:${inqId}:${fecha}`;

/**
 * Días locales que toca un intervalo [inicio, fin). `fin` es EXCLUSIVO: 23:00-00:00 toca un
 * solo día, 23:00-01:00 toca dos. Como la duración máxima es 12 h, nunca son más de dos.
 */
export function diasTocados(inicio: Instante, fin: Instante, tz: Tz): string[] {
  const d1 = fechaEnZona(inicio, tz);
  const d2 = fechaEnZona(new Date(fin.getTime() - 1), tz); // el último instante ocupado
  return d1 === d2 ? [d1] : [d1, d2];
}

/**
 * Todas las claves de lock de una creación de reserva, ORDENADAS ascendentemente y sin
 * duplicados. Cubre el eje sala (uno o dos días si cruza la medianoche) y el eje inquilino.
 * Ordenadas: dos creaciones concurrentes que tocan las mismas dos salas/días no deadlockean.
 */
export function clavesDeLock(p: {
  salaId: string;
  inquilinoId: string | null;
  inicio: Instante;
  fin: Instante;
  tz: Tz;
}): string[] {
  const dias = diasTocados(p.inicio, p.fin, p.tz);
  const claves: string[] = [];
  for (const f of dias) claves.push(claveLockSala(p.salaId, f));
  if (p.inquilinoId != null) for (const f of dias) claves.push(claveLockInquilino(p.inquilinoId, f));
  return [...new Set(claves)].sort();
}
