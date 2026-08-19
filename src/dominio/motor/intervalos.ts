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

/**
 * ¿`dentro` está contenido en `cont`? Semiabierto: cont.inicio <= dentro.inicio y
 * dentro.fin <= cont.fin. Vive ACÁ (y no suelto en disponibilidad.ts) porque es la
 * única comparación de rango con `<=` permitida en el repo: la contención, no el
 * solapamiento. Todo lo demás usa seSolapan() (§4.2).
 */
export function contiene(cont: Intervalo, dentro: Intervalo): boolean {
  return cont.inicio <= dentro.inicio && dentro.fin <= cont.fin;
}

/**
 * ¿Ese momento ya llegó? Es una comparación de INSTANTES, no de rangos, pero vive acá por la misma
 * razón que `contiene`: §4.2 prohíbe comparar `.inicio` a mano en el resto del repo, y la regla
 * está bien puesta — la mitad de los bugs de agenda salen de un `<=` escrito de apuro en el lugar
 * equivocado. Tenerla con nombre además dice qué significa: "el turno ya empezó".
 *
 * `<=` y no `<`: un turno que arranca EXACTAMENTE ahora ya empezó. Cancelarlo en ese instante no
 * libera nada — el consultorio está ocupado desde este segundo.
 */
export function yaEmpezo(inicio: Date, ahora: Date = new Date()): boolean {
  return inicio.getTime() <= ahora.getTime();
}

/**
 * De una lista de ocupaciones ya traídas de la base, las que le pegan a `objetivo`.
 *
 * Es el MISMO recorte que hace la consulta SQL cuando se pregunta por una sola fecha, movido a
 * memoria: al crear una serie no se le puede preguntar a la base una vez por ocurrencia —con 57
 * miércoles son 114 idas y vueltas y la transacción se pasa de tiempo—, así que se trae el rango
 * entero de una y se filtra acá.
 *
 * `lookbackMin` acota hacia atrás igual que la consulta: una ocupación que arrancó mucho antes no
 * puede alcanzar a `objetivo`, y sin el corte habría que mirar la historia completa.
 *
 * Vive en este módulo y no en el servicio porque §4.2 lo pide, y la regla está bien puesta: una
 * comparación de rangos escrita a mano en la capa de servicios es exactamente donde se cuela el
 * `<=` de más que hace desaparecer un turno.
 */
export function alcanzadasPor<T extends Intervalo>(filas: T[], objetivo: Intervalo, lookbackMin: number): T[] {
  const piso = new Date(objetivo.inicio.getTime() - lookbackMin * 60_000);
  return filas.filter((f) => f.inicio >= piso && seSolapan(f, objetivo));
}
