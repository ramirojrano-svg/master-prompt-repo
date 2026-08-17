// src/servicios/reservas/mover.ts — arrastrar un turno: cambia sala Y horario (§4.10.3).
//
// Es el hermano de reubicar.ts, que solo cambia de sala. Las reglas duras se mantienen:
// NUNCA `UPDATE inicio/salaId`. Siempre par — la fila vieja pasa a `reubicada` y nace una nueva
// con `reemplazaAId`. Lo que se facturó en marzo tiene que seguir dando lo mismo en marzo aunque
// el turno se haya movido en abril, y eso solo se sostiene si las filas no se reescriben.
//
// Dos decisiones que no son obvias:
//
//  1. EL PRECIO VIAJA. La fila nueva copia tarifaId/precioHora/importe de la vieja en vez de
//     recotizar. Mover un turno no es volver a venderlo: si arrastrarlo a otra sala lo recotizara,
//     el profesional vería cambiar el precio de algo que ya había acordado. Un cambio de precio
//     es una decisión comercial explícita, no el efecto secundario de corregir la agenda.
//
//  2. EL CARGO SE MUDA, no se duplica. El asiento de la cuenta corriente se re-apunta a la fila
//     nueva (clave, reservaId, periodo y fechaHecho). Si se dejara clavado en la fila vieja, un
//     turno movido del 31 de enero al 1 de febrero quedaría facturado en enero y contado como
//     hora en febrero; y si en vez de mudarlo se asentara uno nuevo, se cobraría dos veces.
//     Un asiento ya sellado en una liquidación NO se toca: ahí el mes está cerrado.

import { EstadoOcupacion, type PrismaClient, TipoOcupacion } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { esChoqueDeOcupacion } from "../../db/errores.ts";
import { clavesDeLock } from "../../dominio/locks.ts";
import { evaluarVentana } from "../../dominio/motor/disponibilidad.ts";
import { evaluarReserva } from "../../dominio/motor/reserva.ts";
import { LOOKBACK_MIN } from "../../dominio/motor/limites.ts";
import { instanteDeHoraLocal, periodoDeInstante } from "../../dominio/motor/zona.ts";
import type { HorarioSemanal, PoliticaCentro } from "../../dominio/motor/tipos.ts";
import { aMotor, OCUPAN } from "./comun.ts";

export type CtxMover = {
  operadorId: string;
  politica: PoliticaCentro;
  horario: HorarioSemanal; // el de la sala DESTINO: es la que decide si el horario existe
  ahora?: Date;
};

export type ErrorMover =
  | "NO_ENCONTRADA"
  | "NO_MOVIBLE" // un bloqueo no es el turno de nadie
  | "CONGELADA" // usada / no_show / ya cancelada: la fila alimentó un derivado
  | "SALA_INEXISTENTE"
  | "FECHA_INVALIDA"
  | "FECHA_PASADA"
  | "FUERA_DE_HORIZONTE"
  | "FUERA_DE_HORARIO"
  | "SLOT_OCUPADO"
  | "SOLAPA_INQUILINO"
  | "MES_CERRADO"
  | "SIN_CAMBIOS";

export type ResultadoMover = { ok: true; id: string } | { ok: false; error: ErrorMover };

export async function moverOcupacion(
  p: { ocupacionId: string; salaDestinoId: string; fecha: string; hora: string },
  ctx: CtxMover,
  db: PrismaClient = prisma,
): Promise<ResultadoMover> {
  const ahora = ctx.ahora ?? new Date();

  // 1. Origen. findFirst({id, operadorId}) y nunca findUnique({id}): el id viene del cliente.
  const origen = await db.ocupacion.findFirst({
    where: { id: p.ocupacionId, operadorId: ctx.operadorId },
    select: {
      id: true, salaId: true, inquilinoId: true, tipo: true, estado: true, inicio: true, fin: true,
      bufferMin: true, bloqueaProfesional: true, motivo: true, notaInterna: true,
      tarifaId: true, precioHoraCent: true, importeCent: true,
    },
  });
  if (!origen || origen.salaId == null || origen.inicio == null || origen.fin == null) return { ok: false, error: "NO_ENCONTRADA" };
  // Solo se arrastra una reserva de alguien: un bloqueo no tiene profesional
  // al que reasignarle la hora ni cargo que mudar.
  if (origen.tipo !== TipoOcupacion.reserva || origen.inquilinoId == null) return { ok: false, error: "NO_MOVIBLE" };
  if (origen.estado !== EstadoOcupacion.confirmada) return { ok: false, error: "CONGELADA" };
  const inquilinoId = origen.inquilinoId;

  // 2. Sala destino: su sede define la zona, y su horario define qué es "fuera de horario".
  const dest = await db.sala.findFirst({ where: { id: p.salaDestinoId, operadorId: ctx.operadorId }, include: { sede: true } });
  if (!dest || !dest.activa) return { ok: false, error: "SALA_INEXISTENTE" };
  const tz = dest.sede.zonaHoraria;

  // 3. El intervalo nuevo. La DURACIÓN se conserva: arrastrar mueve, no estira.
  const inicio = instanteDeHoraLocal(p.fecha, p.hora, tz);
  if (!inicio) return { ok: false, error: "FECHA_INVALIDA" };
  const fin = new Date(inicio.getTime() + (origen.fin.getTime() - origen.inicio.getTime()));

  // Soltar el bloque donde ya estaba no es un error, pero tampoco una escritura: cerrar la fila
  // y abrir otra idéntica ensuciaría el historial con un movimiento que no ocurrió.
  if (dest.id === origen.salaId && inicio.getTime() === origen.inicio.getTime()) return { ok: false, error: "SIN_CAMBIOS" };

  const vent = evaluarVentana(p.fecha, tz, ahora, ctx.politica.horizonteDias);
  if (!vent.ok) return { ok: false, error: vent.motivo };

  // 4. Locks: los DOS intervalos (de dónde sale y a dónde va) y las DOS salas, ordenados.
  //    Solo el destino no alcanza: dos movimientos cruzados sobre las mismas filas se pisarían.
  const claves = [
    ...new Set([
      ...clavesDeLock({ salaId: origen.salaId, inquilinoId, inicio: origen.inicio, fin: origen.fin, tz }),
      ...clavesDeLock({ salaId: dest.id, inquilinoId, inicio, fin, tz }),
    ]),
  ].sort();
  const desdeLookback = new Date(inicio.getTime() - LOOKBACK_MIN * 60_000);

  try {
    return await db.$transaction(async (tx) => {
      for (const c of claves) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c}))`;

      // 4a. La foto EXCLUYE la fila que se está moviendo. Sin esto, correr un turno media hora
      //     dentro de su propia sala choca contra sí mismo y no se puede mover nunca.
      const [ocupSala, ocupInq] = await Promise.all([
        tx.ocupacion.findMany({
          where: {
            operadorId: ctx.operadorId, salaId: dest.id, estado: { in: OCUPAN },
            inicio: { gte: desdeLookback, lt: fin }, fin: { gt: inicio }, id: { not: origen.id },
          },
        }),
        tx.ocupacion.findMany({
          where: {
            operadorId: ctx.operadorId, inquilinoId, tipo: TipoOcupacion.reserva,
            estado: { in: OCUPAN }, inicio: { gte: desdeLookback, lt: fin }, fin: { gt: inicio }, id: { not: origen.id },
          },
        }),
      ]);

      // 4b. El motor puro decide (mismo juez que el alta: no hay una segunda regla acá).
      const veredicto = evaluarReserva({
        fecha: p.fecha,
        tz,
        horario: ctx.horario,
        politica: ctx.politica,
        intervalo: { inicio, fin },
        inquilinoId,
        bloqueaProfesional: origen.bloqueaProfesional,
        ocupacionesSala: ocupSala.map(aMotor),
        ocupacionesInquilino: ocupInq.map(aMotor),
      });
      if (!veredicto.ok) return { ok: false as const, error: veredicto.codigo as ErrorMover };

      // 4c. El cargo, ANTES de escribir: si el mes ya se liquidó, el movimiento no va. Mover el
      //     turno dejaría la hora en un mes y la plata sellada en otro.
      const cargo = await tx.asiento.findFirst({
        where: { operadorId: ctx.operadorId, clave: `cargo_uso:${origen.id}` },
        select: { id: true, liquidacionId: true },
      });
      if (cargo?.liquidacionId) return { ok: false as const, error: "MES_CERRADO" as ErrorMover };

      // 4d. Cierra la vieja, condicionado al estado: si otro la tocó entre la lectura y el lock,
      //     count 0 y se aborta en vez de pisar el cambio ajeno.
      const cerrada = await tx.ocupacion.updateMany({
        where: { id: origen.id, operadorId: ctx.operadorId, estado: EstadoOcupacion.confirmada },
        data: { estado: EstadoOcupacion.reubicada },
      });
      if (cerrada.count === 0) return { ok: false as const, error: "CONGELADA" as ErrorMover };

      // 4e. Nace la nueva. El constraint de exclusión es la última red: si igual choca, 23P01.
      const nueva = await tx.ocupacion.create({
        data: {
          operadorId: ctx.operadorId,
          sedeId: dest.sedeId,
          salaId: dest.id,
          inquilinoId,
          tipo: TipoOcupacion.reserva,
          estado: EstadoOcupacion.confirmada,
          inicio,
          fin,
          bufferMin: origen.bufferMin, // se conserva el buffer estampado al nacer
          tzSede: tz,
          bloqueaProfesional: origen.bloqueaProfesional,
          reemplazaAId: origen.id,
          motivo: origen.motivo,
          notaInterna: origen.notaInterna,
          // El precio VIAJA tal cual (ver cabecera): mover no es recotizar.
          tarifaId: origen.tarifaId,
          precioHoraCent: origen.precioHoraCent,
          importeCent: origen.importeCent,
        },
        select: { id: true },
      });

      // 4f. El cargo se muda a la fila nueva, con el mes recalculado en la zona de la SEDE.
      if (cargo) {
        await tx.asiento.update({
          where: { id: cargo.id },
          data: {
            clave: `cargo_uso:${nueva.id}`,
            reservaId: nueva.id,
            periodo: periodoDeInstante(inicio, tz),
            fechaHecho: inicio,
          },
        });
      }

      return { ok: true as const, id: nueva.id };
    });
  } catch (e) {
    const choque = esChoqueDeOcupacion(e);
    if (choque === "sala") return { ok: false, error: "SLOT_OCUPADO" };
    if (choque === "inquilino") return { ok: false, error: "SOLAPA_INQUILINO" };
    throw e;
  }
}
