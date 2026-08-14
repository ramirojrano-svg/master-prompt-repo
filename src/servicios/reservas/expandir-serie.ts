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
import { instanteDeHoraLocal, periodoDeInstante } from "../../dominio/motor/zona.ts";
import { cotizar, resolverTarifa } from "../../dominio/tarifa.ts";
import { asentarIdempotente } from "../plata/ledger.ts";
import { fechasDeSerie, OCURRENCIAS_MAX, type Repeticion } from "../../dominio/repeticion.ts";
import type { CtxReserva } from "./crear.ts";
import { aMotor, OCUPAN } from "./comun.ts";

export type ModoSerie = "parcial" | "todo_o_nada";

export type ParamsSerie = {
  salaId: string;
  hora: string; // 'HH:MM'
  duracionMin: number;
  fechaInicio: string; // 'YYYY-MM-DD'
  /** Qué patrón repite: diaria, hábiles, semanal, mensual ("el segundo viernes") o anual. */
  repeticion: Repeticion;
  /** Cuántas ocurrencias. Los meses que no tienen la fecha se saltean SIN gastar cupo. */
  cantidad: number;
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
  if (p.cantidad < 1 || p.cantidad > OCURRENCIAS_MAX) return { ok: false, error: "DATOS_INVALIDOS" };
  if (p.duracionMin < DURACION_MIN_MIN || p.duracionMin > DURACION_MAX_MIN) return { ok: false, error: "DATOS_INVALIDOS" };

  const sala = await db.sala.findFirst({ where: { id: p.salaId, operadorId: ctx.operadorId }, include: { sede: true } });
  if (!sala || !sala.activa) return { ok: false, error: "SALA_INEXISTENTE" };
  const tz = sala.sede.zonaHoraria;

  // Las FECHAS las decide el módulo puro de repetición (calendario, sin horas ni zonas). Acá
  // solo se les pone la hora, cada una en la zona de SU sede: nunca +7*24h sobre un instante.
  const ocurrencias: { fecha: string; inicio: Date; fin: Date }[] = [];
  for (const fecha of fechasDeSerie(p.fechaInicio, p.repeticion, p.cantidad)) {
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

      // La tarifa vigente se resuelve UNA vez para toda la serie: no cambia entre ocurrencias
      // dentro de la misma transacción, y consultarla N veces sería N consultas para el mismo dato.
      const tarifas = await tx.tarifa.findMany({
        where: { operadorId: ctx.operadorId, vigenteDesde: { lte: ahora }, OR: [{ vigenteHasta: null }, { vigenteHasta: { gt: ahora } }] },
        select: { id: true, salaId: true, inquilinoId: true, precioHoraCent: true, vigenteDesde: true, vigenteHasta: true },
      });
      const tarifa = resolverTarifa(tarifas, { salaId: sala.id, inquilinoId: ctx.inquilinoId, ahora });
      const cot = tarifa ? cotizar(tarifa, p.duracionMin) : null;

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
            // El precio se ESTAMPA igual que en un alta suelta. Sin esto una serie nacía sin
            // precio y sin cargo: cincuenta turnos que ocupaban la sala y no le facturaban un
            // peso a nadie, y el resumen del mes los mostraba como horas regaladas.
            tarifaId: cot?.tarifaId ?? null,
            precioHoraCent: cot?.precioHoraCent ?? null,
            importeCent: cot?.importeCent ?? null,
          },
          select: { id: true },
        });

        // El cargo va en la MISMA transacción que la fila, con el período de SU ocurrencia: una
        // serie cruza meses, y todas las cuotas no pueden caer en el mes de la primera.
        if (cot && cot.importeCent > 0n) {
          await asentarIdempotente(tx, {
            operadorId: ctx.operadorId,
            inquilinoId: ctx.inquilinoId,
            concepto: "cargo_uso",
            montoCent: cot.importeCent,
            moneda: ctx.moneda ?? "ARS",
            periodo: periodoDeInstante(o.inicio, tz),
            fechaHecho: o.inicio,
            clave: `cargo_uso:${creada.id}`,
            reservaId: creada.id,
          });
        }
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
