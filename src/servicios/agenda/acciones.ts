// src/servicios/agenda/acciones.ts — las acciones de agenda, con su permiso declarado (§6.2).
// Viven fuera del archivo "use server" para poder testearlas: un archivo con "use server" solo
// puede exportar funciones async, así que ni el schema se podría importar. La página envuelve
// estas funciones en una server action delgada que resuelve la sesión.
//
// Toda acción pasa por definirAccion => el permiso es parte de la firma y se chequea SIEMPRE,
// aunque la pantalla ya haya escondido el botón: una server action es un endpoint HTTP público.

import { z } from "zod";
import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { definirAccion } from "../../lib/accion.ts";
import { crearOcupacion, type CtxReserva, type ResultadoCrear } from "../reservas/crear.ts";
import { parseHorarios } from "../../dominio/motor/horarios.ts";
import { instanteDeHoraLocal } from "../../dominio/motor/zona.ts";
import { PASO_DEFAULT, DURACION_MAX_MIN, DURACION_MIN_MIN } from "../../dominio/motor/limites.ts";
import type { Actor } from "../../lib/actor.ts";

export const NuevaReservaInput = z.object({
  salaId: z.string().min(1),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora: z.string().regex(/^\d{2}:\d{2}$/),
  duracionMin: z.coerce.number().int().min(DURACION_MIN_MIN).max(DURACION_MAX_MIN),
  inquilinoId: z.string().min(1),
});

export type NuevaReserva = z.infer<typeof NuevaReservaInput>;

/**
 * Crea una reserva desde el panel. NO reimplementa nada: arma el contexto (política y horario de
 * la sala) y delega en crearOcupacion, que es el ÚNICO camino de escritura — con sus advisory
 * locks, su re-chequeo contra el tx y el constraint de exclusión como red final.
 */
async function crearDesdePanel(actor: Actor, input: NuevaReserva, db: PrismaClient = prisma): Promise<ResultadoCrear> {
  const sala = await db.sala.findFirst({
    where: { id: input.salaId, operadorId: actor.operadorId },
    select: { id: true, bufferMin: true, horarioJson: true, activa: true, sede: { select: { zonaHoraria: true } } },
  });
  if (!sala || !sala.activa) return { ok: false, error: "SALA_INEXISTENTE" };

  const tz = sala.sede.zonaHoraria;
  const inicio = instanteDeHoraLocal(input.fecha, input.hora, tz);
  if (!inicio) return { ok: false, error: "FECHA_INVALIDA" };

  const ctx: CtxReserva = {
    operadorId: actor.operadorId,
    inquilinoId: input.inquilinoId,
    horario: parseHorarios(sala.horarioJson),
    politica: {
      pasoMin: PASO_DEFAULT,
      duracionMinMin: DURACION_MIN_MIN,
      duracionMaxMin: DURACION_MAX_MIN,
      bufferMin: sala.bufferMin,
      bufferMismoInquilino: 0,
      antelacionMinMin: 0, // el operador puede cargar una reserva para ahora mismo
      horizonteDias: 400, // horizonte del OPERADOR (§4.7.2), no el del portal
    },
    bloqueaProfesional: true,
  };

  return crearOcupacion(
    { salaId: sala.id, fecha: input.fecha, inicioISO: inicio.toISOString(), duracionMin: input.duracionMin },
    ctx,
    db,
  );
}

/** Reserva a nombre de OTRO inquilino: es lo que hace el operador desde el panel. */
export const crearReservaAjena = definirAccion(
  { permiso: "reserva.crear.ajena", schema: NuevaReservaInput },
  (actor, input) => crearDesdePanel(actor, input),
);

/** Misma lógica, para tests: permite inyectar el cliente de base. */
export const crearReservaAjenaCon = (db: PrismaClient) =>
  definirAccion({ permiso: "reserva.crear.ajena", schema: NuevaReservaInput }, (actor, input) => crearDesdePanel(actor, input, db));

/** Mensaje honesto por código de error (§13): nunca "no hay disponibilidad" si la causa es otra. */
export function mensajeDeError(codigo: string): string {
  switch (codigo) {
    case "SLOT_OCUPADO":
      return "Ese horario se acaba de ocupar. Elegí otro.";
    case "SOLAPA_INQUILINO":
      return "Ese profesional ya tiene otra sala reservada en ese horario.";
    case "FUERA_DE_HORARIO":
      return "El horario elegido cae fuera de la apertura de esa sala.";
    case "SALA_INEXISTENTE":
      return "Esa sala ya no está disponible. Elegí otra.";
    case "FUERA_DE_HORIZONTE":
      return "Esa fecha está fuera del plazo que se puede agendar.";
    case "FECHA_PASADA":
      return "Esa fecha ya pasó.";
    case "SIN_PERMISO":
      return "Tu rol no puede cargar reservas a nombre de otro profesional.";
    case "ENTRADA_INVALIDA":
    case "DATOS_INVALIDOS":
      return "Revisá los datos: falta algo o la duración no es válida.";
    default:
      return "No se pudo crear la reserva.";
  }
}
