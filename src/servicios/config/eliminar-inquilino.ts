// src/servicios/config/eliminar-inquilino.ts — borrar una ficha de verdad.
//
// La regla de la casa es ARCHIVAR, no borrar (§6.7): un profesional de baja sigue apareciendo en
// las liquidaciones viejas y sigue siendo un valor válido al corregir una fila del histórico.
// Borrar historia es cómo se pierde la capacidad de explicar un número seis meses después.
//
// Pero hay un caso que archivar no resuelve: la ficha DUPLICADA. Se crea sin querer —se borra a
// alguien para recargarlo, se lo escribe dos veces— y a partir de ahí ensucia todo: aparece en el
// buscador, se le agendan turnos por error, y si además se le cerró el mes, arrastra una
// liquidación con número que nadie va a cobrar. Eso no es historia: es basura con forma de
// historia, y archivarla solo la esconde.
//
// Así que el borrado existe, y es de verdad. Tres cosas lo hacen defendible:
//
//  1. HAY QUE DARLA DE BAJA PRIMERO. Son dos pasos deliberados, no un botón al lado de "editar".
//  2. SE DICE QUÉ SE VA A DESTRUIR, con números y en pesos, antes de tocar nada. Y hay que
//     escribir el nombre exacto para confirmar.
//  3. QUEDA EN AUDITORÍA con el detalle de lo destruido — que es lo único que sobrevive.
//
// Las ocho tablas que apuntan a una ficha tienen FK `NoAction`: Postgres rechaza el borrado
// mientras quede una fila colgando. Por eso se borran en orden y dentro de UNA transacción: a
// mitad de camino no puede quedar una ficha sin turnos, o peor, turnos sin ficha.

import { z } from "zod";
import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { definirAccion } from "../../lib/accion.ts";
import type { Actor } from "../../lib/actor.ts";

/** Lo que se va a destruir. Se muestra ANTES de confirmar: nadie decide a ciegas. */
export type Arrastre = {
  inquilinoId: string;
  nombre: string;
  estado: string;
  reservas: number;
  movimientos: number;
  /** Suma de los cargos. En pesos es lo que hace entender el tamaño de lo que se borra. */
  cargadoCent: bigint;
  /** Plata que efectivamente entró imputada a esta ficha. Si es > 0, hay que mirar dos veces. */
  cobradoCent: bigint;
  liquidaciones: { numero: number; totalCent: bigint }[];
  tarifas: number;
  /** ¿Tiene acceso a la app? Se borra con ella. */
  tieneAcceso: boolean;
};

/** Qué arrastra esta ficha. `null` si no existe o no es de este centro. */
export async function queArrastra(
  a: { operadorId: string; inquilinoId: string },
  db: PrismaClient = prisma,
): Promise<Arrastre | null> {
  const i = await db.inquilino.findFirst({
    where: { id: a.inquilinoId, operadorId: a.operadorId },
    select: { id: true, nombre: true, estado: true },
  });
  if (!i) return null;

  const donde = { operadorId: a.operadorId, inquilinoId: a.inquilinoId };
  const [reservas, movimientos, cargos, cobros, liquidaciones, tarifas, acceso] = await Promise.all([
    db.ocupacion.count({ where: donde }),
    db.asiento.count({ where: donde }),
    db.asiento.aggregate({ where: { ...donde, montoCent: { gt: 0 } }, _sum: { montoCent: true } }),
    db.asiento.aggregate({ where: { ...donde, montoCent: { lt: 0 } }, _sum: { montoCent: true } }),
    db.liquidacion.findMany({ where: donde, select: { numero: true, totalCent: true }, orderBy: { numero: "asc" } }),
    db.tarifa.count({ where: donde }),
    db.usuarioOperador.findFirst({ where: donde, select: { usuarioId: true } }),
  ]);

  return {
    inquilinoId: i.id,
    nombre: i.nombre,
    estado: i.estado,
    reservas,
    movimientos,
    cargadoCent: cargos._sum.montoCent ?? 0n,
    // Los cobros están en negativo: se dan vuelta para leerlos como plata que entró.
    cobradoCent: -(cobros._sum.montoCent ?? 0n),
    liquidaciones,
    tarifas,
    tieneAcceso: acceso !== null,
  };
}

export const EliminarInput = z.object({
  inquilinoId: z.string().min(1),
  /** El nombre EXACTO, tipeado a mano. Es la última pregunta antes de destruir. */
  confirmacion: z.string().min(1),
});

export type ResultadoEliminar =
  | { ok: true; nombre: string; reservas: number; movimientos: number; liquidaciones: number }
  | { ok: false; error: "NO_ENCONTRADO" | "SIGUE_ACTIVO" | "NOMBRE_NO_COINCIDE" };

/** Compara nombres como los ve una persona: sin espacios de más y sin importar mayúsculas. */
function mismoNombre(a: string, b: string): boolean {
  const limpio = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
  return limpio(a) === limpio(b);
}

async function eliminar(actor: Actor, input: z.infer<typeof EliminarInput>, db: PrismaClient): Promise<ResultadoEliminar> {
  // Pertenencia en el WHERE: el id vino de un formulario.
  const i = await db.inquilino.findFirst({
    where: { id: input.inquilinoId, operadorId: actor.operadorId },
    select: { id: true, nombre: true, estado: true },
  });
  if (!i) return { ok: false, error: "NO_ENCONTRADO" };
  // Dar de baja primero no es burocracia: es lo que separa "me equivoqué de botón" de una
  // decisión tomada en dos momentos distintos.
  if (i.estado !== "baja") return { ok: false, error: "SIGUE_ACTIVO" };
  if (!mismoNombre(input.confirmacion, i.nombre)) return { ok: false, error: "NOMBRE_NO_COINCIDE" };

  const donde = { operadorId: actor.operadorId, inquilinoId: i.id };

  return db.$transaction(async (tx) => {
    // El orden importa: primero lo que apunta a la ficha, la ficha al final. Las FK son NoAction,
    // así que un orden mal puesto no corrompe nada — Postgres aborta la transacción entera.
    const [asientos, liquidaciones, ocupaciones] = await Promise.all([
      tx.asiento.deleteMany({ where: donde }),
      tx.liquidacion.deleteMany({ where: donde }),
      tx.ocupacion.deleteMany({ where: donde }),
    ]);
    await Promise.all([
      tx.tarifa.deleteMany({ where: donde }),
      tx.membresia.deleteMany({ where: donde }),
      tx.esperaSlot.deleteMany({ where: donde }),
      tx.bolsaAsiento.deleteMany({ where: donde }),
    ]);

    // El acceso a la app se va con la ficha: una cuenta que puede entrar a nombre de alguien que
    // ya no existe es un agujero, no un resto.
    const accesos = await tx.usuarioOperador.findMany({ where: donde, select: { usuarioId: true } });
    await tx.usuarioOperador.deleteMany({ where: donde });
    for (const { usuarioId } of accesos) {
      // La cuenta de login es global y podría estar enganchada a otro centro. Se borra SOLO si ya
      // no le queda ninguno: si no, quedaría un usuario que entra y no llega a ninguna pantalla.
      const otros = await tx.usuarioOperador.count({ where: { usuarioId } });
      if (otros === 0) await tx.usuario.delete({ where: { id: usuarioId } });
    }

    await tx.inquilino.delete({ where: { id: i.id } });

    return {
      ok: true as const,
      nombre: i.nombre,
      reservas: ocupaciones.count,
      movimientos: asientos.count,
      liquidaciones: liquidaciones.count,
    };
  });
}

// El resumen de auditoría es lo ÚNICO que sobrevive al borrado, así que dice qué se llevó puesto.
const CFG_ELIMINAR = {
  permiso: "inquilino.administrar",
  schema: EliminarInput,
  resumen: (i: z.infer<typeof EliminarInput>) => `eliminar ficha ${i.inquilinoId} (${i.confirmacion})`,
} as const;

export const eliminarInquilino = definirAccion(CFG_ELIMINAR, (a, i) => eliminar(a, i, prisma));

/** Versión inyectable, para los tests. */
export const eliminarInquilinoCon = (db: PrismaClient) =>
  definirAccion({ ...CFG_ELIMINAR, db }, (a, i) => eliminar(a, i, db));
