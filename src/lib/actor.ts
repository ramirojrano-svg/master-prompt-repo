// src/lib/actor.ts — quién es el actor de un request (§6.2).
// El rol se lee FRESCO de la DB en cada request, jamás del JWT: si el titular le baja el rol a
// alguien, tiene que surtir efecto en el próximo click, no cuando venza el token. Sin membresía
// activa => null (y la capa de arriba responde 404, no 403: a un extraño no se le confirma la
// existencia del centro).

import { type PrismaClient } from "@prisma/client";
import type { Rol } from "./permisos.ts";

export type Actor = {
  usuarioId: string;
  operadorId: string;
  rol: Rol;
  inquilinoId: string | null;
};

export async function resolverActor(
  db: Pick<PrismaClient, "usuarioOperador">,
  a: { usuarioId: string; slug: string },
): Promise<Actor | null> {
  const uo = await db.usuarioOperador.findFirst({
    where: { usuarioId: a.usuarioId, activo: true, operador: { slug: a.slug } },
    select: { operadorId: true, rol: true, inquilinoId: true },
  });
  if (!uo) return null; // sin fila: el rol menos privilegiado es NINGUNO (fail-closed)
  return { usuarioId: a.usuarioId, operadorId: uo.operadorId, rol: uo.rol, inquilinoId: uo.inquilinoId };
}
