// src/servicios/reportes/rentabilidad.ts — el negocio, no la facturación (§5.9).
//
// Métricas contesta "cuánto facturé y quién me debe". Esto contesta la que viene después: "¿me
// queda algo?". Son distintas, y confundirlas es el error clásico de un centro que alquila: mirar
// la facturación creciendo mientras el resultado baja porque los costos crecieron más rápido.
//
// SE INFORMAN DOS RESULTADOS, a propósito:
//
//   · DEVENGADO  = facturado − gastos. El mes como negocio: la plata que el mes generó, la haya
//     cobrado o no. Es el número que dice si el modelo cierra.
//   · CAJA       = cobrado − gastos. La plata que realmente pasó por la cuenta. Es el número que
//     dice si se puede pagar la luz este mes.
//
// Un centro con buen devengado y mala caja no tiene un problema de precios: tiene un problema de
// cobranza, y son dos acciones completamente distintas. Mostrar un solo número obliga a elegir
// cuál de los dos problemas se puede ver, y el que queda afuera se descubre tarde.

import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { type Actor } from "../../lib/actor.ts";
import { puede } from "../../lib/permisos.ts";
import { esPeriodoValido, periodoAnterior } from "../../dominio/reporte.ts";
import { JOIN_REVERTIDO, SUMA_COBRADO, SUMA_FACTURADO } from "./movimientos.ts";

export type MesDelNegocio = {
  periodo: string;
  facturadoCent: bigint;
  cobradoCent: bigint;
  gastosCent: bigint;
  /** facturado − gastos. */
  resultadoCent: bigint;
};

export type Rentabilidad = {
  periodo: string;
  moneda: string;
  facturadoCent: bigint;
  cobradoCent: bigint;
  gastosCent: bigint;
  resultadoDevengadoCent: bigint;
  resultadoCajaCent: bigint;
  /** Sobre lo facturado, en décimas de punto (así 12.3% viaja como 123 y no se pierde en enteros). */
  margenDevengadoDecimas: number;
  margenCajaDecimas: number;
  /** Cuánto de lo facturado se cobró, en décimas de punto. La efectividad de cobranza. */
  cobranzaDecimas: number;
  /** Los últimos meses, del más viejo al más nuevo, para ver la tendencia. */
  historia: MesDelNegocio[];
};

const CUANTOS_MESES = 6;

/** x sobre base, en décimas de punto porcentual. Base 0 ⇒ 0: sin base no hay porcentaje. */
function decimas(x: bigint, base: bigint): number {
  if (base <= 0n) return 0;
  return Number((x * 1000n) / base);
}

/**
 * El negocio del mes, con la tendencia de los últimos seis.
 *
 * Devuelve null si el actor no puede ver los números del centro: es información del dueño, no de
 * quien alquila una hora.
 */
export async function rentabilidad(
  a: { actor: Actor; periodo: string },
  db: PrismaClient = prisma,
): Promise<Rentabilidad | null> {
  if (!puede(a.actor.rol, "finanzas.ver.agregada")) return null;
  if (!esPeriodoValido(a.periodo)) return null;

  const op = a.actor.operadorId;

  // Los seis períodos del corte, del más viejo al más nuevo.
  const periodos: string[] = [];
  for (let p = a.periodo, i = 0; i < CUANTOS_MESES; i++, p = periodoAnterior(p)) periodos.unshift(p);

  const [operador, movimientos, gastos] = await Promise.all([
    db.operador.findUniqueOrThrow({ where: { id: op }, select: { moneda: true } }),
    // Lo facturado y lo cobrado por período, en una sola consulta para los seis meses.
    //
    // La partición se clasifica por CONCEPTO, no por signo, y está definida una sola vez en
    // `movimientos.ts` porque estas dos columnas también las muestran el reporte mensual, Cobranza
    // y la ficha del profesional. El día que estuvieron escritas cuatro veces, se arregló una y
    // las otras tres siguieron mintiendo. Ahí está el porqué del criterio.
    db.$queryRaw<{ periodo: string; facturado: bigint; cobrado: bigint }[]>`
      SELECT a."periodo",
             ${SUMA_FACTURADO} AS facturado,
             ${SUMA_COBRADO} AS cobrado
      FROM "Asiento" a
      ${JOIN_REVERTIDO}
      WHERE a."operadorId" = ${op} AND a."cuenta" = 'corriente' AND a."periodo" = ANY(${periodos})
      GROUP BY a."periodo"`,
    // Los anulados quedan afuera: el total tiene que ser el que se puede defender.
    db.$queryRaw<{ periodo: string; total: bigint }[]>`
      SELECT "periodo", COALESCE(SUM("montoCent"), 0)::bigint AS total
      FROM "Gasto"
      WHERE "operadorId" = ${op} AND "anuladoEl" IS NULL AND "periodo" = ANY(${periodos})
      GROUP BY "periodo"`,
  ]);

  const porMov = new Map(movimientos.map((m) => [m.periodo, m]));
  const porGasto = new Map(gastos.map((g) => [g.periodo, g.total]));

  const historia: MesDelNegocio[] = periodos.map((p) => {
    const m = porMov.get(p);
    const facturadoCent = m?.facturado ?? 0n;
    const cobradoCent = m?.cobrado ?? 0n;
    const gastosCent = porGasto.get(p) ?? 0n;
    return { periodo: p, facturadoCent, cobradoCent, gastosCent, resultadoCent: facturadoCent - gastosCent };
  });

  // El mes pedido es el último del corte, por construcción.
  const actual = historia[historia.length - 1]!;
  const resultadoDevengadoCent = actual.facturadoCent - actual.gastosCent;
  const resultadoCajaCent = actual.cobradoCent - actual.gastosCent;

  return {
    periodo: a.periodo,
    moneda: operador.moneda,
    facturadoCent: actual.facturadoCent,
    cobradoCent: actual.cobradoCent,
    gastosCent: actual.gastosCent,
    resultadoDevengadoCent,
    resultadoCajaCent,
    margenDevengadoDecimas: decimas(resultadoDevengadoCent, actual.facturadoCent),
    margenCajaDecimas: decimas(resultadoCajaCent, actual.facturadoCent),
    cobranzaDecimas: decimas(actual.cobradoCent, actual.facturadoCent),
    historia,
  };
}
