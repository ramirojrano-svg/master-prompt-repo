// src/lib/accion.ts — envoltorio obligatorio de las server actions (§6.2).
// Una action sin permiso declarado NO COMPILA (el permiso es parte de la firma). El schema vive
// en un módulo PURO (afuera de "use server"), así se puede importar y testear. El chequeo de
// permiso se hace SIEMPRE, aunque la página ya haya escondido el link: una server action ES un
// endpoint HTTP público al que se le puede hacer POST directo.
//
// Reconciliación con §6.2: acá `definirAccion` recibe el `actor` ya resuelto (lo arma la capa de
// sesión con resolverActor + el slug de la URL) en vez de resolverlo adentro. Separa la sesión
// de la lógica y hace la action testeable sin montar Auth.js. El wrapper de sesión (F2) hará
// `resolverActor()` y llamará a la action con el actor.

import type { z } from "zod";
import type { Actor } from "./actor.ts";
import { puede, type Permiso } from "./permisos.ts";

export type Resultado<O> = { ok: true; data: O } | { ok: false; error: "SIN_PERMISO" | "ENTRADA_INVALIDA" };

export function definirAccion<I, O>(
  cfg: { permiso: Permiso; schema: z.ZodType<I> },
  handler: (actor: Actor, input: I) => Promise<O>,
): (actor: Actor, raw: unknown) => Promise<Resultado<O>> {
  return async (actor, raw) => {
    if (!puede(actor.rol, cfg.permiso)) return { ok: false, error: "SIN_PERMISO" };
    const parsed = cfg.schema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "ENTRADA_INVALIDA" };
    return { ok: true, data: await handler(actor, parsed.data) };
  };
}
