// src/dominio/reserva-entrada.ts — el BORDE DE ENTRADA, puro y testeable (§11.2 regla 3).
// Vive FUERA de cualquier archivo "use server" (que solo exporta funciones async): así el
// schema se puede importar y testear. Las server actions quedan dueñas de la sesión y el
// tenant; la validación cruzada vive acá.

import { z } from "zod";
import { DURACION_MAX_MIN, DURACION_MIN_MIN } from "./motor/limites.ts";
import { esFechaCalendarioValida, fechaEnZona } from "./motor/zona.ts";
import type { FechaLocal, Instante, Tz } from "./motor/tipos.ts";

export const ReservaInput = z.object({
  salaId: z.string().min(1),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // día local del CENTRO
  inicioISO: z.string().datetime(), // instante absoluto
  duracionMin: z.coerce.number().int().min(DURACION_MIN_MIN).max(DURACION_MAX_MIN),
  nota: z.string().max(500).optional(),
  _hp: z.string().optional(), // honeypot
});

export type ReservaInputT = z.infer<typeof ReservaInput>;

export type VentanaOk = { ok: true; inicio: Instante; fin: Instante; fecha: FechaLocal };
export type VentanaError = { ok: false; error: "FECHA_INVALIDA" | "FECHA_INCONSISTENTE" };

/**
 * `fecha` e `inicioISO` llegan POR SEPARADO y el POST se puede forjar. `fecha` elige la clave
 * del lock, el bucket del cupo y el día del re-chequeo; `inicioISO` es lo que se guarda. Si no
 * son el MISMO día local de la sede, se cuela una reserva que ningún chequeo miró. La partición
 * se calcula con los mismos bytes que se insertan (invariante §14.18).
 */
export function validarVentanaReserva(d: ReservaInputT, tz: Tz, _ahora: Instante): VentanaOk | VentanaError {
  if (!esFechaCalendarioValida(d.fecha)) return { ok: false, error: "FECHA_INVALIDA" };
  const inicio = new Date(d.inicioISO);
  if (Number.isNaN(inicio.getTime())) return { ok: false, error: "FECHA_INVALIDA" };
  if (fechaEnZona(inicio, tz) !== d.fecha) return { ok: false, error: "FECHA_INCONSISTENTE" };
  const fin = new Date(inicio.getTime() + d.duracionMin * 60_000);
  return { ok: true, inicio, fin, fecha: d.fecha };
}
