// src/servicios/plata/cobros.ts — registrar que ALGUIEN PAGÓ (§5.7.1).
//
// Hasta acá la app sabía cobrar y no sabía que le habían pagado: posteaba `cargo_uso` por cada
// turno y `cargo_membresia` por cada abono, y no había ninguna forma de asentar la transferencia
// que entró. El saldo de cada profesional solo podía crecer, y "facturado" terminaba leyéndose
// como "lo que me deben", que es una cuenta que no cierra nunca.
//
// Dos decisiones que valen la aclaración:
//
//  · IDEMPOTENCIA POR COMPROBANTE. La clave del asiento es `pago:<medio>:<referencia>`. Cargar dos
//    veces el mismo número de operación es el MISMO cobro, no dos — y cargarlo dos veces es lo que
//    pasa cuando uno concilia el resumen del banco a mitad de mes y otra vez al cerrarlo. Sin
//    referencia se cae a un uuid, porque ahí no hay forma de distinguir dos pagos iguales de uno
//    cargado dos veces, y ante la duda es mejor duplicar (se anula) que perder un cobro.
//
//  · UN COBRO NO SE EDITA. El libro es append-only: se anula con un contraasiento que apunta al
//    original por `revierteAId`. Así el resumen del mes que ya se mostró sigue explicándose, y
//    queda registro de que hubo un error y de quién lo corrigió.

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { definirAccion } from "../../lib/accion.ts";
import { asentarIdempotente } from "./ledger.ts";
import { aCentavos } from "../config/tarifas.ts";
import { fechaEnZona } from "../../dominio/motor/zona.ts";

/** Los medios que usa el centro. Cerrado a propósito: un texto libre termina con "transferencia",
 *  "Transf" y "transf." conviviendo, y después no se puede filtrar ni conciliar por medio. */
export const MEDIOS = ["transferencia", "mercado_pago"] as const;
export const ETIQUETA_MEDIO: Record<(typeof MEDIOS)[number], string> = {
  transferencia: "Transferencia",
  mercado_pago: "Mercado Pago",
};

export const CobroInput = z.object({
  inquilinoId: z.string().min(1),
  /** En PESOS, como lo escribe el operador. */
  monto: z.coerce.number().positive().max(100_000_000),
  medio: z.enum(MEDIOS),
  /** Nº de operación del comprobante. Opcional, pero es lo que evita cargar dos veces lo mismo. */
  referencia: z.string().trim().max(80).optional(),
  /** 'YYYY-MM-DD' — el día que entró la plata, que no siempre es hoy. */
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha inválida").optional(),
});

export type ResultadoCobro =
  | { ok: true; duplicado: boolean }
  | { ok: false; error: "INQUILINO_INEXISTENTE" | "SIN_SEDE" };

async function registrar(
  actor: { operadorId: string; usuarioId: string },
  input: z.infer<typeof CobroInput>,
  db: PrismaClient = prisma,
): Promise<ResultadoCobro> {
  const inq = await db.inquilino.findFirst({
    where: { id: input.inquilinoId, operadorId: actor.operadorId },
    select: { id: true },
  });
  if (!inq) return { ok: false, error: "INQUILINO_INEXISTENTE" };

  const [operador, sede] = await Promise.all([
    db.operador.findUniqueOrThrow({ where: { id: actor.operadorId }, select: { moneda: true } }),
    db.sede.findFirst({ where: { operadorId: actor.operadorId, activa: true }, select: { zonaHoraria: true } }),
  ]);
  if (!sede) return { ok: false, error: "SIN_SEDE" };

  // El período sale de la fecha DEL PAGO en la zona del centro, no de hoy: un cobro de fin de mes
  // asentado el 2 del siguiente pertenece al mes en que entró la plata (§5.1). El mediodía UTC
  // evita que el corrimiento de zona mueva el día.
  const dia = input.fecha ?? fechaEnZona(new Date(), sede.zonaHoraria);
  const fechaHecho = new Date(`${dia}T12:00:00.000Z`);
  const periodo = dia.slice(0, 7);

  const ref = input.referencia && input.referencia.length > 0 ? input.referencia : null;
  const r = await asentarIdempotente(db, {
    operadorId: actor.operadorId,
    inquilinoId: inq.id,
    concepto: "pago",
    montoCent: -aCentavos(input.monto), // a favor del inquilino: resta de lo que debe
    moneda: operador.moneda,
    periodo,
    fechaHecho,
    clave: ref ? `pago:${input.medio}:${ref}` : `pago:manual:${randomUUID()}`,
    medio: input.medio,
    referencia: ref ?? undefined,
    creadoPorUserId: actor.usuarioId,
  });

  // `creado: false` es la clave repetida: ese comprobante ya estaba cargado. No es un error —es
  // justamente la protección haciendo su trabajo— pero la pantalla tiene que decirlo, o el
  // operador ve "listo" y se queda pensando que entró un segundo pago que nunca se asentó.
  return { ok: true, duplicado: !r.creado };
}

const CFG_COBRO = {
  permiso: "cobro.registrar",
  schema: CobroInput,
  resumen: (i: z.infer<typeof CobroInput>) => `cobro de ${i.monto} a ${i.inquilinoId} por ${i.medio}`,
} as const;

export const registrarCobro = definirAccion(CFG_COBRO, (a, i) => registrar(a, i));

export const AnularInput = z.object({
  asientoId: z.string().min(1),
  motivo: z.string().trim().min(3).max(200),
});

export type ResultadoAnular =
  | { ok: true }
  | { ok: false; error: "COBRO_INEXISTENTE" | "MES_CERRADO" | "YA_ANULADO" };

async function anular(
  actor: { operadorId: string; usuarioId: string },
  input: z.infer<typeof AnularInput>,
  db: PrismaClient = prisma,
): Promise<ResultadoAnular> {
  const orig = await db.asiento.findFirst({
    where: { id: input.asientoId, operadorId: actor.operadorId, concepto: "pago" },
    select: { id: true, inquilinoId: true, montoCent: true, moneda: true, periodo: true, fechaHecho: true, liquidacionId: true },
  });
  if (!orig) return { ok: false, error: "COBRO_INEXISTENTE" };
  // Un cobro ya sellado en una liquidación pertenece a un mes cerrado: tocarlo movería un total
  // que ya se emitió.
  if (orig.liquidacionId) return { ok: false, error: "MES_CERRADO" };

  const yaAnulado = await db.asiento.findFirst({ where: { revierteAId: orig.id }, select: { id: true } });
  if (yaAnulado) return { ok: false, error: "YA_ANULADO" };

  const r = await asentarIdempotente(db, {
    operadorId: actor.operadorId,
    inquilinoId: orig.inquilinoId,
    // El contraasiento de un pago es un débito: vuelve a poner la deuda que el pago había bajado.
    concepto: "ajuste_debito",
    montoCent: -orig.montoCent, // el pago es negativo ⇒ esto es positivo
    moneda: orig.moneda,
    // Mismo período y misma fecha que el original: anular en septiembre un cobro de agosto no
    // puede mover plata a septiembre, o los dos meses quedan mal.
    periodo: orig.periodo,
    fechaHecho: orig.fechaHecho,
    clave: `anula:${orig.id}`,
    motivo: input.motivo,
    revierteAId: orig.id,
    creadoPorUserId: actor.usuarioId,
  });
  return r.creado ? { ok: true } : { ok: false, error: "YA_ANULADO" };
}

// Anular un cobro es de las cosas que más se discuten después: queda registrado cuál.
const CFG_ANULAR = {
  permiso: "cobro.registrar",
  schema: AnularInput,
  resumen: (i: z.infer<typeof AnularInput>) => `anulación del cobro ${i.asientoId}`,
} as const;

export const anularCobro = definirAccion(CFG_ANULAR, (a, i) => anular(a, i));

/** Versiones inyectables, para los tests: sin esto las acciones escriben por el cliente global. */
export const cobrosCon = (db: PrismaClient) => ({
  registrar: definirAccion({ ...CFG_COBRO, db }, (a, i) => registrar(a, i, db)),
  anular: definirAccion({ ...CFG_ANULAR, db }, (a, i) => anular(a, i, db)),
});

export type CobroListado = {
  id: string;
  fecha: Date;
  montoCent: bigint;
  medio: string | null;
  referencia: string | null;
  anulado: boolean;
};

/** Los cobros de un profesional en un mes, con cuáles quedaron anulados. Para la pantalla. */
export async function cobrosDelMes(
  a: { operadorId: string; inquilinoId: string; periodo: string },
  db: PrismaClient = prisma,
): Promise<CobroListado[]> {
  const filas = await db.asiento.findMany({
    where: { operadorId: a.operadorId, inquilinoId: a.inquilinoId, periodo: a.periodo, concepto: "pago" },
    select: { id: true, fechaHecho: true, montoCent: true, medio: true, referencia: true },
    orderBy: { fechaHecho: "desc" },
  });
  if (filas.length === 0) return [];

  // Una sola consulta para saber cuáles fueron anulados, en vez de una por fila.
  const reversas = await db.asiento.findMany({
    where: { operadorId: a.operadorId, revierteAId: { in: filas.map((f) => f.id) } },
    select: { revierteAId: true },
  });
  const anulados = new Set(reversas.map((r) => r.revierteAId));

  return filas.map((f) => ({
    id: f.id,
    fecha: f.fechaHecho,
    // Se muestra en positivo: en el libro un pago es negativo, pero en pantalla "pagó $50.000"
    // con signo menos se lee como si le hubieran sacado la plata.
    montoCent: f.montoCent < 0n ? -f.montoCent : f.montoCent,
    medio: f.medio,
    referencia: f.referencia,
    anulado: anulados.has(f.id),
  }));
}
