// src/servicios/plata/aviso-whatsapp.ts — mandar la liquidación por WhatsApp, de a uno.
//
// Mandarla por mail ya corre solo el último día hábil. Esto es la otra mitad: acá se cobra por
// WhatsApp, y hasta ahora el circuito terminaba con alguien abriendo cada liquidación, bajando el
// PDF, buscando a la persona en la agenda del teléfono y escribiendo el total a mano. Veintinueve
// veces.
//
// POR QUÉ UN LINK Y NO UN ENVÍO AUTOMÁTICO. WhatsApp no deja que un servidor mande mensajes salvo
// a través de la API oficial de Meta, que pide un número dedicado, verificación de la empresa y
// una plantilla aprobada. Las librerías que simulan WhatsApp Web existen y el riesgo concreto es
// que bloqueen el número del centro. Un link `wa.me` no es un envío: abre el chat correcto con el
// mensaje ya escrito, y la persona que cobra aprieta enviar. Es el mismo gesto de siempre, sin el
// trabajo de armarlo.
//
// QUÉ LLEVA EL MENSAJE. Todo lo necesario para pagar sin tener que preguntar nada: el mes, el
// total, cuándo vence y a dónde se transfiere. Esa última parte es la que importa — la liquidación
// decía cuánto y no a dónde, así que el circuito terminaba igual en un WhatsApp preguntando el
// alias.
//
// El PDF NO viaja en un link de wa.me: solo puede llevar texto. Para el detalle turno por turno
// está el botón de compartir adentro de la liquidación, que sí adjunta el archivo.

import { z } from "zod";
import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { definirAccion } from "../../lib/accion.ts";
import type { Actor } from "../../lib/actor.ts";
import { formatearPesos } from "../../dominio/tarifa.ts";
import { nombreSinEspecialidad } from "../../dominio/perfil.ts";
import { nombreDePeriodo } from "../../dominio/reporte.ts";
import type { DatosDeCobro } from "../config/cobro.ts";

export type MensajeAviso = {
  /** El link que abre el chat de esa persona con el texto ya escrito. */
  href: string;
  /** El texto, para poder mostrarlo o probarlo sin abrir WhatsApp. */
  texto: string;
};

/**
 * El mensaje de una liquidación, listo para mandar.
 *
 * `whatsapp` viene ya normalizado de la ficha (`telefonoAWa`): si está vacío no hay link que armar
 * y se devuelve null, porque un botón que abre un chat equivocado es peor que no tener botón.
 */
export function mensajeDeAviso(a: {
  whatsapp: string | null;
  nombre: string;
  periodo: string;
  totalCent: bigint;
  venceEl: string;
  moneda: string;
  cobro: Pick<DatosDeCobro, "titular" | "alias" | "cbu" | "cuit" | "banco">;
}): MensajeAviso | null {
  if (!a.whatsapp) return null;

  const plata = (c: bigint) => formatearPesos(c, a.moneda);
  const vence = new Date(`${a.venceEl}T12:00:00Z`).toLocaleDateString("es-AR", {
    day: "numeric", month: "long", timeZone: "UTC",
  });

  // Tratamiento por el nombre de pila, sin la especialidad: "Hola Marta", no "Hola Marta Gil
  // (PAMI)". Es un mensaje de WhatsApp, no el encabezado de un papel.
  const saludo = nombreSinEspecialidad(a.nombre).split(" ")[0] ?? a.nombre;

  const lineas = [
    `Hola ${saludo}, te paso la liquidación de ${nombreDePeriodo(a.periodo)}.`,
    "",
    `Total: ${plata(a.totalCent)}`,
    `Vence: ${vence}`,
  ];

  // A dónde se transfiere. Cada dato en SU renglón: en WhatsApp se copia tocando y manteniendo, y
  // un alias pegado al CBU en la misma línea obliga a seleccionar a mano — que es justo el
  // problema que ya nos costó una vuelta en el PDF.
  const comoPagar: string[] = [];
  if (a.cobro.alias) comoPagar.push(`Alias: ${a.cobro.alias}`);
  if (a.cobro.cbu) comoPagar.push(`CBU: ${a.cobro.cbu}`);
  if (a.cobro.titular) comoPagar.push(`Titular: ${a.cobro.titular}`);
  if (a.cobro.cuit) comoPagar.push(`CUIT: ${a.cobro.cuit}`);
  if (a.cobro.banco) comoPagar.push(`Banco: ${a.cobro.banco}`);
  if (comoPagar.length) lineas.push("", "Para transferir:", ...comoPagar);

  lineas.push("", "Cualquier duda, avisame. ¡Gracias!");

  const texto = lineas.join("\n");
  return { href: `https://wa.me/${a.whatsapp}?text=${encodeURIComponent(texto)}`, texto };
}

export const AvisadaInput = z.object({ liquidacionId: z.string().min(1) });

export type ResultadoAvisada = { ok: true; nombre: string } | { ok: false; error: "NO_ENCONTRADA" };

/**
 * Deja registrado que a esa persona ya se le avisó.
 *
 * Sin esto, una lista de veintinueve es imposible de recorrer: a la quinta ya no se sabe por dónde
 * se iba. Es la MISMA marca que usa el envío por mail, así que las dos vías no se pisan: a quien
 * se le mandó por WhatsApp no le llega después el correo automático.
 *
 * Se marca al abrir el chat, no al enviarlo —WhatsApp no avisa si se apretó enviar—. Es deliberado
 * y recuperable: si se abrió por error, el botón sigue estando y se puede volver a tocar.
 */
async function marcarAvisada(
  actor: Actor,
  input: z.infer<typeof AvisadaInput>,
  db: PrismaClient,
): Promise<ResultadoAvisada> {
  const liq = await db.liquidacion.findFirst({
    where: { id: input.liquidacionId, operadorId: actor.operadorId },
    select: { id: true, inquilinoId: true, avisadaEl: true },
  });
  if (!liq) return { ok: false, error: "NO_ENCONTRADA" };

  // La primera marca manda: volver a tocar no corre la fecha hacia adelante, así queda cuándo se
  // avisó de verdad.
  if (liq.avisadaEl === null) {
    await db.liquidacion.update({ where: { id: liq.id }, data: { avisadaEl: new Date() } });
  }
  const ficha = await db.inquilino.findFirst({ where: { id: liq.inquilinoId }, select: { nombre: true } });
  return { ok: true, nombre: ficha?.nombre ?? "ese profesional" };
}

const CFG_AVISADA = {
  permiso: "periodo.cerrar",
  schema: AvisadaInput,
  resumen: (i: z.infer<typeof AvisadaInput>) => `aviso por WhatsApp de la liquidación ${i.liquidacionId}`,
} as const;

export const marcarComoAvisada = definirAccion(CFG_AVISADA, (a, i) => marcarAvisada(a, i, prisma));
export const avisosCon = (db: PrismaClient) => ({
  marcar: definirAccion({ ...CFG_AVISADA, db }, (a, i) => marcarAvisada(a, i, db)),
});
