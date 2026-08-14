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

/**
 * Qué se cancela cuando el turno es parte de una serie recurrente.
 *  · solo        — nada más que este.
 *  · siguientes  — este y todos los que vienen después (los pasados NO se tocan: ya ocurrieron).
 *  · serie       — toda la serie, incluidos los anteriores que sigan confirmados.
 */
export type Alcance = "solo" | "siguientes" | "serie";

export type ErrorCancelar =
  | "NO_ENCONTRADA"
  | "NO_CANCELABLE" // bloqueo/mantenimiento: no es el turno de nadie
  | "CONGELADA" // usada / no_show: la fila ya alimentó un derivado
  | "YA_CANCELADA"
  | "MES_CERRADO";

export type ResultadoCancelar =
  | { ok: true; canceladas: number; omitidas: number; devueltoCent: bigint }
  | { ok: false; error: ErrorCancelar };

export async function cancelarOcupacion(
  p: { ocupacionId: string; alcance?: Alcance; motivo?: string },
  ctx: { operadorId: string; moneda?: string },
  db: PrismaClient = prisma,
): Promise<ResultadoCancelar> {
  // El id viene del cliente: findFirst({id, operadorId}), nunca findUnique({id}).
  const o = await db.ocupacion.findFirst({
    where: { id: p.ocupacionId, operadorId: ctx.operadorId },
    select: { id: true, tipo: true, estado: true, inquilinoId: true, serieId: true, inicio: true },
  });
  if (!o) return { ok: false, error: "NO_ENCONTRADA" };
  if (o.tipo !== TipoOcupacion.reserva || o.inquilinoId == null) return { ok: false, error: "NO_CANCELABLE" };
  if (o.estado === EstadoOcupacion.cancelada) return { ok: false, error: "YA_CANCELADA" };
  if (o.estado !== EstadoOcupacion.confirmada) return { ok: false, error: "CONGELADA" };
  // A qué filas alcanza. Sin serie —o pidiendo "solo"— es una sola. El alcance NUNCA se amplía
  // por su cuenta: si el turno no es parte de una serie, "todos" sigue siendo este.
  const alcance: Alcance = o.serieId ? (p.alcance ?? "solo") : "solo";
  const objetivos =
    alcance === "solo"
      ? [o]
      : await db.ocupacion.findMany({
          where: {
            operadorId: ctx.operadorId,
            serieId: o.serieId,
            // Se traen también las congeladas (usadas / no vino) para poder contarlas como
            // omitidas y decírselo al operador. Las ya canceladas o reubicadas no son noticia.
            estado: { in: [EstadoOcupacion.confirmada, EstadoOcupacion.en_curso, EstadoOcupacion.usada, EstadoOcupacion.no_show] },
            // "siguientes" incluye a este: lo pasado ya ocurrió y no se deshace desde acá.
            ...(alcance === "siguientes" && o.inicio ? { inicio: { gte: o.inicio } } : {}),
          },
          select: { id: true, tipo: true, estado: true, inquilinoId: true, serieId: true, inicio: true },
          orderBy: { inicio: "asc" },
        });

  return db.$transaction(async (tx) => {
    let canceladas = 0;
    let omitidas = 0;
    let devuelto = 0n;
    let primerMotivo: ErrorCancelar | null = null;

    for (const t of objetivos) {
      const r = await cancelarUna(tx, t, { operadorId: ctx.operadorId, moneda: ctx.moneda, motivo: p.motivo });
      if (r.ok) {
        canceladas++;
        devuelto += r.devuelto;
      } else {
        omitidas++;
        primerMotivo ??= r.motivo;
      }
    }

    // Si NADA se pudo cancelar se devuelve el motivo REAL de la primera, no una adivinanza:
    // "0 canceladas, todo bien" ante un mes liquidado es peor que decir por qué no se pudo.
    if (canceladas === 0) return { ok: false as const, error: primerMotivo ?? "CONGELADA" };
    return { ok: true as const, canceladas, omitidas, devueltoCent: devuelto };
  });
}

type FilaCancelable = { id: string; inquilinoId: string | null };

/**
 * Cancela UNA fila adentro de una transacción ya abierta. Dice cuánto devolvió, o POR QUÉ no se
 * pudo — el motivo se necesita arriba para explicar un intento que no canceló nada.
 */
async function cancelarUna(
  tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  o: FilaCancelable,
  ctx: { operadorId: string; moneda?: string; motivo?: string },
): Promise<{ ok: true; devuelto: bigint } | { ok: false; motivo: ErrorCancelar }> {
  const inquilinoId = o.inquilinoId;
  if (!inquilinoId) return { ok: false, motivo: "NO_CANCELABLE" };
  {
    // El cargo primero: si el mes está sellado esta fila no se toca. Devolver plata de un mes ya
    // liquidado cambiaría un total que el profesional ya recibió cerrado.
    const cargo = await tx.asiento.findFirst({
      where: { operadorId: ctx.operadorId, clave: `cargo_uso:${o.id}` },
      select: { id: true, montoCent: true, moneda: true, periodo: true, fechaHecho: true, liquidacionId: true },
    });
    if (cargo?.liquidacionId) return { ok: false, motivo: "MES_CERRADO" };

    // Condicionado al estado: si otro la tocó entre la lectura y acá, count 0 y se aborta en vez
    // de pisar el cambio ajeno.
    const cerrada = await tx.ocupacion.updateMany({
      where: { id: o.id, operadorId: ctx.operadorId, estado: EstadoOcupacion.confirmada },
      data: { estado: EstadoOcupacion.cancelada, motivo: ctx.motivo ?? null },
    });
    if (cerrada.count === 0) return { ok: false, motivo: "CONGELADA" };

    if (!cargo || cargo.montoCent <= 0n) return { ok: true, devuelto: 0n };

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
      motivo: ctx.motivo ?? "turno cancelado por el centro", // obligatorio en nota_credito
    });

    return { ok: true, devuelto: cargo.montoCent };
  }
}
