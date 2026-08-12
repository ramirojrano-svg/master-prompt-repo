// src/dominio/motor/serie.ts — recurrencia semanal (§4.9). Motor PURO.
// Materializadas, no virtuales: una serie "virtual" no la puede proteger el constraint de
// exclusión hasta que alguien la expande, y para entonces ya se vendió el slot dos veces.
// planificarSerie NO escribe: devuelve el PREVIEW que un humano confirma. Cada ocurrencia se
// calcula desde SU fecha local (sumarDiasLocal), nunca sumando 7*24h a un instante.

import type { FechaLocal, HorarioSemanal, HoraPared, Instante, Intervalo, Ocupacion, PoliticaCentro, Tz } from "./tipos.ts";
import { contiene, seSolapan } from "./intervalos.ts";
import { franjasIntervalo, intervaloBloqueante } from "./disponibilidad.ts";
import { instanteDeHoraLocal, sumarDiasLocal } from "./zona.ts";

export const SEMANAS_MAX = 52;

export type EstadoOcurrencia = "libre" | "choca_reserva" | "choca_bloqueo" | "fuera_de_horario";

export type Ocurrencia = {
  fecha: FechaLocal;
  inicio: Instante;
  fin: Instante;
  estado: EstadoOcurrencia;
  conflictoCon?: { tipo: string; id: string };
};

export type PlanSerie = {
  ocurrencias: Ocurrencia[];
  resumen: { libres: number; conflictos: number };
};

export type EntradaSerie = {
  fechaInicio: FechaLocal;
  hora: HoraPared;
  duracionMin: number;
  semanas: number;
  tz: Tz;
  ocupaciones: Ocupacion[]; // de la sala + bloqueos aplicables
  horario: HorarioSemanal;
  politica: PoliticaCentro;
  inquilinoId?: string;
};

function clasificar(intervalo: Intervalo, fecha: FechaLocal, e: EntradaSerie): { estado: EstadoOcurrencia; conflictoCon?: { tipo: string; id: string } } {
  const franjas = franjasIntervalo(e.horario, fecha, e.tz);
  if (!franjas.some((f) => contiene(f, intervalo))) return { estado: "fuera_de_horario" };

  for (const o of e.ocupaciones) {
    if (seSolapan(intervaloBloqueante(o, e.inquilinoId, e.politica), intervalo)) {
      const estado: EstadoOcurrencia = o.tipo === "bloqueo" || o.tipo === "mantenimiento" ? "choca_bloqueo" : "choca_reserva";
      return { estado, conflictoCon: { tipo: o.tipo, id: o.id } };
    }
  }
  return { estado: "libre" };
}

export function planificarSerie(e: EntradaSerie): PlanSerie {
  const semanas = Math.min(Math.max(0, Math.floor(e.semanas)), SEMANAS_MAX);
  const ocurrencias: Ocurrencia[] = [];

  for (let k = 0; k < semanas; k++) {
    const fecha = sumarDiasLocal(e.fechaInicio, k * 7);
    if (!fecha) continue;
    const inicio = instanteDeHoraLocal(fecha, e.hora, e.tz);
    if (!inicio) continue;
    const fin = new Date(inicio.getTime() + e.duracionMin * 60_000);
    ocurrencias.push({ fecha, inicio, fin, ...clasificar({ inicio, fin }, fecha, e) });
  }

  const libres = ocurrencias.filter((o) => o.estado === "libre").length;
  return { ocurrencias, resumen: { libres, conflictos: ocurrencias.length - libres } };
}
