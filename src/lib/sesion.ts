// src/lib/sesion.ts — puerta de entrada de TODAS las pantallas y server actions (§9).
// Vive acá y no en el layout: un gate de layout deja las server actions abiertas, y una action
// ES un endpoint HTTP público al que se le puede hacer POST directo.

import { auth } from "./auth.ts";
import { prisma } from "../db/prisma.ts";
import { resolverActor, type Actor } from "./actor.ts";

/**
 * Resuelve el actor del request para un centro (slug de la URL, NUNCA una cookie: un profesional
 * puede alquilar en dos centros y con `centroActivo` en cookie dos pestañas comparten el valor y
 * la escritura cae en el centro equivocado, §6.1).
 * Devuelve null si no hay sesión o si el usuario no tiene membresía activa en ese centro; la
 * página responde 404 (no 403): a un extraño no se le confirma la existencia del centro.
 */
export async function actorDeSesion(slug: string): Promise<Actor | null> {
  const sesion = await auth();
  const usuarioId = sesion?.user?.id;
  if (!usuarioId) return null;
  return resolverActor(prisma, { usuarioId, slug });
}
