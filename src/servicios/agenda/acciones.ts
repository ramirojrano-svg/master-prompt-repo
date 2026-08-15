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
import { crearOcupacion, type CtxReserva } from "../reservas/crear.ts";
import { moverOcupacion, type ResultadoMover } from "../reservas/mover.ts";
import { cancelarOcupacion } from "../reservas/cancelar.ts";
import { marcarNoShow, revertirNoShow } from "../reservas/no-show.ts";
import { parseHorarios } from "../../dominio/motor/horarios.ts";
import { instanteDeHoraLocal } from "../../dominio/motor/zona.ts";
import { PASO_DEFAULT, DURACION_MAX_MIN, DURACION_MIN_MIN } from "../../dominio/motor/limites.ts";
import { ocurrenciasEnElHorizonte, REPETICIONES, type Repeticion } from "../../dominio/repeticion.ts";
import { expandirSerie } from "../reservas/expandir-serie.ts";

// z.enum pide una tupla no vacía; la lista canónica vive en el módulo de repetición.
const REPETICIONES_TUPLA = REPETICIONES as unknown as [string, ...string[]];
import type { Actor } from "../../lib/actor.ts";

export const NuevaReservaInput = z.object({
  salaId: z.string().min(1),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora: z.string().regex(/^\d{2}:\d{2}$/),
  duracionMin: z.coerce.number().int().min(DURACION_MIN_MIN).max(DURACION_MAX_MIN),
  inquilinoId: z.string().min(1),
  // Repetición: por defecto "no", así un formulario viejo (o un POST sin el campo) sigue
  // creando UN turno y nunca una serie por accidente. CUÁNTAS veces no se pregunta: sale del
  // horizonte de agenda (ver ocurrenciasEnElHorizonte).
  repeticion: z.enum(REPETICIONES_TUPLA).default("no"),
});

export type NuevaReserva = z.infer<typeof NuevaReservaInput>;

/** Arrastrar un bloque de la grilla: a qué sala cae y en qué horario. La duración no viaja —
 *  mover no estira: la conserva el servicio a partir de la fila original. */
export const MoverReservaInput = z.object({
  ocupacionId: z.string().min(1),
  salaDestinoId: z.string().min(1),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora: z.string().regex(/^\d{2}:\d{2}$/),
});

export type MoverReserva = z.infer<typeof MoverReservaInput>;

/**
 * La política del panel, compartida por el alta y por el movimiento. Una sola definición: si el
 * alta admite una duración y el arrastre otra, un turno válido se vuelve inmovible sin motivo.
 */
function politicaDelPanel(bufferMin: number): CtxReserva["politica"] {
  return {
    pasoMin: PASO_DEFAULT,
    duracionMinMin: DURACION_MIN_MIN,
    duracionMaxMin: DURACION_MAX_MIN,
    bufferMin,
    bufferMismoInquilino: 0,
    antelacionMinMin: 0, // el operador puede cargar una reserva para ahora mismo
    horizonteDias: 400, // horizonte del OPERADOR (§4.7.2), no el del portal
  };
}

/**
 * Crea una reserva desde el panel. NO reimplementa nada: arma el contexto (política y horario de
 * la sala) y delega en crearOcupacion, que es el ÚNICO camino de escritura — con sus advisory
 * locks, su re-chequeo contra el tx y el constraint de exclusión como red final.
 */
export type ResultadoAlta =
  | { ok: true; creadas: number; conflictos: { fecha: string; codigo: string }[] }
  | { ok: false; error: string };

async function crearDesdePanel(actor: Actor, input: NuevaReserva, db: PrismaClient = prisma): Promise<ResultadoAlta> {
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
    politica: politicaDelPanel(sala.bufferMin),
    bloqueaProfesional: true,
  };

  // Un turno suelto sigue yendo por crearOcupacion, que es EL camino de escritura. Una serie va
  // por expandirSerie, que escribe las N en una sola transacción tomando todos los locks: crear
  // N veces en un for se deadlockearía contra otra serie que empiece por el otro extremo.
  if (input.repeticion === "no") {
    const r = await crearOcupacion(
      { salaId: sala.id, fecha: input.fecha, inicioISO: inicio.toISOString(), duracionMin: input.duracionMin },
      ctx,
      db,
    );
    return r.ok ? { ok: true, creadas: 1, conflictos: [] } : { ok: false, error: r.error };
  }

  // Modo `parcial`: se crean las que entran y se INFORMA cuáles no. El modo silencioso no existe
  // (§4.9) — una ocurrencia que desaparece sin avisar es un profesional que llega a la puerta
  // cerrada. La pantalla muestra cuántas quedaron afuera.
  const serie = await expandirSerie(
    {
      salaId: sala.id,
      hora: input.hora,
      duracionMin: input.duracionMin,
      fechaInicio: input.fecha,
      repeticion: input.repeticion as Repeticion,
      // Todas las que entren en el horizonte: "cada semana el sábado" son TODOS los sábados.
      cantidad: ocurrenciasEnElHorizonte(input.repeticion as Repeticion),
      modo: "parcial",
    },
    ctx,
    db,
  );
  if (!serie.ok) return { ok: false, error: serie.error };
  return { ok: true, creadas: serie.creadas.length, conflictos: serie.conflictos };
}

/**
 * Mueve una reserva arrastrándola. El horario que manda es el de la sala DESTINO: soltar un
 * bloque en un consultorio que ese día abre más tarde tiene que dar FUERA_DE_HORARIO, no colarse
 * con la apertura de la sala de la que salió.
 */
async function moverDesdePanel(actor: Actor, input: MoverReserva, db: PrismaClient = prisma): Promise<ResultadoMover> {
  const sala = await db.sala.findFirst({
    where: { id: input.salaDestinoId, operadorId: actor.operadorId },
    select: { bufferMin: true, horarioJson: true, activa: true },
  });
  if (!sala || !sala.activa) return { ok: false, error: "SALA_INEXISTENTE" };

  return moverOcupacion(
    input,
    { operadorId: actor.operadorId, horario: parseHorarios(sala.horarioJson), politica: politicaDelPanel(sala.bufferMin) },
    db,
  );
}

/** Mover el turno de OTRO: el mismo permiso que editarlo, porque cambiarle la hora es editarlo. */
export const moverReservaAjena = definirAccion(
  { permiso: "reserva.editar.ajena", schema: MoverReservaInput },
  (actor, input) => moverDesdePanel(actor, input),
);

/** Misma lógica, para tests: permite inyectar el cliente de base. */
export const moverReservaAjenaCon = (db: PrismaClient) =>
  definirAccion({ permiso: "reserva.editar.ajena", schema: MoverReservaInput }, (actor, input) => moverDesdePanel(actor, input, db));

// ── Acciones sobre un turno ya existente ───────────────────────────────────
// Las tres piden `reserva.editar.ajena`: cambiarle la hora, marcarle una falta o darlo de baja
// son formas de editar el turno de otro. La recepción no las tiene.

export const TurnoInput = z.object({
  ocupacionId: z.string().min(1),
  motivo: z.string().max(200).optional(),
  /** Qué se cancela si el turno es parte de una serie. Por defecto, SOLO ese: el alcance amplio
   *  se pide explícitamente, nunca se asume. */
  alcance: z.enum(["solo", "siguientes", "serie"]).default("solo"),
});
export const NoShowInput = TurnoInput.extend({ accion: z.enum(["marcar", "revertir"]) });

/** Da de baja el turno y devuelve la plata (la política pura reembolsa 100% al cancelar el centro). */
export const cancelarReservaAjena = definirAccion(
  { permiso: "reserva.editar.ajena", schema: TurnoInput },
  (actor, input) => cancelarOcupacion(input, { operadorId: actor.operadorId }),
);

/** Marca (o desmarca) que el profesional no vino. No libera la sala: la hora ya pasó. */
export const noShowReservaAjena = definirAccion(
  { permiso: "reserva.editar.ajena", schema: NoShowInput },
  (actor, input) =>
    input.accion === "marcar"
      ? marcarNoShow(input, { operadorId: actor.operadorId })
      : revertirNoShow(input, { operadorId: actor.operadorId }),
);

/** Las mismas, para tests: permiten inyectar el cliente de base. */
export const cancelarReservaAjenaCon = (db: PrismaClient) =>
  definirAccion({ permiso: "reserva.editar.ajena", schema: TurnoInput }, (actor, input) =>
    cancelarOcupacion(input, { operadorId: actor.operadorId }, db),
  );

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

/**
 * Mensajes del ARRASTRE. Van aparte de los del alta a propósito: los códigos se comparten pero
 * la frase no. "Ese horario se acaba de ocupar. Elegí otro." es un buen texto cuando alguien está
 * llenando un formulario, y uno inútil cuando acaba de soltar un bloque en un lugar que ve en
 * pantalla — ahí lo que hay que decir es que el turno NO se movió y sigue donde estaba.
 */
export function mensajeDeMovimiento(codigo: string): string {
  switch (codigo) {
    case "SLOT_OCUPADO":
      return "Ahí ya hay otro turno. El turno quedó donde estaba.";
    case "SOLAPA_INQUILINO":
      return "Ese profesional ya tiene otra sala reservada a esa hora. El turno quedó donde estaba.";
    case "FUERA_DE_HORARIO":
      return "Ese consultorio no abre a esa hora. El turno quedó donde estaba.";
    case "SALA_INEXISTENTE":
      return "Ese consultorio ya no está disponible.";
    case "CONGELADA":
      return "Ese turno ya se usó o se marcó como ausente: no se puede mover.";
    case "NO_MOVIBLE":
      return "Los bloqueos y el mantenimiento no se arrastran.";
    case "MES_CERRADO":
      return "Ese turno ya está en un mes liquidado: moverlo cambiaría plata ya cerrada.";
    case "FECHA_PASADA":
      return "No se puede mover un turno a una fecha que ya pasó.";
    case "FUERA_DE_HORIZONTE":
      return "Esa fecha está fuera del plazo que se puede agendar.";
    case "NO_ENCONTRADA":
      return "Ese turno ya no existe. Recargá la agenda.";
    case "SIN_PERMISO":
      return "Tu rol no puede mover turnos de otros profesionales.";
    case "SIN_CAMBIOS":
      return ""; // soltar el bloque donde ya estaba no es un error: no se dice nada
    default:
      return "No se pudo mover el turno.";
  }
}

/** Mensajes de las acciones sobre un turno existente (cancelar, no vino). */
export function mensajeDeTurno(codigo: string): string {
  switch (codigo) {
    case "CONGELADA":
      return "Ese turno ya se usó o se marcó como ausente: no se puede cancelar.";
    case "YA_CANCELADA":
      return "Ese turno ya estaba cancelado.";
    case "NO_CANCELABLE":
      return "Los bloqueos y el mantenimiento no se cancelan desde acá.";
    case "MES_CERRADO":
      return "Ese turno está en un mes ya liquidado: cancelarlo cambiaría plata cerrada.";
    case "NO_APLICABLE":
      return "El turno no está en un estado que permita esa marca.";
    case "NO_ENCONTRADA":
      return "Ese turno ya no existe. Recargá la agenda.";
    case "SIN_PERMISO":
      return "Tu rol no puede modificar turnos de otros profesionales.";
    default:
      return "No se pudo completar la acción sobre el turno.";
  }
}

// ── Lo que hace un PROFESIONAL con sus propios turnos (§6.2) ────────────────
//
// Hasta acá solo existían las acciones "ajena": el profesional entraba a la agenda y no podía
// crear, mover ni cancelar nada. La app está pensada para que se agenden solos, y esa mitad no
// estaba escrita.
//
// La diferencia con las "ajena" no es el permiso: es DE QUIÉN es el turno. En las propias el
// inquilino NO viaja en el formulario, se toma de la sesión. Aceptarlo del cliente sería dejar que
// cualquiera agende (o cancele) a nombre de otro cambiando un campo oculto — y el permiso
// `reserva.crear.propia` no lo frenaría, porque desde su punto de vista la acción es legítima.

/** Igual que NuevaReservaInput pero SIN inquilinoId: no se pregunta, se sabe. */
export const NuevaReservaPropiaInput = NuevaReservaInput.omit({ inquilinoId: true });
export type NuevaReservaPropia = z.infer<typeof NuevaReservaPropiaInput>;

/** El vínculo del actor con su ficha de profesional. Sin él no hay turno propio posible. */
function suInquilino(actor: Actor): string | null {
  return actor.inquilinoId;
}

async function crearPropia(actor: Actor, input: NuevaReservaPropia, db: PrismaClient = prisma): Promise<ResultadoAlta> {
  const inquilinoId = suInquilino(actor);
  // Un usuario con rol de profesional pero sin ficha vinculada no puede reservar "para nadie".
  // Es un estado real (alguien creó el acceso y no lo asoció) y tiene que decirlo, no fallar raro.
  if (!inquilinoId) return { ok: false, error: "SIN_FICHA" };
  return crearDesdePanel(actor, { ...input, inquilinoId }, db);
}

export const crearReservaPropia = definirAccion(
  { permiso: "reserva.crear.propia", schema: NuevaReservaPropiaInput },
  (actor, input) => crearPropia(actor, input),
);

export const crearReservaPropiaCon = (db: PrismaClient) =>
  definirAccion({ permiso: "reserva.crear.propia", schema: NuevaReservaPropiaInput }, (actor, input) => crearPropia(actor, input, db));

/**
 * Cancela un turno PROPIO. El chequeo de que la fila sea suya se hace acá, contra la base: el id
 * viene del cliente, y sin verificar el dueño alcanzaría con cambiar un id en el formulario para
 * cancelarle el turno a otro.
 */
async function cancelarPropia(actor: Actor, input: z.infer<typeof TurnoInput>, db: PrismaClient = prisma) {
  const inquilinoId = suInquilino(actor);
  if (!inquilinoId) return { ok: false as const, error: "SIN_FICHA" as const };

  const fila = await db.ocupacion.findFirst({
    where: { id: input.ocupacionId, operadorId: actor.operadorId },
    select: { inquilinoId: true },
  });
  // Mismo resultado para "no existe" y "no es tuyo": responder distinto convierte la pantalla en
  // un detector de turnos ajenos (§6.11).
  if (!fila || fila.inquilinoId !== inquilinoId) return { ok: false as const, error: "NO_ENCONTRADO" as const };

  return cancelarOcupacion(input, { operadorId: actor.operadorId }, db);
}

export const cancelarReservaPropia = definirAccion(
  { permiso: "reserva.editar.propia", schema: TurnoInput },
  (actor, input) => cancelarPropia(actor, input),
);

export const cancelarReservaPropiaCon = (db: PrismaClient) =>
  definirAccion({ permiso: "reserva.editar.propia", schema: TurnoInput }, (actor, input) => cancelarPropia(actor, input, db));

/** Mueve un turno PROPIO arrastrándolo. Mismo chequeo de dueño que al cancelar. */
async function moverPropia(actor: Actor, input: z.infer<typeof MoverReservaInput>, db: PrismaClient = prisma) {
  const inquilinoId = suInquilino(actor);
  if (!inquilinoId) return { ok: false as const, error: "SIN_FICHA" as const };

  const fila = await db.ocupacion.findFirst({
    where: { id: input.ocupacionId, operadorId: actor.operadorId },
    select: { inquilinoId: true },
  });
  if (!fila || fila.inquilinoId !== inquilinoId) return { ok: false as const, error: "NO_ENCONTRADO" as const };

  return moverDesdePanel(actor, input, db);
}

export const moverReservaPropia = definirAccion(
  { permiso: "reserva.editar.propia", schema: MoverReservaInput },
  (actor, input) => moverPropia(actor, input),
);

export const moverReservaPropiaCon = (db: PrismaClient) =>
  definirAccion({ permiso: "reserva.editar.propia", schema: MoverReservaInput }, (actor, input) => moverPropia(actor, input, db));
