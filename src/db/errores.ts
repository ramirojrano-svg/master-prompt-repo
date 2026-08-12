// src/db/errores.ts — traducción de errores crudos de Postgres a algo accionable.
// El 23P01 (exclusion_violation) no se deja salir crudo a mitad de un flujo con plata (§4.8.4).

/**
 * ¿El error es un choque de exclusión de Ocupacion? Devuelve por qué eje chocó, o null.
 * Prisma envuelve el error del driver pero conserva el SQLSTATE y el nombre del constraint
 * en el mensaje. Se busca por ambos para ser robusto ante la forma exacta del wrapper.
 */
export function esChoqueDeOcupacion(e: unknown): "sala" | "inquilino" | null {
  const msg = String((e as { message?: string })?.message ?? "");
  const esExclusion = msg.includes("23P01") || msg.includes("exclusion constraint") || msg.includes("exclusion_violation");
  if (!esExclusion) return null;
  return msg.includes("ocupacion_inquilino_sin_solape") ? "inquilino" : "sala";
}
