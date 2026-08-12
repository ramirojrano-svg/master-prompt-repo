// src/servicios/reservas/crear.ts — EL único camino de escritura de ocupaciones (§4.8.4).
// La capa de servicios es delgada: abre transacción, toma locks, arma la foto, llama al motor
// PURO, escribe, y mapea el 23P01. Ninguna regla de negocio se escribe acá.
//
// TODOS los caminos que crean ocupación pasan por acá (panel, portal, aprobación de solicitud,
// series, importación). Si un camino la esquiva, el lock no sirve para ninguno — el constraint
// de exclusión sí, por eso está.

import { EstadoOcupacion, type PrismaClient, TipoOcupacion } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { esChoqueDeOcupacion } from "../../db/errores.ts";
import { clavesDeLock } from "../../dominio/locks.ts";
import { ReservaInput, validarVentanaReserva } from "../../dominio/reserva-entrada.ts";
import { evaluarVentana } from "../../dominio/motor/disponibilidad.ts";
import { LOOKBACK_MIN } from "../../dominio/motor/limites.ts";
import { evaluarReserva } from "../../dominio/motor/reserva.ts";
import type { HorarioSemanal, PoliticaCentro } from "../../dominio/motor/tipos.ts";
import { aMotor, OCUPAN } from "./comun.ts";

export type CtxReserva = {
  operadorId: string;
  inquilinoId: string;
  politica: PoliticaCentro;
  horario: HorarioSemanal; // el de la sala; la fuente de FUERA_DE_HORARIO
  bloqueaProfesional: boolean;
  ahora?: Date; // inyectable para tests; en prod es new Date()
};

export type ErrorReserva =
  | "DATOS_INVALIDOS"
  | "SALA_INEXISTENTE"
  | "FECHA_INVALIDA"
  | "FECHA_INCONSISTENTE"
  | "FUERA_DE_HORIZONTE"
  | "FECHA_PASADA"
  | "FUERA_DE_HORARIO"
  | "SLOT_OCUPADO"
  | "SOLAPA_INQUILINO";

export type ResultadoCrear = { ok: true; id: string } | { ok: false; error: ErrorReserva };

export async function crearOcupacion(raw: unknown, ctx: CtxReserva, db: PrismaClient = prisma): Promise<ResultadoCrear> {
  const ahora = ctx.ahora ?? new Date();

  // 1. Borde de entrada (módulo puro, testeado).
  const p = ReservaInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "DATOS_INVALIDOS" };

  // 2. Pertenencia + tz de la sede. El id vino del cliente: findFirst({id, operadorId}), nunca
  //    findUnique({id}). Sin match => SALA_INEXISTENTE, jamás caída silenciosa a otra sala.
  const sala = await db.sala.findFirst({
    where: { id: p.data.salaId, operadorId: ctx.operadorId },
    include: { sede: true },
  });
  if (!sala || !sala.activa) return { ok: false, error: "SALA_INEXISTENTE" };
  const tz = sala.sede.zonaHoraria;

  // 3. Ventana: el POST se puede forjar (fecha ≠ día de inicioISO) y el horizonte.
  const v = validarVentanaReserva(p.data, tz, ahora);
  if (!v.ok) return { ok: false, error: v.error };
  const vent = evaluarVentana(v.fecha, tz, ahora, ctx.politica.horizonteDias);
  if (!vent.ok) return { ok: false, error: vent.motivo };

  // 4. Claves de lock (ordenadas, una fábrica única) y ventana de lookback para la foto.
  const claves = clavesDeLock({ salaId: sala.id, inquilinoId: ctx.inquilinoId, inicio: v.inicio, fin: v.fin, tz });
  const desdeLookback = new Date(v.inicio.getTime() - LOOKBACK_MIN * 60_000);

  try {
    return await db.$transaction(async (tx) => {
      // 4a. LOCKS, primero. hashtext colisiona en 32 bits: una colisión sobre-serializa
      //     (dirección segura), nunca pierde el lock.
      for (const c of claves) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c}))`;
      }

      // 4b. Foto DESDE la transacción (no una calculada antes del lock).
      const [ocupSala, ocupInq] = await Promise.all([
        tx.ocupacion.findMany({
          where: { operadorId: ctx.operadorId, salaId: sala.id, estado: { in: OCUPAN }, inicio: { gte: desdeLookback, lt: v.fin }, fin: { gt: v.inicio } },
        }),
        tx.ocupacion.findMany({
          where: { operadorId: ctx.operadorId, inquilinoId: ctx.inquilinoId, tipo: TipoOcupacion.reserva, estado: { in: OCUPAN }, inicio: { gte: desdeLookback, lt: v.fin }, fin: { gt: v.inicio } },
        }),
      ]);

      // 4c. Motor puro decide.
      const veredicto = evaluarReserva({
        fecha: v.fecha,
        tz,
        horario: ctx.horario,
        politica: ctx.politica,
        intervalo: { inicio: v.inicio, fin: v.fin },
        inquilinoId: ctx.inquilinoId,
        bloqueaProfesional: ctx.bloqueaProfesional,
        ocupacionesSala: ocupSala.map(aMotor),
        ocupacionesInquilino: ocupInq.map(aMotor),
      });
      if (!veredicto.ok) return { ok: false as const, error: veredicto.codigo };

      // 4d. Escritura. El constraint es la última red: si igual choca, sale 23P01.
      const creada = await tx.ocupacion.create({
        data: {
          operadorId: ctx.operadorId,
          sedeId: sala.sedeId,
          salaId: sala.id,
          inquilinoId: ctx.inquilinoId,
          tipo: TipoOcupacion.reserva,
          estado: EstadoOcupacion.confirmada,
          inicio: v.inicio,
          fin: v.fin,
          bufferMin: ctx.politica.bufferMin, // ESTAMPADO al nacer
          tzSede: tz,
          bloqueaProfesional: ctx.bloqueaProfesional,
        },
        select: { id: true },
      });
      return { ok: true as const, id: creada.id };
    });
  } catch (e) {
    const choque = esChoqueDeOcupacion(e);
    if (choque === "sala") return { ok: false, error: "SLOT_OCUPADO" };
    if (choque === "inquilino") return { ok: false, error: "SOLAPA_INQUILINO" };
    throw e;
  }
}
