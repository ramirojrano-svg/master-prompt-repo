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
import { cotizar, resolverTarifa } from "../../dominio/tarifa.ts";
import { periodoDeInstante } from "../../dominio/motor/zona.ts";
import { asentarIdempotente } from "../plata/ledger.ts";
import type { HorarioSemanal, PoliticaCentro } from "../../dominio/motor/tipos.ts";
import { aMotor, OCUPAN } from "./comun.ts";

export type CtxReserva = {
  operadorId: string;
  inquilinoId: string;
  politica: PoliticaCentro;
  horario: HorarioSemanal; // el de la sala; la fuente de FUERA_DE_HORARIO
  bloqueaProfesional: boolean;
  moneda?: string; // del operador; default ARS
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

/** Opciones para reutilizar el camino de escritura como HOLD de lista de espera (§4.11). */
export type CrearOpts = { tipo?: "reserva" | "hold"; expiraAt?: Date };

export async function crearOcupacion(raw: unknown, ctx: CtxReserva, db: PrismaClient = prisma, opts: CrearOpts = {}): Promise<ResultadoCrear> {
  const ahora = ctx.ahora ?? new Date();
  const esHold = opts.tipo === "hold";
  const tipoFila = esHold ? TipoOcupacion.hold : TipoOcupacion.reserva;
  // El eje inquilino (constraint y motor) es SOLO para reservas: un hold ocupa la sala, no la agenda del profesional.
  const bloqueaProf = esHold ? false : ctx.bloqueaProfesional;

  // 1. Borde de entrada (módulo puro, testeado).
  const p = ReservaInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "DATOS_INVALIDOS" };

  // 2. Pertenencia + tz de la sede. El id vino del cliente: findFirst({id, operadorId}), nunca
  //    findUnique({id}). Sin match => SALA_INEXISTENTE, jamás caída silenciosa a otra sala.
  //
  //    SIN CONSULTORIO (salaId null): son horas que se consumen y se facturan pero no usan el
  //    espacio. No hay sala de la que sacar la zona ni el horario, así que salen de la SEDE. Un
  //    hold siempre reserva una sala concreta —es una lista de espera POR consultorio—, así que
  //    ahí la sala sigue siendo obligatoria.
  const sala = p.data.salaId
    ? await db.sala.findFirst({ where: { id: p.data.salaId, operadorId: ctx.operadorId }, include: { sede: true } })
    : null;
  if (p.data.salaId && (!sala || !sala.activa)) return { ok: false, error: "SALA_INEXISTENTE" };
  if (!sala && esHold) return { ok: false, error: "SALA_INEXISTENTE" };

  const sede = sala?.sede ?? (await db.sede.findFirst({ where: { operadorId: ctx.operadorId, activa: true } }));
  if (!sede) return { ok: false, error: "SALA_INEXISTENTE" };
  const tz = sede.zonaHoraria;

  // 3. Ventana: el POST se puede forjar (fecha ≠ día de inicioISO) y el horizonte.
  const v = validarVentanaReserva(p.data, tz, ahora);
  if (!v.ok) return { ok: false, error: v.error };
  const vent = evaluarVentana(v.fecha, tz, ahora, ctx.politica.horizonteDias);
  if (!vent.ok) return { ok: false, error: vent.motivo };

  // 4. Claves de lock (ordenadas, una fábrica única) y ventana de lookback para la foto.
  const claves = clavesDeLock({ salaId: sala?.id ?? null, inquilinoId: ctx.inquilinoId, inicio: v.inicio, fin: v.fin, tz });
  const desdeLookback = new Date(v.inicio.getTime() - LOOKBACK_MIN * 60_000);

  try {
    return await db.$transaction(async (tx) => {
      // 4a. LOCKS, primero. hashtext colisiona en 32 bits: una colisión sobre-serializa
      //     (dirección segura), nunca pierde el lock.
      for (const c of claves) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c}))`;
      }

      // 4a-bis. Limpieza PEREZOSA de holds vencidos que pisan esta sala (§4.11): se marcan
      //         expirada adentro del lock y dejan de ocupar. Depender solo del cron dejaría
      //         slots muertos si una corrida se cae.
      if (sala) {
        await tx.ocupacion.updateMany({
          where: { operadorId: ctx.operadorId, salaId: sala.id, tipo: TipoOcupacion.hold, estado: EstadoOcupacion.confirmada, expiraAt: { lt: ahora } },
          data: { estado: EstadoOcupacion.expirada },
        });
      }

      // 4b. Foto DESDE la transacción (no una calculada antes del lock).
      const [ocupSala, ocupInq] = await Promise.all([
        // Sin sala no hay eje de sala: nada que chocar. El eje del PROFESIONAL sigue valiendo —no
        // se puede estar en dos lugares a la vez, y "afuera" también es un lugar.
        sala
          ? tx.ocupacion.findMany({
              where: { operadorId: ctx.operadorId, salaId: sala.id, estado: { in: OCUPAN }, inicio: { gte: desdeLookback, lt: v.fin }, fin: { gt: v.inicio } },
            })
          : Promise.resolve([]),
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
        bloqueaProfesional: bloqueaProf,
        ocupacionesSala: ocupSala.map(aMotor),
        ocupacionesInquilino: ocupInq.map(aMotor),
      });
      if (!veredicto.ok) return { ok: false as const, error: veredicto.codigo };

      // 4d. Cotización: se resuelve la tarifa vigente y se ESTAMPA (§8.8). Un hold todavía no
      //     cobra nada (no es una reserva); el precio se fija cuando se confirma.
      const minutos = Math.round((v.fin.getTime() - v.inicio.getTime()) / 60_000);
      const tarifa = esHold
        ? null
        : resolverTarifa(
            await tx.tarifa.findMany({
              where: { operadorId: ctx.operadorId, vigenteDesde: { lte: ahora }, OR: [{ vigenteHasta: null }, { vigenteHasta: { gt: ahora } }] },
              select: { id: true, salaId: true, inquilinoId: true, precioHoraCent: true, vigenteDesde: true, vigenteHasta: true },
            }),
            // Sin sala se resuelve igual: las tarifas por sala no aplican y gana la del
            // profesional o la general, que es lo que se quiere — se cobra lo mismo.
            { salaId: sala?.id ?? "", inquilinoId: ctx.inquilinoId, ahora },
          );
      // Sin tarifa se estampa NULL, no cero: "todavía no había precio" y "esta hora salió $0" son
      // dos cosas distintas, y meses después nadie va a poder distinguirlas si guardamos un 0.
      const cot = tarifa ? cotizar(tarifa, minutos) : null;

      // 4e. Escritura. El constraint es la última red: si igual choca, sale 23P01.
      const creada = await tx.ocupacion.create({
        data: {
          operadorId: ctx.operadorId,
          sedeId: sede.id,
          salaId: sala?.id ?? null,
          inquilinoId: ctx.inquilinoId,
          tipo: tipoFila,
          estado: EstadoOcupacion.confirmada,
          inicio: v.inicio,
          fin: v.fin,
          bufferMin: ctx.politica.bufferMin, // ESTAMPADO al nacer
          tzSede: tz,
          bloqueaProfesional: bloqueaProf,
          expiraAt: opts.expiraAt ?? null, // requerido para tipo='hold' (CHECK)
          tarifaId: cot?.tarifaId ?? null,
          precioHoraCent: cot?.precioHoraCent ?? null,
          importeCent: cot?.importeCent ?? null,
        },
        select: { id: true },
      });

      // 4f. RECIÉN ACÁ lo irreversible: el cargo a la cuenta corriente. Si algo falló antes, la
      //     reserva no queda huérfana ni el cargo suelto — los dos viven en la misma tx.
      //     Clave idempotente por ocupación: una renotificación o un reintento no cobra dos veces.
      if (cot && cot.importeCent > 0n) {
        await asentarIdempotente(tx, {
          operadorId: ctx.operadorId,
          inquilinoId: ctx.inquilinoId,
          concepto: "cargo_uso",
          montoCent: cot.importeCent, // positivo: el profesional DEBE
          moneda: ctx.moneda ?? "ARS",
          periodo: periodoDeInstante(v.inicio, tz), // el mes se corta en la zona de la SEDE
          fechaHecho: v.inicio,
          clave: `cargo_uso:${creada.id}`,
          reservaId: creada.id,
        });
      }

      return { ok: true as const, id: creada.id };
    });
  } catch (e) {
    const choque = esChoqueDeOcupacion(e);
    if (choque === "sala") return { ok: false, error: "SLOT_OCUPADO" };
    if (choque === "inquilino") return { ok: false, error: "SOLAPA_INQUILINO" };
    throw e;
  }
}
