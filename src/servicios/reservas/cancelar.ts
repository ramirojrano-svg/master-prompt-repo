// src/servicios/reservas/cancelar.ts — cancelar un turno desde el panel (§4.10).
//
// Cancelar es la única operación del turno que faltaba: se podía crear y mover, pero no dar de
// baja, y entonces un turno que no iba a pasar seguía ocupando la sala y facturado.
//
// Tres decisiones:
//
//  1. LA PLATA SE DEVUELVE ENTERA. Esto lo cancela el OPERADOR desde su panel, y la política pura
//     (calcularCancelacion, §4.10) ya dice que el origen `operador` reembolsa el 100% sin pasar
//     por los escalones de 48/24 h: el que dio de baja el turno fue el centro, no el profesional.
//     Los escalones son para la cancelación que inicia el inquilino desde el portal, que es otro
//     camino y todavía no existe.
//
//  2. NO SE BORRA EL CARGO: se contra-asienta. Nace una nota de crédito que apunta al asiento
//     original (`revierteAId`). Borrar la fila dejaría el mes cuadrando por arte de magia y sin
//     rastro de que hubo un cobro y una devolución.
//
//  3. LA REVERSA VA AL MISMO MES QUE EL CARGO. Así el mes del turno vuelve a reflejar que ese
//     turno no ocurrió. Es seguro porque un mes ya liquidado bloquea la cancelación: los meses
//     abiertos todavía pueden cambiar, los cerrados no se tocan nunca.

import { EstadoOcupacion, type PrismaClient, TipoOcupacion } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { asentarIdempotente } from "../plata/ledger.ts";

export type ErrorCancelar =
  | "NO_ENCONTRADA"
  | "NO_CANCELABLE" // bloqueo/mantenimiento: no es el turno de nadie
  | "CONGELADA" // usada / no_show: la fila ya alimentó un derivado
  | "YA_CANCELADA"
  | "MES_CERRADO";

export type ResultadoCancelar = { ok: true; devueltoCent: bigint } | { ok: false; error: ErrorCancelar };

export async function cancelarOcupacion(
  p: { ocupacionId: string; motivo?: string },
  ctx: { operadorId: string; moneda?: string },
  db: PrismaClient = prisma,
): Promise<ResultadoCancelar> {
  // El id viene del cliente: findFirst({id, operadorId}), nunca findUnique({id}).
  const o = await db.ocupacion.findFirst({
    where: { id: p.ocupacionId, operadorId: ctx.operadorId },
    select: { id: true, tipo: true, estado: true, inquilinoId: true },
  });
  if (!o) return { ok: false, error: "NO_ENCONTRADA" };
  if (o.tipo !== TipoOcupacion.reserva || o.inquilinoId == null) return { ok: false, error: "NO_CANCELABLE" };
  if (o.estado === EstadoOcupacion.cancelada) return { ok: false, error: "YA_CANCELADA" };
  if (o.estado !== EstadoOcupacion.confirmada) return { ok: false, error: "CONGELADA" };
  const inquilinoId = o.inquilinoId;

  return db.$transaction(async (tx) => {
    // El cargo primero: si el mes está sellado no se cancela nada. Devolver plata de un mes ya
    // liquidado cambiaría un total que el profesional ya recibió cerrado.
    const cargo = await tx.asiento.findFirst({
      where: { operadorId: ctx.operadorId, clave: `cargo_uso:${o.id}` },
      select: { id: true, montoCent: true, moneda: true, periodo: true, fechaHecho: true, liquidacionId: true },
    });
    if (cargo?.liquidacionId) return { ok: false as const, error: "MES_CERRADO" as ErrorCancelar };

    // Condicionado al estado: si otro la tocó entre la lectura y acá, count 0 y se aborta en vez
    // de pisar el cambio ajeno.
    const cerrada = await tx.ocupacion.updateMany({
      where: { id: o.id, operadorId: ctx.operadorId, estado: EstadoOcupacion.confirmada },
      data: { estado: EstadoOcupacion.cancelada, motivo: p.motivo ?? null },
    });
    if (cerrada.count === 0) return { ok: false as const, error: "CONGELADA" as ErrorCancelar };

    if (!cargo || cargo.montoCent <= 0n) return { ok: true as const, devueltoCent: 0n };

    // Nota de crédito por el total. La clave es idempotente: cancelar dos veces no devuelve dos
    // veces (aunque el updateMany de arriba ya lo impide, el libro no depende de ese orden).
    await asentarIdempotente(tx, {
      operadorId: ctx.operadorId,
      inquilinoId,
      concepto: "nota_credito",
      montoCent: -cargo.montoCent, // negativo: va a FAVOR del profesional
      moneda: cargo.moneda ?? ctx.moneda ?? "ARS",
      periodo: cargo.periodo, // el mes del cargo, no el de hoy (ver cabecera)
      fechaHecho: cargo.fechaHecho,
      clave: `reversa:cargo_uso:${o.id}`,
      reservaId: o.id,
      revierteAId: cargo.id,
      motivo: p.motivo ?? "turno cancelado por el centro", // obligatorio en nota_credito
    });

    return { ok: true as const, devueltoCent: cargo.montoCent };
  });
}
