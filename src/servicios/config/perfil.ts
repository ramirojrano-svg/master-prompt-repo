// src/servicios/config/perfil.ts — el perfil que edita el propio profesional.
//
// Hasta acá el nombre de un profesional solo lo escribía la administración, al darlo de alta. Es
// razonable para abrir la ficha, pero el nombre con el que alguien quiere que lo llamen es suyo:
// "Dra. Gómez" o "María Gómez" no es un detalle cosmético cuando ese texto es lo que ve el resto
// del centro en la agenda.
//
// Se guarda sobre el MISMO `Inquilino` que ya usa toda la app —no en una tabla de perfil aparte—
// justamente para que el cambio se vea donde importa. Un perfil separado habría dejado dos
// nombres: el que la persona eligió y el que la agenda sigue mostrando.
//
// La foto va como data URL en la fila. No hay almacenamiento de archivos montado, y sumar uno por
// una miniatura sería agregar un servicio, sus credenciales y su modo de fallar. El recorte a
// 200×200 lo hace el navegador antes de enviar; acá se verifica igual, porque el recorte del
// navegador es una comodidad y no un control: a esta acción se le puede hacer POST directo.
//
// El esquema y las constantes viven en dominio/perfil.ts, que es puro: el selector de foto es un
// componente de cliente y necesita el tope de tamaño sin arrastrarse Prisma al navegador.

import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { definirAccion } from "../../lib/accion.ts";
import { FOTO_RE, PerfilInput, type PerfilEntrada } from "../../dominio/perfil.ts";

export type ResultadoPerfil = { ok: true } | { ok: false; error: "SIN_FICHA" | "FOTO_INVALIDA" };

/** El perfil actual, para pintar el formulario. null si el actor no tiene ficha de profesional. */
export async function miPerfil(
  a: { operadorId: string; inquilinoId: string | null },
  db: PrismaClient = prisma,
): Promise<{ nombre: string; titulo: string | null; foto: string | null } | null> {
  if (!a.inquilinoId) return null;
  return db.inquilino.findFirst({
    where: { id: a.inquilinoId, operadorId: a.operadorId },
    select: { nombre: true, titulo: true, foto: true },
  });
}

async function guardar(
  actor: { operadorId: string; inquilinoId: string | null },
  input: PerfilEntrada,
  db: PrismaClient = prisma,
): Promise<ResultadoPerfil> {
  // El permiso dice "puede editar SU perfil"; sin ficha vinculada no hay un "su". El administrador
  // tiene el permiso por tenerlos todos, y aun así cae acá: no es dueño de ninguna ficha.
  if (!actor.inquilinoId) return { ok: false, error: "SIN_FICHA" };

  // El id sale del ACTOR, nunca del formulario: si viniera del form, cambiar un campo oculto
  // dejaría a cualquiera editando la ficha del de al lado.
  const propia = await db.inquilino.findFirst({
    where: { id: actor.inquilinoId, operadorId: actor.operadorId },
    select: { id: true },
  });
  if (!propia) return { ok: false, error: "SIN_FICHA" };

  const foto = input.foto?.trim();
  if (foto && !FOTO_RE.test(foto)) return { ok: false, error: "FOTO_INVALIDA" };
  // La chica se valida igual que la grande: llega del navegador y una data URL sin controlar es
  // una etiqueta <img> con lo que sea adentro.
  const fotoChica = input.fotoChica?.trim();
  if (fotoChica && !FOTO_RE.test(fotoChica)) return { ok: false, error: "FOTO_INVALIDA" };

  await db.inquilino.update({
    where: { id: propia.id },
    data: {
      nombre: input.nombre,
      titulo: input.titulo ? input.titulo : null,
      // Tres casos, y los tres distintos: borrarla, cambiarla, o no tocarla.
      // Las dos se mueven juntas SIEMPRE. Guardar una sin la otra deja la lista mostrando la
      // foto vieja y la ficha la nueva, que es peor que no tener miniatura.
      ...(input.borrarFoto
        ? { foto: null, fotoChica: null }
        : foto
          ? { foto, fotoChica: fotoChica ?? null }
          : {}),
    },
  });
  return { ok: true };
}

export const guardarPerfil = definirAccion({ permiso: "perfil.propio.editar", schema: PerfilInput }, (a, i) => guardar(a, i));

/** Versión inyectable, para los tests. */
export const perfilCon = (db: PrismaClient) => ({
  guardar: definirAccion({ permiso: "perfil.propio.editar", schema: PerfilInput, db }, (a, i) => guardar(a, i, db)),
});
