// src/dominio/motor/disponibilidad.ts
// Genera la disponibilidad de una sala un día, en la zona de la sede. Motor PURO: sin DB,
// sin new Date() implícito (el "ahora" entra por parámetro). La lista que se MUESTRA y el
// cálculo que DECIDE salen de acá, con los mismos argumentos (invariante §14.7).

import type {
  EntradaDisponibilidad,
  FechaLocal,
  Instante,
  Intervalo,
  Ocupacion,
  PoliticaCentro,
  Tz,
} from "./tipos.ts";
import { contiene, restarTodos } from "./intervalos.ts";
import { pasoValido } from "./limites.ts";
import {
  diaSemanaDeFecha,
  esFechaCalendarioValida,
  fechaEnZona,
  horaAMinutos,
  instanteDeHoraLocal,
  minutosAHora,
  sumarDiasLocal,
} from "./zona.ts";

/**
 * Lo que esta ocupación le bloquea a un TERCERO (§4.6). Buffer POSTERIOR únicamente, tomado
 * de la fila (o.bufferMin, ESTAMPADO al nacer) — no de la config actual: subir el buffer del
 * centro no invalida reservas ya confirmadas. Entre bloques del MISMO inquilino va el buffer
 * de mismo inquilino (default 0): reservar 09-10 y 10-11 es el caso de uso central.
 */
export function intervaloBloqueante(o: Ocupacion, quienPide: string | undefined, p: PoliticaCentro): Intervalo {
  const mismo = o.inquilinoId != null && o.inquilinoId === quienPide;
  const buf = mismo ? p.bufferMismoInquilino : o.bufferMin;
  return { inicio: o.inicio, fin: new Date(o.fin.getTime() + buf * 60_000) };
}

/** Intervalos libres de la sala ese día, ya descontado todo (§4.5). */
export function libresDeSala(e: EntradaDisponibilidad): Intervalo[] {
  const dia = diaSemanaDeFecha(e.fecha);
  if (dia == null) return [];

  const franjas: Intervalo[] = [];
  for (const f of e.horario[dia]) {
    const ini = instanteDeHoraLocal(e.fecha, f.desde, e.tz);
    const fin = instanteDeHoraLocal(e.fecha, f.hasta, e.tz);
    if (ini && fin && fin > ini) franjas.push({ inicio: ini, fin });
  }

  const bloqueantes = e.ocupaciones.map((o) => intervaloBloqueante(o, e.inquilinoId, e.politica));
  return restarTodos(franjas, bloqueantes);
}

/**
 * Inicios ofrecibles. La grilla se ancla en la APERTURA DE LA FRANJA, no en el borde del
 * hueco libre: si no, una reserva importada que termina 10:47 genera slots 10:47, 11:02...
 * y la agenda se vuelve ilegible. `m + duracion <= hastaMin` garantiza que un bloque no cruce
 * el hueco entre dos franjas (§4.5).
 */
export function slotsDe(e: EntradaDisponibilidad): Instante[] {
  const paso = pasoValido(e.politica.pasoMin); // basura (ej. 0) cae al default, no a lista vacía
  const dia = diaSemanaDeFecha(e.fecha);
  if (dia == null) return [];

  const libres = libresDeSala(e);
  const piso = new Date(e.ahora.getTime() + e.politica.antelacionMinMin * 60_000);
  const out: Instante[] = [];

  for (const f of e.horario[dia]) {
    const desdeMin = horaAMinutos(f.desde);
    const hastaMin = horaAMinutos(f.hasta);
    if (desdeMin == null || hastaMin == null) continue;
    for (let m = desdeMin; m + e.duracionMin <= hastaMin; m += paso) {
      const inicio = instanteDeHoraLocal(e.fecha, minutosAHora(m), e.tz);
      if (!inicio || inicio < piso) continue;
      const cand: Intervalo = { inicio, fin: new Date(inicio.getTime() + e.duracionMin * 60_000) };
      if (!libres.some((l) => contiene(l, cand))) continue;
      out.push(inicio);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Ventana de anticipación / horizonte (§4.7.2). El código de error final lo arma
// entrada.ts (paso 4); acá el motor decide con una función pura y testeable.
// ─────────────────────────────────────────────────────────────
export type MotivoVentana = "FECHA_PASADA" | "FUERA_DE_HORIZONTE";
export type ResultadoVentana = { ok: true } | { ok: false; motivo: MotivoVentana };

export function evaluarVentana(
  fecha: FechaLocal,
  tz: Tz,
  ahora: Instante,
  horizonteDias: number,
): ResultadoVentana {
  if (!esFechaCalendarioValida(fecha)) return { ok: false, motivo: "FUERA_DE_HORIZONTE" };
  const hoy = fechaEnZona(ahora, tz);
  if (fecha < hoy) return { ok: false, motivo: "FECHA_PASADA" };
  const limite = sumarDiasLocal(hoy, horizonteDias);
  if (limite && fecha > limite) return { ok: false, motivo: "FUERA_DE_HORIZONTE" };
  return { ok: true };
}
