// src/lib/auditoria.ts — dejar registro de quién hizo qué.
//
// Se escribe desde `definirAccion`, o sea desde el ÚNICO lugar por el que pasan todas las
// escrituras. Ponerlo ahí y no en cada servicio significa que ninguna acción se puede olvidar de
// registrarse: la que se agregue mañana queda cubierta sin que nadie se acuerde.
//
// Tres reglas, y la primera no se negocia:
//
//  1. NO SE GUARDA EL INPUT. Varias acciones reciben contraseñas —crear un acceso, restablecer una
//     clave— y un registro de auditoría que las guarde es una filtración con fecha y hora. Se
//     guarda QUÉ acción y CÓMO salió; el detalle, cuando hace falta, lo arma la acción a mano.
//  2. Un fallo escribiendo el registro NO puede voltear la operación. Cancelar un turno tiene que
//     funcionar aunque la tabla de auditoría esté rota.
//  3. Se escribe DESPUÉS de saber cómo salió, e incluye los rechazos: un intento sin permiso es
//     justamente lo que más interesa ver.

import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma.ts";
import type { Actor } from "./actor.ts";
import type { Permiso } from "./permisos.ts";

export type EntradaAuditoria = {
  actor: Actor;
  permiso: Permiso;
  /** 'ok' o el código del rechazo. */
  resultado: string;
  /** Descripción corta y sin secretos. Opcional. */
  resumen?: string | null;
};

/**
 * Registra la acción. No devuelve nada y no tira: quien la llama no tiene que envolverla en un
 * try, porque el registro es un efecto secundario y nunca el objetivo.
 *
 * La base se puede inyectar igual que en todos los servicios. No es un detalle de tests: sin esto,
 * una acción construida sobre OTRA base escribía su registro en la de siempre — o sea en la
 * equivocada, y en silencio. El registro tiene que ir a la misma base que la operación.
 */
export async function registrar(e: EntradaAuditoria, db: PrismaClient = prisma): Promise<void> {
  try {
    await db.auditoria.create({
      data: {
        operadorId: e.actor.operadorId,
        usuarioId: e.actor.usuarioId,
        rol: e.actor.rol,
        permiso: e.permiso,
        resultado: e.resultado.slice(0, 120),
        // Tope corto a propósito: es una descripción, no un volcado. Un campo sin límite invita a
        // meterle el input entero, que es exactamente lo que no puede pasar.
        resumen: e.resumen ? e.resumen.slice(0, 300) : null,
      },
    });
  } catch (err) {
    // Se avisa por el log del servidor y se sigue. Perder un registro es malo; perder la operación
    // que el usuario pidió es peor.
    console.error("[auditoria] no se pudo registrar:", (err as Error)?.message ?? err);
  }
}
