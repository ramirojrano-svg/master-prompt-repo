// src/servicios/reportes/respaldo-mensual.ts — sacar la plata del mes de la base, sola.
//
// Toda la plata vive en una única base (Neon). Mientras esté todo ahí, un borrado por error, una
// migración que sale mal o simplemente perder el acceso dejan al centro sin de dónde reconstruir.
// Esta tarea manda, una vez por mes, los dos CSV del mes que cerró a la casilla del administrador.
//
// El correo es el lugar a propósito: la bandeja de entrada la respalda el proveedor de mail (por
// ejemplo Google), sobrevive a que se caiga la base y a que se pierda la cuenta de Vercel, y no
// suma infraestructura nueva —ni un bucket, ni una clave más que cuidar—. Es el respaldo más
// aburrido posible, que es exactamente lo que se quiere de un respaldo.
//
// Decisiones que la hacen segura para dejarla corriendo sola:
//
//  · El día lo decide ESTE módulo, no el cron. Vercel dispara todos los días; acá se pregunta si
//    hoy es el primero del mes. Un cron con la fecha adentro no se puede probar ni leer, igual que
//    en el envío de liquidaciones.
//  · Respalda el mes ANTERIOR, que ya cerró. El primero de septiembre se guarda agosto entero.
//  · Es a-lo-sumo-molesta, no peligrosa, si se dispara dos veces: manda un mail de más al dueño.
//    No se le pone la contabilidad de un candado (como sí tiene el aviso a los profesionales)
//    porque un respaldo repetido no hace daño, y un respaldo que NO salió por un candado mal
//    puesto, sí.

import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { enviarEmail, type Mensaje, type ResultadoEnvio } from "../../lib/email.ts";
import { exportarCsv } from "./exportar.ts";
import { nombreDePeriodo, periodoAnterior } from "../../dominio/reporte.ts";

/** La misma forma que espera el envío de liquidaciones: un test le pasa un buzón de mentira. */
export type Enviador = (m: Mensaje) => Promise<ResultadoEnvio>;

export type ResultadoRespaldo = {
  /** El mes que se respaldó (el anterior a hoy). */
  periodo: string;
  /** A qué casilla se mandó. */
  destino: string;
  enviado: boolean;
  /** Por qué no salió, si no salió. */
  motivo?: string;
  /** Tamaño de los dos adjuntos juntos, en bytes: para ver de un vistazo que no crezca sin control. */
  bytes: number;
};

/** No hizo nada, y por qué. Se distingue de "salió" y de "falló al mandar". */
export type SinRespaldar = { corrio: false; motivo: "no_es_el_dia" | "sin_administrador" | "sin_datos" };

/** El día del mes viene al final de una fecha local `AAAA-MM-DD`. El primero es el que respalda. */
function esPrimeroDeMes(hoy: string): boolean {
  return hoy.slice(8, 10) === "01";
}

/** Excel abre un CSV sin BOM como Latin-1 y rompe los acentos. Pegado al frente, lo lee como UTF-8.
 *  En la descarga desde la app esto lo resuelve el header HTTP; un archivo adjunto no tiene header. */
function conBom(csv: string): string {
  return "﻿" + csv;
}

/** Un CSV de texto a base64, que es como viaja pegado al mail. */
function aBase64(texto: string): string {
  return Buffer.from(texto, "utf8").toString("base64");
}

export async function respaldoMensual(
  a: { operadorId: string; hoy: string; forzar?: boolean },
  db: PrismaClient = prisma,
  mandar: Enviador = enviarEmail,
): Promise<ResultadoRespaldo | SinRespaldar> {
  // El cron dispara todos los días; el que sabe qué día corresponde es este módulo.
  if (!a.forzar && !esPrimeroDeMes(a.hoy)) return { corrio: false, motivo: "no_es_el_dia" };

  // El primero de septiembre se respalda agosto: el mes que ya cerró.
  const periodo = periodoAnterior(a.hoy.slice(0, 7));

  // El destinatario es el administrador del centro. No es una constante ni una variable de entorno:
  // es quien figura como dueño en la base, así que si mañana cambia, el respaldo lo sigue.
  const membresia = await db.usuarioOperador.findFirst({
    where: { operadorId: a.operadorId, rol: "owner", activo: true },
    select: { usuario: { select: { email: true, nombre: true } } },
  });
  const destino = membresia?.usuario.email?.trim();
  if (!destino) return { corrio: false, motivo: "sin_administrador" };

  const [movimientos, turnos, operador] = await Promise.all([
    exportarCsv({ operadorId: a.operadorId, periodo, que: "movimientos" }, db),
    exportarCsv({ operadorId: a.operadorId, periodo, que: "turnos" }, db),
    db.operador.findUniqueOrThrow({ where: { id: a.operadorId }, select: { nombre: true } }),
  ]);
  // `exportarCsv` devuelve null solo si el período es inválido o el centro no tiene sede activa.
  // Ninguno debería pasar acá, pero si pasa no se manda un adjunto vacío que aparente un respaldo.
  if (movimientos === null || turnos === null) {
    return { corrio: false, motivo: "sin_datos" };
  }

  const adjuntos = [
    { nombre: `emoapp-movimientos-${periodo}.csv`, contenidoBase64: aBase64(conBom(movimientos)), tipo: "text/csv" },
    { nombre: `emoapp-turnos-${periodo}.csv`, contenidoBase64: aBase64(conBom(turnos)), tipo: "text/csv" },
  ];
  const bytes = movimientos.length + turnos.length;
  const cuando = nombreDePeriodo(periodo);

  const asunto = `Respaldo EMOAPP — ${cuando}`;
  const texto = [
    `Respaldo mensual de ${operador.nombre}.`,
    "",
    `Van adjuntos los dos CSV de ${cuando}, el mes que acaba de cerrar:`,
    "· movimientos: cada cargo y cada pago, para cruzar con el contador o reconstruir la plata.",
    "· turnos: cada reserva, con profesional, consultorio, horario e importe.",
    "",
    "Este correo se manda solo, el primero de cada mes. Guardalo: es tu copia de los números",
    "fuera de la base de datos. No hace falta que contestes nada.",
    "",
    "Espacio Montes de Oca",
  ].join("\n");
  const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px;background:#f4f9fb;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#0f2c3f">
  <table role="presentation" style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #dbe8ee;border-radius:12px">
    <tr><td style="padding:28px">
      <p style="margin:0 0 14px;font-size:16px;font-weight:600">Respaldo mensual — ${escapar(cuando)}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5">
        Van adjuntos los dos CSV de <b>${escapar(cuando)}</b>, el mes que acaba de cerrar:
      </p>
      <ul style="margin:0 0 16px;padding-left:20px;font-size:14px;line-height:1.6;color:#33505f">
        <li><b>movimientos</b>: cada cargo y cada pago, para cruzar con el contador o reconstruir la plata.</li>
        <li><b>turnos</b>: cada reserva, con profesional, consultorio, horario e importe.</li>
      </ul>
      <p style="margin:0;font-size:13px;color:#5c7382;line-height:1.5">
        Este correo se manda solo, el primero de cada mes. Guardalo: es tu copia de los números
        fuera de la base de datos.
      </p>
    </td></tr>
  </table>
</body></html>`;

  const r = await mandar({ para: destino, asunto, html, texto, adjuntos });
  return { periodo, destino, enviado: r.ok, motivo: r.ok ? undefined : r.motivo, bytes };
}

/** Escape mínimo para meter texto en el HTML del mail. */
function escapar(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
