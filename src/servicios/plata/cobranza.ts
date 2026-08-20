// src/servicios/plata/cobranza.ts — quién pagó y quién debe, mes por mes.
//
// Es la mitad que faltaba del circuito. Con "Cierre de mes" se emite la cuenta de cada
// profesional; a partir de ahí no había ninguna pantalla que contestara la pregunta con la que se
// trabaja todos los días: **¿a quién tengo que reclamarle?**
//
// Negocio tenía una columna "Saldo" y se sacó, con razón: traía el acumulado de TODOS los meses al
// lado de lo facturado del mes, y esos dos números no son comparables — con un año de historia
// mostraba millones junto a un mes de treinta horas. Lo que faltaba no era volver a ponerla, sino
// la versión correcta: por mes, y contra lo que ese mes se emitió.
//
// Qué es cada número:
//  · EMITIDO  = el total de la liquidación de ese mes. Congelado al cerrar; no se recalcula.
//  · PAGADO   = lo que entró imputado a ese mes.
//  · PENDIENTE = emitido − pagado. Nunca negativo hacia abajo por un pago viejo: los dos términos
//    son del mismo período.
//
// Sin liquidación emitida no hay nada que reclamar todavía: ahí lo que se muestra es lo que se va
// a emitir, marcado como tal. Reclamar algo que nunca se le comunicó a nadie es cómo se pierde un
// cliente.

import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { esPeriodoValido } from "../../dominio/reporte.ts";
import { FACTURABLES } from "./liquidacion.ts";

export type FilaCobranza = {
  inquilinoId: string;
  nombre: string;
  /** A nombre de quién sale la cuenta, si no es el mismo profesional. */
  pagador: string | null;
  /** La liquidación del mes, si ya se cerró. */
  liquidacion: { id: string; numero: number; estado: string; venceEl: Date } | null;
  /** Lo emitido (si hay liquidación) o lo que se emitiría (si todavía no se cerró). */
  emitidoCent: bigint;
  pagadoCent: bigint;
  pendienteCent: bigint;
  /** ¿Está vencida y sin pagar del todo? Es lo que ordena el trabajo del día. */
  vencida: boolean;
};

export type Cobranza = {
  periodo: string;
  moneda: string;
  filas: FilaCobranza[];
  totales: { emitidoCent: bigint; pagadoCent: bigint; pendienteCent: bigint; vencidas: number };
  /** Cuántos profesionales del mes todavía no tienen su cuenta emitida. */
  sinCerrar: number;
};

export async function cobranzaDelMes(
  a: { operadorId: string; periodo: string },
  db: PrismaClient = prisma,
): Promise<Cobranza | null> {
  if (!esPeriodoValido(a.periodo)) return null;

  const ahora = new Date();
  const [operador, liquidaciones, cargos, pagos, inquilinos] = await Promise.all([
    db.operador.findUniqueOrThrow({ where: { id: a.operadorId }, select: { moneda: true } }),
    db.liquidacion.findMany({
      where: { operadorId: a.operadorId, periodo: a.periodo },
      select: { id: true, inquilinoId: true, numero: true, estado: true, venceEl: true, totalCent: true },
    }),
    // Lo que se emitiría si todavía no se cerró: los mismos conceptos que reclama el cierre, para
    // que el número de acá y el de allá no puedan diferir.
    db.asiento.groupBy({
      by: ["inquilinoId"],
      where: { operadorId: a.operadorId, cuenta: "corriente", periodo: a.periodo, concepto: { in: FACTURABLES } },
      _sum: { montoCent: true },
    }),
    // Los pagos son créditos: vienen en negativo y se dan vuelta para leerlos como plata que entró.
    db.asiento.groupBy({
      by: ["inquilinoId"],
      where: { operadorId: a.operadorId, cuenta: "corriente", periodo: a.periodo, montoCent: { lt: 0 } },
      _sum: { montoCent: true },
    }),
    db.inquilino.findMany({ where: { operadorId: a.operadorId }, select: { id: true, nombre: true, pagador: true } }),
  ]);

  const ficha = new Map(inquilinos.map((i) => [i.id, i]));
  const liqDe = new Map(liquidaciones.map((l) => [l.inquilinoId, l]));
  const cargoDe = new Map(cargos.map((r) => [r.inquilinoId, r._sum.montoCent ?? 0n]));
  const pagoDe = new Map(pagos.map((r) => [r.inquilinoId, -(r._sum.montoCent ?? 0n)]));

  const ids = new Set<string>([...liqDe.keys(), ...cargoDe.keys(), ...pagoDe.keys()]);

  const filas: FilaCobranza[] = [...ids]
    .map((id) => {
      const l = liqDe.get(id);
      const i = ficha.get(id);
      // Con la cuenta emitida manda el total CONGELADO, no la suma de los cargos: si después
      // apareció un cargo tardío, lo que se le reclama es lo que dice el papel que recibió.
      const emitidoCent = l ? l.totalCent : (cargoDe.get(id) ?? 0n);
      const pagadoCent = pagoDe.get(id) ?? 0n;
      const pendienteCent = emitidoCent - pagadoCent;
      return {
        inquilinoId: id,
        nombre: i?.nombre ?? "(profesional dado de baja del sistema)",
        pagador: i?.pagador ?? null,
        liquidacion: l ? { id: l.id, numero: l.numero, estado: l.estado, venceEl: l.venceEl } : null,
        emitidoCent,
        pagadoCent,
        pendienteCent,
        // Vencida solo si HAY cuenta emitida: no se puede estar en mora de algo que nunca se
        // comunicó. Es la diferencia entre reclamar y acusar.
        vencida: Boolean(l && l.venceEl < ahora && pendienteCent > 0n),
      };
    })
    // Primero lo vencido, después lo que más falta cobrar: es el orden en que se trabaja.
    .sort((x, y) => Number(y.vencida) - Number(x.vencida) || Number(y.pendienteCent - x.pendienteCent) || x.nombre.localeCompare(y.nombre, "es"));

  return {
    periodo: a.periodo,
    moneda: operador.moneda,
    filas,
    totales: {
      emitidoCent: filas.reduce((acc, f) => acc + f.emitidoCent, 0n),
      pagadoCent: filas.reduce((acc, f) => acc + f.pagadoCent, 0n),
      // La deuda NO se netea con los que pagaron de más (§5.6): sumar solo lo positivo. Netear
      // esconde a quien debe detrás de quien tiene saldo a favor.
      pendienteCent: filas.reduce((acc, f) => acc + (f.pendienteCent > 0n ? f.pendienteCent : 0n), 0n),
      vencidas: filas.filter((f) => f.vencida).length,
    },
    sinCerrar: filas.filter((f) => !f.liquidacion && f.emitidoCent > 0n).length,
  };
}
