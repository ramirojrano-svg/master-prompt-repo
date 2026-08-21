// src/servicios/plata/despreciar.ts — sacarle la plata a las reservas de quien no factura.
//
// Destildar "factura" en la ficha vale de ahí en adelante: la reserva estampa su precio al nacer y
// no se vuelve a tocar (§8.8), igual que subir la tarifa no reprecia el mes pasado. Esa regla es
// correcta y no se cambia.
//
// Pero deja un caso sin salida. A alguien se le venían cobrando las horas, se corrige la ficha, y
// las reservas ya cargadas siguen con su valor por hora y sus `cargo_uso`: el profesional aparece
// en Cobranza y en Cierre de mes con plata a reclamar que nadie le va a reclamar, y al abrir un
// turno suyo se lee "Valor hora $8.000" al lado del cartel que dice que no factura.
//
// Esto es la corrección, y es EXPLÍCITA: no pasa sola al destildar la casilla. Cambiar una marca
// de la ficha no puede borrar plata de meses anteriores sin que nadie lo pida.
//
// Dos límites que la hacen segura:
//
//  1. NO TOCA UN MES CERRADO. Un cargo con `liquidacionId` ya salió en un papel que el profesional
//     recibió; borrarlo cambiaría un documento emitido. Esos se informan aparte y quedan como
//     están — para eso está la nota de crédito.
//  2. SOLO sobre quien tiene la casilla destildada. Si mañana se la vuelven a tildar, esto no
//     corre: la pregunta se la hace a `seLeFactura`, el mismo lugar que el resto del circuito.

import { z } from "zod";
import { type PrismaClient, TipoOcupacion } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { definirAccion } from "../../lib/accion.ts";
import type { Actor } from "../../lib/actor.ts";
import { seLeFactura } from "./facturable.ts";

/** Qué hay para limpiar. Se muestra antes de tocar nada. */
export type PlataPendiente = {
  /** Reservas con precio estampado que se puede sacar. */
  reservas: number;
  /** Cargos borrables: los que todavía no entraron en ninguna liquidación. */
  cargos: number;
  cargosCent: bigint;
  /** Cargos ya liquidados. NO se tocan: salieron en un papel. */
  cargosSellados: number;
  cargosSelladosCent: bigint;
};

/** Cuánta plata quedó pegada a las reservas de este profesional. */
export async function plataPendienteDe(
  a: { operadorId: string; inquilinoId: string },
  db: PrismaClient = prisma,
): Promise<PlataPendiente> {
  const donde = { operadorId: a.operadorId, inquilinoId: a.inquilinoId };
  const [reservas, libres, sellados] = await Promise.all([
    db.ocupacion.count({ where: { ...donde, tipo: TipoOcupacion.reserva, importeCent: { not: null } } }),
    db.asiento.aggregate({
      where: { ...donde, concepto: "cargo_uso", liquidacionId: null },
      _count: true,
      _sum: { montoCent: true },
    }),
    db.asiento.aggregate({
      where: { ...donde, concepto: "cargo_uso", liquidacionId: { not: null } },
      _count: true,
      _sum: { montoCent: true },
    }),
  ]);

  return {
    reservas,
    cargos: libres._count,
    cargosCent: libres._sum.montoCent ?? 0n,
    cargosSellados: sellados._count,
    cargosSelladosCent: sellados._sum.montoCent ?? 0n,
  };
}

export const DespreciarInput = z.object({ inquilinoId: z.string().min(1) });

export type ResultadoDespreciar =
  | { ok: true; reservas: number; cargos: number; sellados: number }
  | { ok: false; error: "NO_ENCONTRADO" | "SI_FACTURA" };

async function despreciar(actor: Actor, input: z.infer<typeof DespreciarInput>, db: PrismaClient): Promise<ResultadoDespreciar> {
  // Pertenencia en el WHERE: el id vino de un formulario.
  const i = await db.inquilino.findFirst({
    where: { id: input.inquilinoId, operadorId: actor.operadorId },
    select: { id: true },
  });
  if (!i) return { ok: false, error: "NO_ENCONTRADO" };
  // La casilla es la autorización. Sin ella esto seria "borrarle la plata a un profesional",
  // que no es una operación que deba existir.
  if (await seLeFactura(db, actor.operadorId, i.id)) return { ok: false, error: "SI_FACTURA" };

  const donde = { operadorId: actor.operadorId, inquilinoId: i.id };

  return db.$transaction(async (tx) => {
    // Los sellados se cuentan ANTES de borrar, y no se tocan: ya salieron en un papel.
    const sellados = await tx.asiento.count({ where: { ...donde, concepto: "cargo_uso", liquidacionId: { not: null } } });

    const cargos = await tx.asiento.deleteMany({ where: { ...donde, concepto: "cargo_uso", liquidacionId: null } });

    // NULL y no cero: "esta hora no se cotiza" y "esta hora salió $0" son cosas distintas, y meses
    // después nadie va a poder distinguirlas si guardamos un 0.
    const reservas = await tx.ocupacion.updateMany({
      where: { ...donde, tipo: TipoOcupacion.reserva, importeCent: { not: null } },
      data: { tarifaId: null, precioHoraCent: null, importeCent: null },
    });

    return { ok: true as const, reservas: reservas.count, cargos: cargos.count, sellados };
  });
}

const CFG_DESPRECIAR = {
  permiso: "tarifa.administrar",
  schema: DespreciarInput,
  resumen: (i: z.infer<typeof DespreciarInput>) => `sacar precios y cargos de ${i.inquilinoId}`,
} as const;

export const despreciarInquilino = definirAccion(CFG_DESPRECIAR, (a, i) => despreciar(a, i, prisma));

/** Versión inyectable, para los tests. */
export const despreciarCon = (db: PrismaClient) => definirAccion({ ...CFG_DESPRECIAR, db }, (a, i) => despreciar(a, i, db));
