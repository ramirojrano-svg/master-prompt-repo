// src/dominio/motor/reserva.ts
// El veredicto puro del re-chequeo dentro del lock (§4.8.4). Recibe la foto (intervalo pedido
// + ocupaciones ya cargadas desde el tx) y devuelve ok o el código honesto (§13). No toca la
// base. La capa de servicios arma la foto adentro de la transacción y aplica el resultado.

import type { FechaLocal, HorarioSemanal, Intervalo, Ocupacion, PoliticaCentro, Tz } from "./tipos.ts";
import { contiene, seSolapan } from "./intervalos.ts";
import { intervaloBloqueante, franjasIntervalo } from "./disponibilidad.ts";

export type CodigoReserva = "FUERA_DE_HORARIO" | "SLOT_OCUPADO" | "SOLAPA_INQUILINO";
export type VeredictoReserva = { ok: true } | { ok: false; codigo: CodigoReserva };

export type EntradaReserva = {
  fecha: FechaLocal;
  tz: Tz;
  /**
   * El horario de la SALA. `null` significa que NO HAY horario que respetar, y es el caso de las
   * reservas sin consultorio: el horario de apertura dice cuándo se puede entrar al centro, y una
   * hora que no usa el centro no tiene por qué caer adentro de esa ventana.
   *
   * Es `null` y no un horario de 24 horas a propósito. "Abierto siempre" se había escrito como una
   * franja 00:00–24:00, pero 'HH:MM' no llega a las 24: `horaAMinutos` rechaza cualquier hora
   * mayor a 23:59, la franja se descartaba entera y el día quedaba SIN NINGUNA apertura — o sea
   * cerrado, justo lo contrario de lo que decía. Un caso que no se puede escribir en el tipo no se
   * finge con un valor límite; se agrega al tipo.
   */
  horario: HorarioSemanal | null;
  politica: PoliticaCentro;
  intervalo: Intervalo; // [inicio, fin) pedido, en UTC
  inquilinoId: string;
  bloqueaProfesional: boolean;
  ocupacionesSala: Ocupacion[]; // las que OCUPAN esa sala, ya filtradas por el caller
  ocupacionesInquilino: Ocupacion[]; // reservas del inquilino en OTRAS salas
};

/**
 * Distingue los tres códigos que el motor puede dar en el re-chequeo:
 *  - FUERA_DE_HORARIO: el bloque no cae dentro de una franja de apertura continua. No aplica si
 *                      `horario` es null (sin consultorio: no hay apertura que respetar).
 *  - SLOT_OCUPADO:     choca con otra ocupación de la sala (con su buffer estampado).
 *  - SOLAPA_INQUILINO: el inquilino ya tiene otra sala en ese rango (si bloqueaProfesional).
 * El orden importa: primero horario (barato y claro), después los dos ejes de choque.
 */
export function evaluarReserva(e: EntradaReserva): VeredictoReserva {
  // Sin horario no se saltea el resto: los dos ejes de choque siguen valiendo, y el del
  // profesional es justamente el que importa acá — que no esté en dos lugares a la vez.
  if (e.horario) {
    const franjas = franjasIntervalo(e.horario, e.fecha, e.tz);
    if (!franjas.some((f) => contiene(f, e.intervalo))) return { ok: false, codigo: "FUERA_DE_HORARIO" };
  }

  for (const o of e.ocupacionesSala) {
    if (seSolapan(intervaloBloqueante(o, e.inquilinoId, e.politica), e.intervalo)) {
      return { ok: false, codigo: "SLOT_OCUPADO" };
    }
  }

  if (e.bloqueaProfesional) {
    for (const o of e.ocupacionesInquilino) {
      if (seSolapan({ inicio: o.inicio, fin: o.fin }, e.intervalo)) {
        return { ok: false, codigo: "SOLAPA_INQUILINO" };
      }
    }
  }

  return { ok: true };
}
