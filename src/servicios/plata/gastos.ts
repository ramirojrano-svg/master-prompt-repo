// src/servicios/plata/gastos.ts — lo que cuesta tener el espacio abierto (§5.9).
//
// Por qué es un libro APARTE del de asientos: el libro de asientos es la cuenta corriente contra
// cada profesional — todo lo que entra ahí suma o resta de lo que alguien debe. La factura de luz
// no la debe nadie. Meterla ahí ensuciaría los saldos, que es exactamente lo que se cuidó al no
// mover la deuda de Gastón a la cuenta de quien le paga. Son dos preguntas distintas y por eso son
// dos libros: "quién me debe" y "cuánto me cuesta esto".
//
// Un gasto no se borra: se anula con motivo. Un mes que ya se miró tiene que seguir dando lo
// mismo, y un renglón que desaparece sin dejar rastro es la forma más rápida de que dos personas
// vean dos números distintos y ninguna pueda explicar por qué.

import { z } from "zod";
import { type PrismaClient, type RubroGasto } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { definirAccion } from "../../lib/accion.ts";
import { aCentavos } from "../config/tarifas.ts";
import { esPeriodoValido } from "../../dominio/reporte.ts";

export const RUBROS = [
  "alquiler",
  "expensas",
  "servicios",
  "limpieza",
  "mantenimiento",
  "insumos",
  "sueldos",
  "impuestos",
  "seguros",
  "marketing",
  "otros",
] as const satisfies readonly RubroGasto[];

/** Cómo se llama cada rubro en pantalla, y qué entra en él. La aclaración evita que la misma
 *  factura caiga un mes en "servicios" y al siguiente en "mantenimiento". */
export const ETIQUETA_RUBRO: Record<RubroGasto, string> = {
  alquiler: "Alquiler",
  expensas: "Expensas",
  servicios: "Servicios (luz, gas, agua, internet)",
  limpieza: "Limpieza",
  mantenimiento: "Mantenimiento y arreglos",
  insumos: "Insumos",
  sueldos: "Sueldos",
  impuestos: "Impuestos y tasas",
  seguros: "Seguros",
  marketing: "Marketing",
  otros: "Otros",
};

export const GastoInput = z.object({
  rubro: z.enum(RUBROS),
  detalle: z.string().trim().min(2).max(200),
  /** En PESOS, como lo escribe el operador. */
  monto: z.coerce.number().positive().max(1_000_000_000),
  /** 'YYYY-MM-DD' — el día del gasto, que manda sobre el mes al que pertenece. */
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha inválida"),
  proveedor: z.string().trim().max(120).optional(),
});

export type ResultadoGasto = { ok: true; id: string };

async function cargar(
  actor: { operadorId: string; usuarioId: string },
  input: z.infer<typeof GastoInput>,
  db: PrismaClient = prisma,
): Promise<ResultadoGasto> {
  const operador = await db.operador.findUniqueOrThrow({
    where: { id: actor.operadorId },
    select: { moneda: true },
  });

  // El período sale de la fecha DEL GASTO, igual que en los cobros: una factura del 30 de agosto
  // cargada el 3 de septiembre es un costo de agosto. Si no, el mes cerrado cambia solo.
  const g = await db.gasto.create({
    data: {
      operadorId: actor.operadorId,
      rubro: input.rubro,
      detalle: input.detalle,
      montoCent: aCentavos(input.monto),
      moneda: operador.moneda,
      periodo: input.fecha.slice(0, 7),
      fecha: new Date(`${input.fecha}T12:00:00.000Z`),
      proveedor: input.proveedor && input.proveedor.length > 0 ? input.proveedor : null,
      creadoPorUserId: actor.usuarioId,
    },
    select: { id: true },
  });
  return { ok: true, id: g.id };
}

export const cargarGasto = definirAccion({ permiso: "finanzas.ver.agregada", schema: GastoInput }, (a, i) => cargar(a, i));

export const AnularGastoInput = z.object({
  gastoId: z.string().min(1),
  motivo: z.string().trim().min(3).max(200),
});

export type ResultadoAnularGasto = { ok: true } | { ok: false; error: "GASTO_INEXISTENTE" | "YA_ANULADO" };

async function anular(
  actor: { operadorId: string; usuarioId: string },
  input: z.infer<typeof AnularGastoInput>,
  db: PrismaClient = prisma,
): Promise<ResultadoAnularGasto> {
  const g = await db.gasto.findFirst({
    where: { id: input.gastoId, operadorId: actor.operadorId },
    select: { id: true, anuladoEl: true },
  });
  if (!g) return { ok: false, error: "GASTO_INEXISTENTE" };
  if (g.anuladoEl) return { ok: false, error: "YA_ANULADO" };

  // updateMany con la condición de que siga vigente: si dos personas anulan a la vez, la segunda
  // toca 0 filas en vez de pisar el motivo y el autor de la primera.
  const r = await db.gasto.updateMany({
    where: { id: g.id, operadorId: actor.operadorId, anuladoEl: null },
    data: { anuladoEl: new Date(), anuladoPor: actor.usuarioId, motivoAnulado: input.motivo },
  });
  return r.count === 1 ? { ok: true } : { ok: false, error: "YA_ANULADO" };
}

export const anularGasto = definirAccion({ permiso: "finanzas.ver.agregada", schema: AnularGastoInput }, (a, i) => anular(a, i));

/** Versiones inyectables, para los tests. */
export const gastosCon = (db: PrismaClient) => ({
  cargar: definirAccion({ permiso: "finanzas.ver.agregada", schema: GastoInput, db }, (a, i) => cargar(a, i, db)),
  anular: definirAccion({ permiso: "finanzas.ver.agregada", schema: AnularGastoInput, db }, (a, i) => anular(a, i, db)),
});

export type GastoDelMes = {
  id: string;
  rubro: RubroGasto;
  detalle: string;
  proveedor: string | null;
  montoCent: bigint;
  fecha: Date;
  anulado: boolean;
  motivoAnulado: string | null;
};

export type ResumenGastos = {
  gastos: GastoDelMes[];
  /** Por rubro, de mayor a menor y SIN los anulados: es el corte con el que se decide dónde tocar. */
  porRubro: { rubro: RubroGasto; montoCent: bigint }[];
  totalCent: bigint;
};

/** Los gastos de un mes, discriminados por rubro. */
export async function gastosDelMes(
  a: { operadorId: string; periodo: string },
  db: PrismaClient = prisma,
): Promise<ResumenGastos> {
  if (!esPeriodoValido(a.periodo)) return { gastos: [], porRubro: [], totalCent: 0n };

  const filas = await db.gasto.findMany({
    where: { operadorId: a.operadorId, periodo: a.periodo },
    select: { id: true, rubro: true, detalle: true, proveedor: true, montoCent: true, fecha: true, anuladoEl: true, motivoAnulado: true },
    orderBy: [{ fecha: "desc" }, { createdAt: "desc" }],
  });

  const gastos = filas.map((g) => ({
    id: g.id,
    rubro: g.rubro,
    detalle: g.detalle,
    proveedor: g.proveedor,
    montoCent: g.montoCent,
    fecha: g.fecha,
    anulado: g.anuladoEl !== null,
    motivoAnulado: g.motivoAnulado,
  }));

  // Los anulados se listan (tachados) pero NO suman: siguen visibles para poder explicar qué pasó,
  // y fuera del total para que el número sea el que se puede defender.
  const vivos = gastos.filter((g) => !g.anulado);
  const porRubro = [...vivos.reduce((m, g) => m.set(g.rubro, (m.get(g.rubro) ?? 0n) + g.montoCent), new Map<RubroGasto, bigint>())]
    .map(([rubro, montoCent]) => ({ rubro, montoCent }))
    .sort((x, y) => (y.montoCent > x.montoCent ? 1 : y.montoCent < x.montoCent ? -1 : 0));

  return { gastos, porRubro, totalCent: vivos.reduce((acc, g) => acc + g.montoCent, 0n) };
}

/** Solo el total vigente de un mes. Lo usa la pantalla de rentabilidad, que no necesita el detalle. */
export async function totalGastos(
  a: { operadorId: string; periodo: string },
  db: PrismaClient = prisma,
): Promise<bigint> {
  const r = await db.gasto.aggregate({
    where: { operadorId: a.operadorId, periodo: a.periodo, anuladoEl: null },
    _sum: { montoCent: true },
  });
  return r._sum.montoCent ?? 0n;
}
