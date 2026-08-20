// src/servicios/reportes/exportar.ts — armar el CSV del mes.
//
// Existe por una razón menos glamorosa que las otras pantallas: TENER LOS DATOS AFUERA. Hoy todo
// vive en una sola base; si un día se pierde el acceso, se borra algo por error, o simplemente hay
// que cruzar los números con el contador, no había forma de sacarlos.
//
// Dos exportaciones, porque son dos preguntas distintas:
//  · `movimientos`: la plata. Cada cargo y cada pago del mes, con su concepto y su clave.
//  · `turnos`: la agenda. Cada reserva del mes, con profesional, consultorio, horario e importe.
//
// El armado vive acá y no en la ruta a propósito: en la ruta no se puede testear —depende de la
// sesión y del singleton de la base—, y lo que hay que poder probar es justamente el contenido.

import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { armarCsv } from "../../dominio/csv.ts";
import { nombreDeConcepto } from "../../dominio/conceptos.ts";
import { diasDelPeriodo, esPeriodoValido } from "../../dominio/reporte.ts";
import { fechaEnZona, minutosAHora, rangoDiaEnZona } from "../../dominio/motor/zona.ts";
import { minutosDelDia } from "../../dominio/grilla.ts";

export type QueExportar = "movimientos" | "turnos";

/** Lo pedido por la URL, ya normalizado: cualquier cosa que no sea `turnos` es la plata. */
export function queExportar(v: string | null): QueExportar {
  return v === "turnos" ? "turnos" : "movimientos";
}

/** Los centavos, como número con punto decimal: es lo que Excel entiende como plata. */
function pesos(cent: bigint | null): string {
  if (cent === null) return "";
  const neg = cent < 0n;
  const abs = neg ? -cent : cent;
  return `${neg ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

export type PedidoExportar = { operadorId: string; periodo: string; que: QueExportar };

/**
 * Devuelve el CSV listo, o `null` si el período no es válido o el centro no tiene sede activa
 * (sin zona horaria no se puede fechar nada, y una fecha corrida en una exportación contable es
 * peor que no tenerla).
 */
export async function exportarCsv(p: PedidoExportar, db: PrismaClient = prisma): Promise<string | null> {
  if (!esPeriodoValido(p.periodo)) return null;

  const sede = await db.sede.findFirst({
    where: { operadorId: p.operadorId, activa: true },
    select: { zonaHoraria: true },
  });
  if (!sede) return null;
  const tz = sede.zonaHoraria;

  const dias = diasDelPeriodo(p.periodo);
  const primero = rangoDiaEnZona(dias[0]!, tz);
  const ultimo = rangoDiaEnZona(dias.at(-1)!, tz);
  if (!primero || !ultimo) return null;

  if (p.que === "turnos") {
    const filas = await db.ocupacion.findMany({
      where: { operadorId: p.operadorId, tipo: "reserva", inicio: { gte: primero.inicio, lt: ultimo.fin } },
      select: {
        inicio: true, fin: true, estado: true, importeCent: true, precioHoraCent: true, serieId: true,
        inquilino: { select: { nombre: true } }, sala: { select: { nombre: true } },
      },
      orderBy: { inicio: "asc" },
    });
    return armarCsv(
      ["fecha", "desde", "hasta", "profesional", "consultorio", "minutos", "valor_hora", "importe", "estado", "serie"],
      filas.map((f) => {
        const desde = minutosDelDia(f.inicio, tz);
        // Un turno que termina a medianoche cae en el día siguiente y `minutosDelDia` da 0; en la
        // planilla eso se lee como "de 20:00 a 00:00", que es lo correcto.
        const hasta = minutosDelDia(f.fin, tz);
        return [
          fechaEnZona(f.inicio, tz),
          minutosAHora(desde),
          minutosAHora(hasta),
          f.inquilino?.nombre ?? "",
          // Sin sala no es un dato que falte: es una reserva que no usa el espacio.
          f.sala?.nombre ?? "sin consultorio",
          Math.round((f.fin.getTime() - f.inicio.getTime()) / 60_000),
          pesos(f.precioHoraCent),
          pesos(f.importeCent),
          f.estado,
          f.serieId ?? "",
        ];
      }),
    );
  }

  // `Asiento` guarda `inquilinoId` suelto, sin relación declarada: la plata no cuelga del
  // profesional —si mañana se da de baja, los asientos siguen existiendo—. Así que el nombre se
  // resuelve con un diccionario aparte, igual que en Cobranza y en el reporte mensual.
  const [filas, inquilinos] = await Promise.all([
    db.asiento.findMany({
      where: { operadorId: p.operadorId, periodo: p.periodo },
      select: {
        fechaHecho: true, concepto: true, montoCent: true, moneda: true, medio: true, referencia: true,
        clave: true, liquidacionId: true, inquilinoId: true,
      },
      orderBy: { fechaHecho: "asc" },
    }),
    db.inquilino.findMany({ where: { operadorId: p.operadorId }, select: { id: true, nombre: true } }),
  ]);
  const nombreDe = new Map(inquilinos.map((i) => [i.id, i.nombre]));

  return armarCsv(
    ["fecha", "profesional", "concepto", "monto", "moneda", "medio", "comprobante", "liquidacion", "clave"],
    filas.map((f) => [
      fechaEnZona(f.fechaHecho, tz),
      nombreDe.get(f.inquilinoId) ?? "",
      // En castellano: la planilla la lee el contador, no el código. Que diga "cargo_uso" no la
      // hace más precisa, la hace ilegible.
      nombreDeConcepto(f.concepto),
      pesos(f.montoCent),
      f.moneda,
      f.medio ?? "",
      f.referencia ?? "",
      f.liquidacionId ?? "",
      f.clave,
    ]),
  );
}
