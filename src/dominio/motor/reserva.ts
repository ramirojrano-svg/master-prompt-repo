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
  horario: HorarioSemanal; // el de la SALA
  politica: PoliticaCentro;
  intervalo: Intervalo; // [inicio, fin) pedido, en UTC
  inquilinoId: string;
  bloqueaProfesional: boolean;
  ocupacionesSala: Ocupacion[]; // las que OCUPAN esa sala, ya filtradas por el caller
  ocupacionesInquilino: Ocupacion[]; // reservas del inquilino en OTRAS salas
};

/**
 * Distingue los tres códigos que el motor puede dar en el re-chequeo:
 *  - FUERA_DE_HORARIO: el bloque no cae dentro de una franja de apertura continua.
 *  - SLOT_OCUPADO:     choca con otra ocupación de la sala (con su buffer estampado).
 *  - SOLAPA_INQUILINO: el inquilino ya tiene otra sala en ese rango (si bloqueaProfesional).
 * El orden importa: primero horario (barato y claro), después los dos ejes de choque.
 */
export function evaluarReserva(e: EntradaReserva): VeredictoReserva {
  const franjas = franjasIntervalo(e.horario, e.fecha, e.tz);
  if (!franjas.some((f) => contiene(f, e.intervalo))) return { ok: false, codigo: "FUERA_DE_HORARIO" };

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
