// src/servicios/reservas/expandir-serie.ts — materializa una serie recurrente (§4.9).
// Escribe las N filas en UNA transacción, tomando TODOS los locks de (sala, fecha) ordenados
// ascendentemente (sin el orden, dos series concurrentes se deadlockean). Re-chequea cada
// ocurrencia contra el `tx`. 'saltear_silencioso' no existe: una ocurrencia que desaparece sin
// decirlo es un inquilino que llega a la puerta cerrada.

import { randomUUID } from "node:crypto";
import { EstadoOcupacion, type PrismaClient, TipoOcupacion } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { clavesDeLock } from "../../dominio/locks.ts";
import { evaluarReserva, type CodigoReserva } from "../../dominio/motor/reserva.ts";
import { LOOKBACK_MIN, DURACION_MAX_MIN, DURACION_MIN_MIN } from "../../dominio/motor/limites.ts";
import { instanteDeHoraLocal, sumarDiasLocal } from "../../dominio/motor/zona.ts";
import { SEMANAS_MAX } from "../../dominio/motor/serie.ts";
import type { CtxReserva } from "./crear.ts";
import { aMotor, OCUPAN } from "./comun.ts";

export type ModoSerie = "parcial" | "todo_o_nada";

export type ParamsSerie = {
  salaId: string;
  hora: string; // 'HH:MM'
  duracionMin: number;
  fechaInicio: string; // 'YYYY-MM-DD'
  semanas: number;
  modo: ModoSerie;
  motivo?: string;
};

export type Conflicto = { fecha: string; codigo: CodigoReserva };

export type ResultadoSerie =
  | { ok: true; serieId: string; creadas: string[]; conflictos: Conflicto[] }
  | { ok: false; error: "SALA_INEXISTENTE" | "DATOS_INVALIDOS" | "SERIE_ABORTADA"; conflictos?: Conflicto[] };

class AbortarSerie extends Error {
  conflictos: Conflicto[];
  constructor(conflictos: Conflicto[]) {
    super("serie abortada por conflicto (todo_o_nada)");
    this.conflictos = conflictos;
  }
}

export async function expandirSerie(p: ParamsSerie, ctx: CtxReserva, db: PrismaClient = prisma): Promise<ResultadoSerie> {
  const ahora = ctx.ahora ?? new Date();
  const semanas = Math.floor(p.semanas);
  if (semanas < 1 || semanas > SEMANAS_MAX) return { ok: false, error: "DATOS_INVALIDOS" };
  if (p.duracionMin < DURACION_MIN_MIN || p.duracionMin > DURACION_MAX_MIN) return { ok: false, error: "DATOS_INVALIDOS" };

  const sala = await db.sala.findFirst({ where: { id: p.salaId, operadorId: ctx.operadorId }, include: { sede: true } });
  if (!sala || !sala.activa) return { ok: false, error: "SALA_INEXISTENTE" };
  const tz = sala.sede.zonaHoraria;

  // Grilla de ocurrencias (cada una desde SU fecha local; nunca +7*24h a un instante).
  const ocurrencias: { fecha: string; inicio: Date; fin: Date }[] = [];
  for (let k = 0; k < semanas; k++) {
    const fecha = sumarDiasLocal(p.fechaInicio, k * 7);
    if (!fecha) continue;
    const inicio = instanteDeHoraLocal(fecha, p.hora, tz);
    if (!inicio) continue;
    ocurrencias.push({ fecha, inicio, fin: new Date(inicio.getTime() + p.duracionMin * 60_000) });
  }
  if (ocurrencias.length === 0) return { ok: false, error: "DATOS_INVALIDOS" };

  // Todos los locks, ordenados ascendentemente y deduplicados.
  const claves = [
    ...new Set(ocurrencias.flatMap((o) => clavesDeLock({ salaId: sala.id, inquilinoId: ctx.inquilinoId, inicio: o.inicio, fin: o.fin, tz }))),
  ].sort();

  const serieId = randomUUID();

  try {
    return await db.$transaction(async (tx) => {
      for (const c of claves) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c}))`;

      const creadas: string[] = [];
      const conflictos: Conflicto[] = [];

      for (const o of ocurrencias) {
        const desdeLookback = new Date(o.inicio.getTime() - LOOKBACK_MIN * 60_000);
        const [ocupSala, ocupInq] = await Promise.all([
          tx.ocupacion.findMany({ where: { operadorId: ctx.operadorId, salaId: sala.id, estado: { in: OCUPAN }, inicio: { gte: desdeLookback, lt: o.fin }, fin: { gt: o.inicio } } }),
          tx.ocupacion.findMany({ where: { operadorId: ctx.operadorId, inquilinoId: ctx.inquilinoId, tipo: TipoOcupacion.reserva, estado: { in: OCUPAN }, inicio: { gte: desdeLookback, lt: o.fin }, fin: { gt: o.inicio } } }),
        ]);

        const veredicto = evaluarReserva({
          fecha: o.fecha,
          tz,
          horario: ctx.horario,
          politica: ctx.politica,
          intervalo: { inicio: o.inicio, fin: o.fin },
          inquilinoId: ctx.inquilinoId,
          bloqueaProfesional: ctx.bloqueaProfesional,
          ocupacionesSala: ocupSala.map(aMotor),
          ocupacionesInquilino: ocupInq.map(aMotor),
        });

        if (!veredicto.ok) {
          conflictos.push({ fecha: o.fecha, codigo: veredicto.codigo });
          continue;
        }

        const creada = await tx.ocupacion.create({
          data: {
            operadorId: ctx.operadorId,
            sedeId: sala.sedeId,
            salaId: sala.id,
            inquilinoId: ctx.inquilinoId,
            tipo: TipoOcupacion.reserva,
            estado: EstadoOcupacion.confirmada,
            inicio: o.inicio,
            fin: o.fin,
            bufferMin: ctx.politica.bufferMin,
            tzSede: tz,
            bloqueaProfesional: ctx.bloqueaProfesional,
            serieId,
            motivo: p.motivo ?? null,
          },
          select: { id: true },
        });
        creadas.push(creada.id);
      }

      // todo_o_nada: una sola ocurrencia que choque aborta la serie entera (rollback => 0 filas).
      if (p.modo === "todo_o_nada" && conflictos.length > 0) throw new AbortarSerie(conflictos);

      return { ok: true as const, serieId, creadas, conflictos };
    });
  } catch (e) {
    if (e instanceof AbortarSerie) return { ok: false, error: "SERIE_ABORTADA", conflictos: e.conflictos };
    throw e;
  }
}
