// src/servicios/plata/facturable.ts — quién está adentro del circuito de plata, y quién no.
//
// La app nació dando por hecho que a todo profesional se le cobra. Después apareció el caso real:
// alguien que usa un consultorio y no genera ingresos. Se agregó la casilla "factura" en la ficha
// y con eso se lo sacó de Negocio… pero solo de Negocio.
//
// Todo lo demás siguió igual: al reservar se le resolvía la tarifa general, se le estampaba un
// valor por hora y se le asentaba un `cargo_uso`. Esos cargos después aparecían en Cierre de mes y
// en Cobranza como plata a reclamar. La casilla decía una cosa y la app hacía otra.
//
// Este módulo existe para que la pregunta se haga en UN solo lugar. Destildar "factura" tiene que
// significar lo mismo en las cuatro puertas por las que se crea un cargo —reserva suelta, serie,
// mudanza de turno y recotización— y en las tres pantallas de plata.

import { type PrismaClient } from "@prisma/client";

/**
 * ¿Se le factura a este profesional?
 *
 * Ante la duda, SÍ. Si el id no aparece —una ficha borrada, un dato viejo— se cobra: dejar de
 * cobrarle a alguien por accidente es plata que se pierde en silencio, mientras que un cargo de
 * más se ve y se corrige con una nota de crédito.
 */
export async function seLeFactura(
  db: Pick<PrismaClient, "inquilino">,
  operadorId: string,
  inquilinoId: string | null,
): Promise<boolean> {
  if (!inquilinoId) return true;
  const i = await db.inquilino.findFirst({
    where: { id: inquilinoId, operadorId },
    select: { facturable: true },
  });
  return i?.facturable ?? true;
}

/** Los ids que NO facturan, para filtrar de una lista ya armada (Cierre, Cobranza). */
export async function idsQueNoFacturan(
  db: Pick<PrismaClient, "inquilino">,
  operadorId: string,
): Promise<Set<string>> {
  const filas = await db.inquilino.findMany({
    where: { operadorId, facturable: false },
    select: { id: true },
  });
  return new Set(filas.map((f) => f.id));
}
