// src/servicios/plata/detalle-liquidacion.ts — el papel que recibe el profesional.
//
// Cerrar el mes emite un número. Este archivo arma lo que hay DETRÁS de ese número, que es lo
// único que se puede mandar: nadie paga un total suelto sin ver qué se le está cobrando, y la
// primera pregunta que llega por WhatsApp siempre es la misma — "¿de dónde sale este importe?".
//
// Dos decisiones que definen qué es este documento:
//
//  1. NO RECALCULA NADA. Los importes salen de la liquidación congelada al emitirla (§8.8) y las
//     líneas, de los asientos que quedaron sellados con su `liquidacionId`. Si mañana sube el
//     valor de la hora, el papel de agosto sigue diciendo lo de agosto. Un documento que cambia
//     solo no es un documento.
//  2. Los CARGOS DE USO se muestran como lo que son: la sesión que ocupó, con día, horario y
//     consultorio. "Uso de consultorio $7.500" cuarenta veces no le sirve a nadie para verificar
//     nada; "Mié 12/08 · 10:00 a 13:00 · Consultorio 2" sí.
//
// Los pagos NO entran en el total (§5.4: la liquidación son los cargos), pero sí se listan aparte
// con el saldo: el que recibe el papel quiere saber cuánto le queda por pagar, no solo cuánto se
// le facturó.

import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { nombreDeConcepto } from "../../dominio/conceptos.ts";
import { fechaEnZona, formatHora } from "../../dominio/motor/zona.ts";

export type LineaLiquidacion = {
  /** Cuándo pasó el hecho: la sesión, no cuándo se asentó. */
  fecha: Date;
  concepto: string;
  /** El renglón que se lee: horario y consultorio si es una sesión, si no el concepto solo. */
  detalle: string;
  montoCent: bigint;
};

export type PagoImputado = {
  fecha: Date;
  medio: string | null;
  referencia: string | null;
  montoCent: bigint;
};

export type DetalleLiquidacion = {
  id: string;
  numero: number;
  periodo: string;
  estado: string;
  emitidaAt: Date | null;
  venceEl: Date;
  /** A nombre de quién salió, estampado al emitir. */
  receptor: string;
  receptorCuit: string | null;
  receptorCondIva: string;
  /** El profesional al que corresponde, para poder volver a su ficha. */
  inquilinoId: string;
  subtotalCent: bigint;
  ivaCent: bigint;
  /** Décimas de %: 0 = sin IVA discriminado, que es el caso de este centro. */
  alicuota: number;
  totalCent: bigint;
  moneda: string;
  lineas: LineaLiquidacion[];
  pagos: PagoImputado[];
  pagadoCent: bigint;
  /** Total − pagado. Negativo = pagó de más. */
  saldoCent: bigint;
  /** Datos de quien emite, para el encabezado del papel. */
  centro: { nombre: string };
  /** La factura fiscal externa, si el operador la cargó a mano. */
  facturaExterna: { tipo: string; numero: string } | null;
};

/**
 * Devuelve el documento, o `null` si la liquidación no existe o no es de este centro.
 *
 * La pertenencia va en el `where` y no en un `if` posterior: el id llega por URL, y una consulta
 * por id solo devolvería el documento de otro centro antes de que nadie lo revise.
 */
export async function detalleDeLiquidacion(
  a: { operadorId: string; liquidacionId: string },
  db: PrismaClient = prisma,
): Promise<DetalleLiquidacion | null> {
  const liq = await db.liquidacion.findFirst({
    where: { id: a.liquidacionId, operadorId: a.operadorId },
  });
  if (!liq) return null;

  const [operador, sede, asientos] = await Promise.all([
    db.operador.findUniqueOrThrow({ where: { id: a.operadorId }, select: { nombre: true, moneda: true } }),
    db.sede.findFirst({ where: { operadorId: a.operadorId, activa: true }, select: { zonaHoraria: true } }),
    // Las líneas son EXACTAMENTE los asientos sellados con esta liquidación. No se vuelve a
    // preguntar "qué cargos hay en el período": un cargo tardío, posterior al cierre, no está en
    // este papel y no tiene que aparecer en él.
    db.asiento.findMany({
      where: { operadorId: a.operadorId, liquidacionId: liq.id },
      select: { fechaHecho: true, concepto: true, montoCent: true, reservaId: true },
      orderBy: { fechaHecho: "asc" },
    }),
  ]);
  const tz = sede?.zonaHoraria ?? "UTC";

  // Las reservas que originaron los cargos, para poder escribir el horario en cada renglón. Una
  // sola consulta con todos los ids: cuarenta cargos no pueden ser cuarenta viajes a la base.
  const reservaIds = asientos.map((x) => x.reservaId).filter((x): x is string => x !== null);
  const reservas = reservaIds.length
    ? await db.ocupacion.findMany({
        where: { operadorId: a.operadorId, id: { in: reservaIds } },
        select: { id: true, inicio: true, fin: true, sala: { select: { nombre: true } } },
      })
    : [];
  const porId = new Map(reservas.map((r) => [r.id, r]));

  const lineas: LineaLiquidacion[] = asientos.map((x) => {
    const r = x.reservaId ? porId.get(x.reservaId) : undefined;
    const concepto = nombreDeConcepto(x.concepto);
    if (!r) return { fecha: x.fechaHecho, concepto, detalle: concepto, montoCent: x.montoCent };
    // Sin sala no es un dato que falte: es una reserva que usa la recepción y no el consultorio.
    const donde = r.sala?.nombre ?? "sin consultorio";
    return {
      fecha: r.inicio,
      concepto,
      detalle: `${formatHora(r.inicio, tz)} a ${formatHora(r.fin, tz)} · ${donde}`,
      montoCent: x.montoCent,
    };
  });
  // Reordenadas por la fecha que se muestra: para los cargos de uso esa es la de la sesión, que
  // puede no coincidir con el orden en que se asentaron.
  lineas.sort((p, q) => p.fecha.getTime() - q.fecha.getTime());

  // Los pagos del período. No se restan del total —la liquidación son los cargos— pero sin ellos
  // el papel le pide plata a alguien que ya pagó.
  const pagosCrudos = await db.asiento.findMany({
    where: { operadorId: a.operadorId, inquilinoId: liq.inquilinoId, periodo: liq.periodo, montoCent: { lt: 0n } },
    select: { fechaHecho: true, medio: true, referencia: true, montoCent: true },
    orderBy: { fechaHecho: "asc" },
  });
  // En positivo: para quien lee, un pago es plata que entregó, no un número negativo.
  const pagos: PagoImputado[] = pagosCrudos.map((p) => ({
    fecha: p.fechaHecho,
    medio: p.medio,
    referencia: p.referencia,
    montoCent: -p.montoCent,
  }));
  const pagadoCent = pagos.reduce((s, p) => s + p.montoCent, 0n);

  return {
    id: liq.id,
    numero: liq.numero,
    periodo: liq.periodo,
    estado: liq.estado,
    emitidaAt: liq.emitidaAt,
    venceEl: liq.venceEl,
    receptor: liq.receptorRazonSocial,
    receptorCuit: liq.receptorCuit,
    receptorCondIva: liq.receptorCondIva,
    inquilinoId: liq.inquilinoId,
    subtotalCent: liq.subtotalCent,
    ivaCent: liq.ivaCent,
    alicuota: liq.alicuota,
    totalCent: liq.totalCent,
    moneda: operador.moneda,
    lineas,
    pagos,
    pagadoCent,
    saldoCent: liq.totalCent - pagadoCent,
    centro: { nombre: operador.nombre },
    facturaExterna:
      liq.facturaExternaTipo && liq.facturaExternaNro
        ? { tipo: liq.facturaExternaTipo, numero: liq.facturaExternaNro }
        : null,
  };
}

/** La fecha de la línea, en la zona del centro. Se exporta para que la pantalla no reimplemente el
 *  formateo y termine mostrando el día corrido por la zona del navegador. */
export function fechaDeLinea(d: Date, tz: string): string {
  return fechaEnZona(d, tz);
}
