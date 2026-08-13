// src/servicios/config/salas.ts — ABM de salas (§6.12 paso 3). Permiso: sala.administrar.
// Regla dura: una sala NUNCA se borra, se ARCHIVA (§3.6). Tiene reservas, plata y evidencia
// colgando; y archivada sigue apareciendo en los reportes y en la agenda de los días que tuvo
// actividad.

import { z } from "zod";
import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { definirAccion } from "../../lib/accion.ts";
import { sanitizarHorarios } from "../../dominio/motor/horarios.ts";
import { horaAMinutos } from "../../dominio/motor/zona.ts";
import type { Dia, HorarioSemanal } from "../../dominio/motor/tipos.ts";
import type { Actor } from "../../lib/actor.ts";

const DIAS = [0, 1, 2, 3, 4, 5, 6] as const;

export const SalaInput = z.object({
  nombre: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#1a8fc1"),
  // Horario simple: qué días abre y en qué franja. Cubre el caso real (L-V 08-22); un editor
  // por día con varias franjas es una mejora posterior, y el blob ya lo soporta.
  dias: z.array(z.coerce.number().int().min(0).max(6)).min(1),
  desde: z.string().regex(/^\d{2}:\d{2}$/),
  hasta: z.string().regex(/^\d{2}:\d{2}$/),
});

// Sin tiempo de limpieza entre turnos: el centro no lo usa, así que las salas se crean y se
// editan con buffer 0. La columna sigue existiendo porque cada ocupación tiene el suyo ESTAMPADO
// al nacer (§8.8) — borrarla reescribiría lo que ya pasó.
const SIN_BUFFER = 0;

export type SalaInputT = z.infer<typeof SalaInput>;

/** Arma el blob semanal desde el formulario. Pasa por el saneador, como todo horario (§4.4). */
export function horarioDesdeFormulario(i: { dias: number[]; desde: string; hasta: string }): HorarioSemanal | null {
  const d = horaAMinutos(i.desde);
  const h = horaAMinutos(i.hasta);
  if (d == null || h == null || d >= h) return null; // desde < hasta, siempre
  const crudo: Record<string, { desde: string; hasta: string }[]> = {};
  for (const dia of DIAS) crudo[String(dia)] = i.dias.includes(dia) ? [{ desde: i.desde, hasta: i.hasta }] : [];
  return sanitizarHorarios(crudo);
}

export type ResultadoSala = { ok: true; id: string } | { ok: false; error: "HORARIO_INVALIDO" | "NO_ENCONTRADA" };

async function crear(actor: Actor, input: SalaInputT, db: PrismaClient): Promise<ResultadoSala> {
  const horario = horarioDesdeFormulario(input);
  if (!horario) return { ok: false, error: "HORARIO_INVALIDO" };

  // La sede: hoy hay una por operador (multi-sede es F7). Se resuelve server-side, nunca del form.
  const sede = await db.sede.findFirst({ where: { operadorId: actor.operadorId, activa: true }, select: { id: true } });
  if (!sede) return { ok: false, error: "NO_ENCONTRADA" };

  const ultima = await db.sala.aggregate({ where: { operadorId: actor.operadorId }, _max: { orden: true } });
  const s = await db.sala.create({
    data: {
      operadorId: actor.operadorId,
      sedeId: sede.id,
      nombre: input.nombre,
      color: input.color,
      orden: (ultima._max.orden ?? 0) + 1,
      horarioJson: horario,
      bufferMin: SIN_BUFFER,
    },
    select: { id: true },
  });
  return { ok: true, id: s.id };
}

async function editar(actor: Actor, input: SalaInputT & { salaId: string }, db: PrismaClient): Promise<ResultadoSala> {
  const horario = horarioDesdeFormulario(input);
  if (!horario) return { ok: false, error: "HORARIO_INVALIDO" };
  // updateMany + operadorId: la fila se resuelve DENTRO del tenant (nunca update por id solo).
  const r = await db.sala.updateMany({
    where: { id: input.salaId, operadorId: actor.operadorId },
    data: { nombre: input.nombre, color: input.color, horarioJson: horario, bufferMin: SIN_BUFFER },
  });
  return r.count === 1 ? { ok: true, id: input.salaId } : { ok: false, error: "NO_ENCONTRADA" };
}

/** Archiva (o reactiva). NUNCA borra: hay reservas y plata colgando (§3.6). */
async function archivar(actor: Actor, input: { salaId: string; activa: boolean }, db: PrismaClient): Promise<ResultadoSala> {
  const r = await db.sala.updateMany({
    where: { id: input.salaId, operadorId: actor.operadorId },
    data: { activa: input.activa, archivadaEl: input.activa ? null : new Date() },
  });
  return r.count === 1 ? { ok: true, id: input.salaId } : { ok: false, error: "NO_ENCONTRADA" };
}

export const crearSala = definirAccion({ permiso: "sala.administrar", schema: SalaInput }, (a, i) => crear(a, i, prisma));
export const editarSala = definirAccion(
  { permiso: "sala.administrar", schema: SalaInput.extend({ salaId: z.string().min(1) }) },
  (a, i) => editar(a, i, prisma),
);
export const archivarSala = definirAccion(
  { permiso: "sala.administrar", schema: z.object({ salaId: z.string().min(1), activa: z.coerce.boolean() }) },
  (a, i) => archivar(a, i, prisma),
);

/** Versiones inyectables, para los tests. */
export const salasCon = (db: PrismaClient) => ({
  crear: definirAccion({ permiso: "sala.administrar", schema: SalaInput }, (a, i) => crear(a, i, db)),
  editar: definirAccion({ permiso: "sala.administrar", schema: SalaInput.extend({ salaId: z.string().min(1) }) }, (a, i) => editar(a, i, db)),
  archivar: definirAccion({ permiso: "sala.administrar", schema: z.object({ salaId: z.string().min(1), activa: z.coerce.boolean() }) }, (a, i) => archivar(a, i, db)),
});

/** Días marcados de un horario, para pintar el formulario de edición. */
export function diasDeHorario(h: HorarioSemanal): Dia[] {
  return DIAS.filter((d) => h[d].length > 0);
}
