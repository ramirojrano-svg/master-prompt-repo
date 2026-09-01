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
import { cargosAnulados, cerrarPeriodo, FACTURABLES, type ResultadoCierre } from "./liquidacion.ts";
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

  // Los cargos ya dados vuelta por una cancelación se excluyen ACÁ TAMBIÉN, con el mismo criterio
  // que usa el cierre. Es la propiedad que hace confiable a esta pantalla: lo que anuncia tiene
  // que ser exactamente lo que después se emite. Si uno de los dos contara distinto, el operador
  // aprobaría un número y el profesional recibiría otro.
  const anulados = await cargosAnulados(db, { operadorId: a.operadorId, periodo: a.periodo });

  const [porInquilino, liquidaciones, inquilinos, noFacturan] = await Promise.all([
    // Solo lo NO liquidado: es exactamente lo que el cierre va a reclamar. Si acá se contara todo,
    // el número de la pantalla no sería el que después va a salir.
    db.asiento.groupBy({
      by: ["inquilinoId"],
      where: {
        operadorId: a.operadorId, cuenta: "corriente", periodo: a.periodo,
        liquidacionId: null, concepto: { in: FACTURABLES },
        ...(anulados.length ? { id: { notIn: anulados } } : {}),
      },
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

export const ReabrirInput = z.object({
  periodo: z.string().regex(/^\d{4}-\d{2}$/),
});

export type ResultadoReabrir =
  | { ok: true; liquidaciones: number; cargos: number; totalCent: bigint }
  | { ok: false; error: "NADA_QUE_REABRIR" | "YA_AVISADAS" | "CON_PAGOS" };

/**
 * Deshacer el cierre de un mes.
 *
 * Existe porque cerrar es de un click y equivocarse de mes también: pasó de verdad —se cerró
 * septiembre entero, veintiocho liquidaciones, antes de que septiembre existiera— y la única
 * salida fue escribir SQL a mano contra la base de producción. Eso no puede ser el procedimiento:
 * un error de tipeo ahí borra plata, y depende de que haya alguien disponible para escribirlo.
 *
 * NO borra plata. Los cargos siguen enteros en el libro; lo único que se deshace es el sello que
 * los mete adentro de un papel numerado. Después de esto el mes vuelve a estar "sin cerrar" y se
 * puede cerrar de nuevo cuando corresponda.
 *
 * Se niega en dos casos, y los dos son el mismo principio: no deshacer algo que ya salió del
 * centro.
 *
 *  · YA_AVISADAS — alguna liquidación ya se le mandó por mail. El profesional tiene el documento
 *    en su casilla; borrarlo acá lo dejaría con un papel que no existe.
 *  · CON_PAGOS — ya entró plata de ese mes. Hay que anular el cobro primero, que es una decisión
 *    aparte y con su propio registro.
 *
 * Ojo con el segundo, que es menos obvio de lo que parece: un pago NO queda pegado a la
 * liquidación —`FACTURABLES` no incluye `pago`, así que el cierre nunca lo sella—, y por eso mirar
 * los asientos que cuelgan del papel daría cero siempre. Se cuentan los pagos DEL PERÍODO, que es
 * lo que de verdad dice si alguien ya abonó.
 */
async function reabrirMesDe(
  actor: Actor,
  input: z.infer<typeof ReabrirInput>,
  db: PrismaClient,
): Promise<ResultadoReabrir> {
  return db.$transaction(async (tx) => {
    const liqs = await tx.liquidacion.findMany({
      where: { operadorId: actor.operadorId, periodo: input.periodo },
      select: { id: true, avisadaEl: true, totalCent: true },
    });
    if (liqs.length === 0) return { ok: false as const, error: "NADA_QUE_REABRIR" as const };
    if (liqs.some((l) => l.avisadaEl !== null)) return { ok: false as const, error: "YA_AVISADAS" as const };

    const pagos = await tx.asiento.count({
      where: { operadorId: actor.operadorId, periodo: input.periodo, concepto: "pago" },
    });
    if (pagos > 0) return { ok: false as const, error: "CON_PAGOS" as const };

    // 1) Soltar los cargos: vuelven a estar pendientes de cerrar.
    const { count: cargos } = await tx.asiento.updateMany({
      where: { operadorId: actor.operadorId, liquidacionId: { in: liqs.map((l) => l.id) } },
      data: { liquidacionId: null },
    });
    // 2) Recién ahora los papeles. En este orden: si quedara un asiento apuntando a una
    //    liquidación borrada, ese cargo no lo levantaría ningún cierre posterior y sería plata
    //    invisible.
    await tx.liquidacion.deleteMany({ where: { operadorId: actor.operadorId, periodo: input.periodo } });

    return {
      ok: true as const,
      liquidaciones: liqs.length,
      cargos,
      totalCent: liqs.reduce((acc, l) => acc + l.totalCent, 0n),
    };
  });
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

export const ReabrirUnaInput = z.object({ liquidacionId: z.string().min(1) });

export type ResultadoReabrirUna =
  | { ok: true; nombre: string; cargos: number; totalCent: bigint }
  | { ok: false; error: "NO_ENCONTRADA" | "YA_AVISADA" | "CON_PAGOS" };

/**
 * Deshacer el cierre de UN profesional, no del mes entero.
 *
 * Cerrar de a uno es lo normal —se va bajando por la lista y se aprieta "Cerrar" en cada uno—, y
 * equivocarse de fila en una lista de treinta y seis es cuestión de tiempo. Sin esto, el único
 * arreglo era deshacer el mes COMPLETO y volver a cerrar a los otros treinta y cinco.
 *
 * Los frenos son los mismos que los del mes, con el alcance de una sola persona: no se deshace lo
 * que ya salió del centro. Si su liquidación ya se le mandó por mail, tiene el papel en su casilla;
 * si ya pagó, hay plata aplicada contra ese documento.
 */
async function reabrirUna(
  actor: Actor,
  input: z.infer<typeof ReabrirUnaInput>,
  db: PrismaClient,
): Promise<ResultadoReabrirUna> {
  return db.$transaction(async (tx) => {
    const liq = await tx.liquidacion.findFirst({
      where: { id: input.liquidacionId, operadorId: actor.operadorId },
      select: { id: true, inquilinoId: true, periodo: true, avisadaEl: true, totalCent: true },
    });
    if (!liq) return { ok: false as const, error: "NO_ENCONTRADA" as const };
    if (liq.avisadaEl !== null) return { ok: false as const, error: "YA_AVISADA" as const };

    // Los pagos de ESE profesional en ESE mes. Un pago no queda pegado a la liquidación —el cierre
    // no lo sella—, así que mirar los asientos que cuelgan del papel daría cero siempre.
    const pagos = await tx.asiento.count({
      where: { operadorId: actor.operadorId, inquilinoId: liq.inquilinoId, periodo: liq.periodo, concepto: "pago" },
    });
    if (pagos > 0) return { ok: false as const, error: "CON_PAGOS" as const };

    const { count: cargos } = await tx.asiento.updateMany({
      where: { operadorId: actor.operadorId, liquidacionId: liq.id },
      data: { liquidacionId: null },
    });
    await tx.liquidacion.delete({ where: { id: liq.id } });

    const ficha = await tx.inquilino.findFirst({ where: { id: liq.inquilinoId }, select: { nombre: true } });
    return { ok: true as const, nombre: ficha?.nombre ?? "ese profesional", cargos, totalCent: liq.totalCent };
  });
}

const CFG_REABRIR_UNA = {
  permiso: "periodo.cerrar",
  schema: ReabrirUnaInput,
  resumen: (i: z.infer<typeof ReabrirUnaInput>) => `reabrir la liquidación ${i.liquidacionId}`,
} as const;

const CFG_REABRIR = {
  // Mismo permiso que cerrar, que hoy es solo del administrador: deshacer un cierre es tanto o
  // más delicado que hacerlo, así que no puede pedir menos.
  permiso: "periodo.cerrar",
  schema: ReabrirInput,
  resumen: (i: z.infer<typeof ReabrirInput>) => `reabrir ${i.periodo}`,
} as const;

export const cerrarMesDe = definirAccion(CFG_CIERRE_UNO, (a, i) => cerrarUno(a, i, prisma));
export const cerrarMesTodos = definirAccion(CFG_CIERRE_TODOS, (a, i) => cerrarTodos(a, i, prisma));
export const reabrirMes = definirAccion(CFG_REABRIR, (a, i) => reabrirMesDe(a, i, prisma));
export const reabrirLiquidacion = definirAccion(CFG_REABRIR_UNA, (a, i) => reabrirUna(a, i, prisma));

/** Versiones inyectables, para los tests. */
export const cierreCon = (db: PrismaClient) => ({
  uno: definirAccion({ ...CFG_CIERRE_UNO, db }, (a, i) => cerrarUno(a, i, db)),
  todos: definirAccion({ ...CFG_CIERRE_TODOS, db }, (a, i) => cerrarTodos(a, i, db)),
  reabrir: definirAccion({ ...CFG_REABRIR, db }, (a, i) => reabrirMesDe(a, i, db)),
  reabrirUna: definirAccion({ ...CFG_REABRIR_UNA, db }, (a, i) => reabrirUna(a, i, db)),
});
