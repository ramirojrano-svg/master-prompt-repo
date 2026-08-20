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

import type { PrismaClient } from "@prisma/client";
import type { z } from "zod";
import type { Actor } from "./actor.ts";
import { registrar } from "./auditoria.ts";
import { puede, type Permiso } from "./permisos.ts";

export type Resultado<O> = { ok: true; data: O } | { ok: false; error: "SIN_PERMISO" | "ENTRADA_INVALIDA" };

export function definirAccion<I, O>(
  cfg: {
    permiso: Permiso;
    schema: z.ZodType<I>;
    /**
     * Qué escribir en el registro de auditoría además del permiso y el resultado.
     *
     * Lo arma la acción A MANO y no se deriva del input: varias acciones reciben contraseñas, y un
     * registro que guarde el input las guarda. Si no se define, queda solo el permiso — que ya
     * dice bastante.
     */
    resumen?: (input: I) => string;
    /** La base donde escribir el registro. Por default la de siempre; las versiones inyectables de
     *  los servicios pasan la suya para que el registro caiga donde cae la operación. */
    db?: PrismaClient;
  },
  handler: (actor: Actor, input: I) => Promise<O>,
): (actor: Actor, raw: unknown) => Promise<Resultado<O>> {
  return async (actor, raw) => {
    // Los rechazos se registran igual, y son los que más interesan: un intento sin permiso es
    // exactamente lo que se va a buscar el día que algo no cierre.
    if (!puede(actor.rol, cfg.permiso)) {
      await registrar({ actor, permiso: cfg.permiso, resultado: "SIN_PERMISO" }, cfg.db);
      return { ok: false, error: "SIN_PERMISO" };
    }
    const parsed = cfg.schema.safeParse(raw);
    if (!parsed.success) {
      await registrar({ actor, permiso: cfg.permiso, resultado: "ENTRADA_INVALIDA" }, cfg.db);
      return { ok: false, error: "ENTRADA_INVALIDA" };
    }

    const data = await handler(actor, parsed.data);
    // El resultado del handler puede ser un rechazo de negocio ({ ok: false, error }); se registra
    // ese código y no un "ok" genérico, que no distinguiría "se hizo" de "se intentó".
    const r = data as { ok?: boolean; error?: string };
    const resultado = r && typeof r === "object" && r.ok === false && typeof r.error === "string" ? r.error : "ok";
    await registrar({ actor, permiso: cfg.permiso, resultado, resumen: cfg.resumen?.(parsed.data) }, cfg.db);

    return { ok: true, data };
  };
}
