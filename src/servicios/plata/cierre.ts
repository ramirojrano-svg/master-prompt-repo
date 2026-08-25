// src/servicios/plata/cierre.ts — la pantalla de cerrar el mes.
//
// El motor del cierre ya existía (`liquidacion.ts`: numeración correlativa, reclamo de los cargos
// dentro de la transacción, congelado de los importes, anti doble-facturación por clave natural) y
// no tenía ninguna pantalla que lo usara. Esto es lo que faltaba entre "sé cuánto me deben" y
// "emití la cuenta del mes".
//
// Dos piezas:
//  · `pendientesDeCierre`: qué se cerraría, por profesional, ANTES de tocar nada.
//  · `cerrarMesDe` / `cerrarMesTodos`: las acciones, con su permiso declarado.
//
// Lo que NO hace: emitir una factura fiscal. Esto es la liquidación INTERNA del centro —el papel
// con el que se le cobra a cada profesional—. La factura de AFIP, si la hay, se carga aparte en
// los campos `facturaExterna*` de la fila.

import { z } from "zod";
import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { definirAccion } from "../../lib/accion.ts";
import type { Actor } from "../../lib/actor.ts";
import { esPeriodoValido } from "../../dominio/reporte.ts";
import { cerrarPeriodo, FACTURABLES, type ResultadoCierre } from "./liquidacion.ts";
import { idsQueNoFacturan } from "./facturable.ts";

/** Una fila de la pantalla: un profesional en un mes. */
export type FilaCierre = {
  inquilinoId: string;
  nombre: string;
  /** Quién abona, si no es él mismo. Es a nombre de quien sale la liquidación. */
  pagador: string | null;
  /** Cargos del mes que todavía no entraron en ninguna liquidación. */
  pendientes: number;
  pendienteCent: bigint;
  /** Si ya se cerró: el número que le tocó y el total congelado. */
  liquidacion: { id: string; numero: number; totalCent: bigint; estado: string; emitidaAt: Date | null } | null;
};

/**
 * Qué se cerraría este mes, profesional por profesional.
 *
 * Se listan los que tienen algo pendiente Y los ya cerrados: sin los segundos no habría forma de
 * ver el número que les tocó, ni de notar que a alguien se le cerró el mes dos veces por error —
 * que no puede pasar, pero verlo es parte de poder confiar en el número.
 */
export async function pendientesDeCierre(
  a: { operadorId: string; periodo: string },
  db: PrismaClient = prisma,
): Promise<FilaCierre[]> {
  if (!esPeriodoValido(a.periodo)) return [];

  const [porInquilino, liquidaciones, inquilinos, noFacturan] = await Promise.all([
    // Solo lo NO liquidado: es exactamente lo que el cierre va a reclamar. Si acá se contara todo,
    // el número de la pantalla no sería el que después va a salir.
    db.asiento.groupBy({
      by: ["inquilinoId"],
      where: { operadorId: a.operadorId, cuenta: "corriente", periodo: a.periodo, liquidacionId: null, concepto: { in: FACTURABLES } },
      _sum: { montoCent: true },
      _count: { _all: true },
    }),
    db.liquidacion.findMany({
      where: { operadorId: a.operadorId, periodo: a.periodo },
      select: { id: true, inquilinoId: true, numero: true, totalCent: true, estado: true, emitidaAt: true },
    }),
    db.inquilino.findMany({ where: { operadorId: a.operadorId }, select: { id: true, nombre: true, pagador: true } }),
    idsQueNoFacturan(db, a.operadorId),
  ]);

  const nombre = new Map(inquilinos.map((i) => [i.id, i]));
  const liqDe = new Map(liquidaciones.map((l) => [l.inquilinoId, l]));
  // Quien no factura queda AFUERA del cierre. Puede tener cargos asentados de antes de que se lo
  // marcara —o de un turno cargado por error—, pero emitirle una liquidación sería fabricar una
  // deuda que nadie va a reclamar. Los asientos siguen en el libro; lo que no pasa es que se
  // conviertan en un papel.
  const ids = new Set<string>(
    [...porInquilino.map((r) => r.inquilinoId), ...liqDe.keys()].filter((id) => !noFacturan.has(id)),
  );

  return [...ids]
    .map((id) => {
      const p = porInquilino.find((r) => r.inquilinoId === id);
      const l = liqDe.get(id);
      const i = nombre.get(id);
      return {
        inquilinoId: id,
        // Un id sin ficha no se esconde: si tiene plata del mes, tiene que verse.
        nombre: i?.nombre ?? "(profesional dado de baja del sistema)",
        pagador: i?.pagador ?? null,
        pendientes: p?._count._all ?? 0,
        pendienteCent: p?._sum.montoCent ?? 0n,
        liquidacion: l ? { id: l.id, numero: l.numero, totalCent: l.totalCent, estado: l.estado, emitidaAt: l.emitidaAt } : null,
      };
    })
    // Lo más grande primero: es el orden en que se trabaja.
    //
    // El peso de la fila es lo que ese profesional representa en el mes, ESTÉ o no cerrado. Antes
    // se ordenaba por lo pendiente a secas, y eso tenía un efecto molesto: al cerrar una fila su
    // pendiente pasaba a cero y la fila se iba al fondo de la tabla — justo en el momento en que
    // uno está mirando lo que acaba de cerrar, y con la lista entera moviéndose abajo del dedo.
    // Como el total de la liquidación es exactamente lo que se acaba de reclamar, mirar uno u otro
    // da el mismo número y la fila se queda donde estaba.
    .sort((x, y) => Number(pesoDeFila(y) - pesoDeFila(x)) || x.nombre.localeCompare(y.nombre, "es"));
}

/** Cuánto pesa la fila en el orden: lo cerrado vale lo mismo que valía cuando estaba pendiente. */
function pesoDeFila(f: FilaCierre): bigint {
  return f.liquidacion?.totalCent ?? f.pendienteCent;
}

/**
 * Liquidaciones emitidas a nombre de alguien que HOY no factura.
 *
 * Existe por una consecuencia incómoda de sacar del cierre a los que no facturan: si a alguien se
 * le emitió una liquidación y después se lo marcó como no facturable, ese documento —que tiene un
 * número correlativo— dejaba de aparecer en TODAS las pantallas. Un papel numerado que se
 * desvanece en silencio es peor que uno molesto: al mes siguiente el correlativo salta de N° 1 a
 * N° 3 y nadie sabe qué pasó con el del medio.
 *
 * Casi siempre es una ficha duplicada que se cerró por error. Se muestra para que se pueda
 * decidir qué hacer con ella, no para reclamarla.
 */
export async function liquidacionesDeNoFacturables(
  a: { operadorId: string; periodo: string },
  db: PrismaClient = prisma,
): Promise<{ id: string; numero: number; nombre: string; totalCent: bigint }[]> {
  if (!esPeriodoValido(a.periodo)) return [];

  const noFacturan = await idsQueNoFacturan(db, a.operadorId);
  if (noFacturan.size === 0) return [];

  const [liqs, fichas] = await Promise.all([
    db.liquidacion.findMany({
      where: { operadorId: a.operadorId, periodo: a.periodo, inquilinoId: { in: [...noFacturan] } },
      select: { id: true, numero: true, inquilinoId: true, totalCent: true },
    }),
    db.inquilino.findMany({ where: { operadorId: a.operadorId }, select: { id: true, nombre: true } }),
  ]);
  const nombreDe = new Map(fichas.map((f) => [f.id, f.nombre]));

  return liqs
    .map((l) => ({ id: l.id, numero: l.numero, nombre: nombreDe.get(l.inquilinoId) ?? "—", totalCent: l.totalCent }))
    .sort((x, y) => x.numero - y.numero);
}

export const CierreInput = z.object({
  periodo: z.string().regex(/^\d{4}-\d{2}$/),
  inquilinoId: z.string().min(1),
  /** Cuándo vence lo que se le cobra. Lo elige el centro; no hay un default universal. */
  venceEl: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const CierreTodosInput = CierreInput.omit({ inquilinoId: true });

export type ResultadoLote = { ok: true; cerradas: number; sinNada: number; totalCent: bigint };

/**
 * El nombre con el que sale la liquidación. Si alguien más abona por el profesional, sale a nombre
 * de ese: es quien la recibe y quien la paga.
 *
 * Se ESTAMPA en la fila y no se lee después de la ficha (§8.8): cambiarle el nombre a alguien no
 * puede reescribir un papel que ya se emitió.
 */
function receptorDe(i: { nombre: string; pagador: string | null }): string {
  return i.pagador?.trim() || i.nombre;
}

async function cerrarUno(actor: Actor, input: z.infer<typeof CierreInput>, db: PrismaClient): Promise<ResultadoCierre> {
  // Pertenencia explícita: el id vino de un formulario. findFirst({id, operadorId}), nunca por id solo.
  const inq = await db.inquilino.findFirst({
    where: { id: input.inquilinoId, operadorId: actor.operadorId },
    select: { nombre: true, pagador: true },
  });
  if (!inq) return { ok: false, error: "NADA_QUE_LIQUIDAR" };

  return cerrarPeriodo(
    {
      operadorId: actor.operadorId,
      inquilinoId: input.inquilinoId,
      periodo: input.periodo,
      // Sin IVA discriminado: esta es la liquidación INTERNA del centro. La factura fiscal, si la
      // hay, se carga aparte. Poner una alícuota acá inventaría un impuesto que nadie declaró.
      alicuotaDecimas: 0,
      venceEl: new Date(`${input.venceEl}T12:00:00.000Z`),
      receptorRazonSocial: receptorDe(inq),
      receptorCondIva: "no informada",
    },
    db,
  );
}

/**
 * Cierra el mes de TODOS los que tengan algo pendiente.
 *
 * Uno por uno y no todo en una transacción: son transacciones independientes —cada liquidación es
 * un documento con su número— y meterlas juntas significaría que un problema con el último borra
 * los veintiocho anteriores. Si se corta a la mitad, lo cerrado queda cerrado y volver a apretar
 * termina el resto: el cierre es idempotente por (centro, profesional, mes).
 */
async function cerrarTodos(actor: Actor, input: z.infer<typeof CierreTodosInput>, db: PrismaClient): Promise<ResultadoLote> {
  const filas = await pendientesDeCierre({ operadorId: actor.operadorId, periodo: input.periodo }, db);
  let cerradas = 0;
  let sinNada = 0;
  let totalCent = 0n;

  for (const f of filas) {
    if (f.pendientes === 0) continue;
    const r = await cerrarUno(actor, { ...input, inquilinoId: f.inquilinoId }, db);
    if (r.ok) {
      cerradas++;
      totalCent += r.totalCent;
    } else {
      sinNada++;
    }
  }
  return { ok: true, cerradas, sinNada, totalCent };
}

// Una sola configuración para la acción de producción y la inyectable: si fueran dos literales,
// el resumen de auditoría se agregaría en una y se olvidaría en la otra.
const CFG_CIERRE_UNO = {
  permiso: "periodo.cerrar",
  schema: CierreInput,
  resumen: (i: z.infer<typeof CierreInput>) => `cierre de ${i.periodo} para ${i.inquilinoId}`,
} as const;

const CFG_CIERRE_TODOS = {
  permiso: "periodo.cerrar",
  schema: CierreTodosInput,
  resumen: (i: z.infer<typeof CierreTodosInput>) => `cierre de ${i.periodo} para todos`,
} as const;

export const cerrarMesDe = definirAccion(CFG_CIERRE_UNO, (a, i) => cerrarUno(a, i, prisma));
export const cerrarMesTodos = definirAccion(CFG_CIERRE_TODOS, (a, i) => cerrarTodos(a, i, prisma));

/** Versiones inyectables, para los tests. */
export const cierreCon = (db: PrismaClient) => ({
  uno: definirAccion({ ...CFG_CIERRE_UNO, db }, (a, i) => cerrarUno(a, i, db)),
  todos: definirAccion({ ...CFG_CIERRE_TODOS, db }, (a, i) => cerrarTodos(a, i, db)),
});
