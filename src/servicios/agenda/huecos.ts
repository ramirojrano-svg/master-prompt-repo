// src/servicios/agenda/huecos.ts — qué horas quedan libres para ofrecer.
//
// La agenda contesta "qué hay el martes". Esta es la pregunta del otro lado del mostrador: llega
// alguien preguntando si hay lugar, y hay que poder decirle QUÉ hay sin recorrer día por día
// mirando los agujeros entre bloques. Hasta ahora eso se hacía a ojo, y a ojo se pierde una hora
// suelta del jueves que nadie vuelve a mirar.
//
// Los huecos NO se calculan acá: los calcula `libresDeSala`, el mismo motor puro que decide si una
// reserva entra. Es a propósito (§14.7) — si esta pantalla usara su propia cuenta, podría ofrecer
// una hora que después el alta rechaza, y no hay peor respuesta para quien viene a alquilar que
// "sí, hay… ah, no, perdón".
//
// Se ofrece solo lo que llega al mínimo pedido: un agujero de 20 minutos entre dos turnos no es un
// hueco vendible, es la nada.

import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { parseHorarios } from "../../dominio/motor/horarios.ts";
import { libresDeSala } from "../../dominio/motor/disponibilidad.ts";
import { fechaEnZona, minutosAHora, sumarDiasLocal } from "../../dominio/motor/zona.ts";
import { minutosDelDia } from "../../dominio/grilla.ts";
import { DURACION_MAX_MIN, PASO_DEFAULT } from "../../dominio/motor/limites.ts";
import type { Actor } from "../../lib/actor.ts";

export type HuecoSala = {
  salaId: string;
  salaNombre: string;
  color: string;
  desdeMin: number;
  hastaMin: number;
  horaTexto: string; // "09:00 – 13:00", ya en la zona de la sede
  minutos: number;
};

export type DiaConHuecos = {
  fecha: string; // 'YYYY-MM-DD' en la zona de la sede
  diaSemana: number;
  huecos: HuecoSala[];
  minutosLibres: number;
};

export type Disponibilidad = {
  tz: string;
  desde: string;
  hasta: string;
  dias: DiaConHuecos[];
  /** Suma de todo lo ofrecible en la ventana. Es "cuánto tengo para vender". */
  minutosLibres: number;
  salas: { id: string; nombre: string; color: string }[];
};

/** Cuántos días mira la pantalla por defecto. Dos semanas: lo que se puede prometer sin adivinar. */
export const DIAS_VENTANA = 14;

/** Un hueco más corto que esto no se ofrece: no es lugar, es el resto entre dos turnos. */
export const HUECO_MIN_MIN = 60;

export async function huecosLibres(
  a: { actor: Actor; desdeFecha?: string | null; dias?: number; hastaFecha?: string | null; salaId?: string | null; diaSemana?: number | null },
  db: PrismaClient = prisma,
): Promise<Disponibilidad | null> {
  const op = a.actor.operadorId;

  const sede = await db.sede.findFirst({ where: { operadorId: op, activa: true }, select: { zonaHoraria: true } });
  if (!sede) return null;
  const tz = sede.zonaHoraria;

  const salasTodas = await db.sala.findMany({
    where: { operadorId: op, activa: true },
    select: { id: true, nombre: true, color: true, horarioJson: true, bufferMin: true },
    orderBy: { orden: "asc" },
  });
  // El filtro por consultorio se aplica ACÁ y no al mostrar: si se filtrara al final, el total de
  // "cuánto tengo para vender" seguiría contando salas que la pantalla no está mostrando.
  const salas = a.salaId ? salasTodas.filter((s) => s.id === a.salaId) : salasTodas;
  if (salas.length === 0) {
    return { tz, desde: "", hasta: "", dias: [], minutosLibres: 0, salas: [] };
  }

  const cuantos = Math.min(Math.max(1, Math.floor(a.dias ?? DIAS_VENTANA)), 62);
  // Desde HOY en la zona de la SEDE, nunca del navegador: ofrecer el hueco de ayer sería ofrecer
  // algo que no existe, y en un centro que abre a las 7 la diferencia de zona lo hace fácil.
  const hoy = fechaEnZona(new Date(), tz);
  // El campo se llama `desdeFecha` y no `desde`: son fechas de calendario en texto, no los
  // extremos de un intervalo. El lint de §4.2 vigila las comparaciones con `<=`/`>=` sobre
  // `.desde`/`.hasta` justamente porque ahí un borde inclusivo rompe la detección de solapes; acá
  // no hay ningún intervalo, y nombrarlo distinto evita que un lector futuro lo confunda.
  const pedida = a.desdeFecha;
  const arranque = pedida && /^\d{4}-\d{2}-\d{2}$/.test(pedida) && pedida >= hoy ? pedida : hoy;

  // El tope opcional cierra la ventana en una fecha concreta. Lo usa la navegación por mes: el
  // mes corriente arranca HOY (ofrecer el hueco de ayer no sirve) pero termina el último día del
  // mes, no 30 días después — si no, "agosto" mostraría también la primera semana de septiembre.
  const tope = a.hastaFecha && /^\d{4}-\d{2}-\d{2}$/.test(a.hastaFecha) ? a.hastaFecha : null;

  const fechas: string[] = [];
  for (let n = 0; n < cuantos; n++) {
    const f = sumarDiasLocal(arranque, n);
    if (!f) continue;
    if (tope && f > tope) break;
    fechas.push(f);
  }
  if (fechas.length === 0) return null;

  // Las ocupaciones de toda la ventana en UNA consulta. Una por día serían 14 idas y vueltas a una
  // base que está en otro continente.
  const desdeInstante = new Date(`${fechas[0]}T00:00:00Z`);
  const hastaInstante = new Date(`${fechas.at(-1)}T00:00:00Z`);
  hastaInstante.setUTCDate(hastaInstante.getUTCDate() + 2); // margen de zona horaria a los dos lados
  desdeInstante.setUTCDate(desdeInstante.getUTCDate() - 1);

  const ocupaciones = await db.ocupacion.findMany({
    where: {
      operadorId: op,
      // Lo cancelado y lo movido no ocupan: ofrecer esa hora es correcto.
      estado: { in: ["confirmada", "en_curso", "usada", "no_show"] },
      inicio: { lt: hastaInstante },
      fin: { gt: desdeInstante },
    },
    select: { id: true, salaId: true, inquilinoId: true, inicio: true, fin: true, bufferMin: true, tipo: true },
  });

  const politica = {
    pasoMin: PASO_DEFAULT,
    duracionMinMin: HUECO_MIN_MIN,
    duracionMaxMin: DURACION_MAX_MIN,
    bufferMin: 0,
    bufferMismoInquilino: 0,
    antelacionMinMin: 0,
    horizonteDias: 3650,
  } as const;

  const dias: DiaConHuecos[] = [];
  let totalLibre = 0;

  for (const fecha of fechas) {
    const huecos: HuecoSala[] = [];
    for (const s of salas) {
      // Los bloqueos SIN sala son del centro entero (cierra por feriado): le pegan a todas.
      const suyas = ocupaciones.filter((o) => o.salaId === s.id || (o.salaId === null && o.tipo === "bloqueo"));
      const libres = libresDeSala({
        fecha,
        tz,
        horario: parseHorarios(s.horarioJson),
        // `salaId` se deja tal cual viene: un bloqueo global (null) tiene que seguir siendo global
        // para el motor. Cambiárselo por el id de la sala lo convertiría en un bloqueo de esa sala,
        // que da el mismo resultado hoy pero es una mentira que el día de mañana confunde.
        ocupaciones: suyas.map((o) => ({
          id: o.id,
          salaId: o.salaId,
          inquilinoId: o.inquilinoId,
          tipo: o.tipo,
          inicio: o.inicio,
          fin: o.fin,
          bufferMin: o.bufferMin,
        })),
        politica,
        duracionMin: HUECO_MIN_MIN,
        ahora: new Date(),
      });

      for (const l of libres) {
        const desdeMin = minutosDelDia(l.inicio, tz);
        const hastaMin = minutosDelDia(l.fin, tz);
        const minutos = Math.round((l.fin.getTime() - l.inicio.getTime()) / 60_000);
        if (minutos < HUECO_MIN_MIN) continue;
        huecos.push({
          salaId: s.id,
          salaNombre: s.nombre,
          color: s.color,
          desdeMin,
          hastaMin,
          minutos,
          horaTexto: `${minutosAHora(desdeMin)} – ${minutosAHora(hastaMin)}`,
        });
      }
    }

    huecos.sort((x, y) => x.desdeMin - y.desdeMin || x.salaNombre.localeCompare(y.salaNombre, "es"));
    const minutosLibres = huecos.reduce((t, h) => t + h.minutos, 0);
    // Un día sin nada libre igual se lista: "el jueves no tengo nada" es una respuesta, y saltearlo
    // dejaría la impresión de que ese día no se miró.
    const diaSemana = new Date(`${fecha}T12:00:00Z`).getUTCDay();
    if (a.diaSemana == null || a.diaSemana === diaSemana) {
      dias.push({ fecha, diaSemana, huecos, minutosLibres });
      totalLibre += minutosLibres;
    }
  }

  return {
    tz,
    desde: fechas[0]!,
    hasta: fechas.at(-1)!,
    dias,
    minutosLibres: totalLibre,
    salas: salas.map((s) => ({ id: s.id, nombre: s.nombre, color: s.color })),
  };
}
