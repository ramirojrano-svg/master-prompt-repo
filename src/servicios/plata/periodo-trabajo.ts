// src/servicios/plata/periodo-trabajo.ts — con qué mes abren Cierre y Cobranza.
//
// Las dos pantallas abrían siempre en el mes ANTERIOR, por un razonamiento correcto y a la vez
// incompleto: el mes en curso todavía está sumando horas, así que lo que se cierra y lo que se
// reclama es el que ya terminó.
//
// El problema aparece cuando el mes anterior no existe. Un centro que empezó a usar la app este
// mes abre Cierre y Cobranza y ve todo en cero: no porque esté al día, sino porque está mirando un
// mes en el que nunca pasó nada. Una pantalla que arranca vacía parece rota, y la que la abre no
// tiene forma de saber que la respuesta está a un clic de la flecha.
//
// La regla es entonces: **el mes anterior si tuvo movimientos; si no, el mes en curso**. Con
// historia se comporta como antes; sin historia, muestra el único mes que tiene algo que mostrar.
// No se elige "el último mes con movimientos" a secas porque en septiembre eso daría septiembre
// —que ya tiene reservas del día 1— y volvería a esconder agosto, que es justo el que hay que
// cerrar y cobrar.

import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { esPeriodoValido, periodoAnterior, type Periodo } from "../../dominio/reporte.ts";

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

  const anterior = periodoAnterior(a.hoy);
  // Un solo asiento alcanza para decidir: no hace falta contarlos ni sumarlos.
  const hubo = await db.asiento.findFirst({
    where: { operadorId: a.operadorId, periodo: anterior },
    select: { id: true },
  });
  return hubo ? anterior : a.hoy;
}
