// src/servicios/plata/periodo-trabajo.ts — con qué mes abre Cierre de mes.
//
// Este centro cobra A MES ENTRANTE: el último día hábil de agosto se le manda a cada profesional
// lo que va a pagar por SEPTIEMBRE, calculado sobre las reservas que ya tiene cargadas. No se
// cobra a mes vencido.
//
// Eso da vuelta el default de la pantalla. Antes abría en el mes anterior —el que ya terminó de
// sumar horas—, que es lo correcto cuando se factura lo consumido. Acá el mes que hay que cerrar
// es el que VIENE, porque es el que se está por cobrar.
//
// Queda un caso que hay que atender: si el mes que viene todavía no tiene ni una reserva cargada,
// abrir ahí muestra una pantalla en cero que parece rota. Ahí se cae al mes en curso, que es el
// único con algo para mostrar. La flecha sigue estando para ir a cualquier otro.

import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { esPeriodoValido, periodoSiguiente, type Periodo } from "../../dominio/reporte.ts";

/**
 * El período con el que abrir la pantalla.
 *
 * `pedido` es lo que vino por la URL: si es un 'YYYY-MM' válido manda él, siempre — la flecha del
 * mes tiene que poder llevar a un mes vacío si eso es lo que el usuario pidió.
 */
export async function periodoDeTrabajo(
  a: { operadorId: string; hoy: Periodo; pedido?: string },
  db: PrismaClient = prisma,
): Promise<Periodo> {
  if (a.pedido && esPeriodoValido(a.pedido)) return a.pedido;

  const siguiente = periodoSiguiente(a.hoy);
  // Un solo asiento alcanza para decidir: no hace falta contarlos ni sumarlos.
  const hubo = await db.asiento.findFirst({
    where: { operadorId: a.operadorId, periodo: siguiente },
    select: { id: true },
  });
  return hubo ? siguiente : a.hoy;
}
