// src/servicios/plata/mail-liquidacion.ts — mandarle la cuenta del mes al profesional.
//
// Cerrar el mes emite el documento; esto es lo que lo pone en la casilla del profesional. Hasta
// acá el circuito terminaba con alguien bajando un PDF y mandándolo a mano por WhatsApp.
//
// Uno por uno y a pedido, nunca al cerrar. Cerrar es un acto contable que se puede repetir sin
// consecuencias; mandar un mail no se deshace, y un cierre hecho por error mandaría veintinueve.
// Por eso el envío es un botón aparte, y el botón dice a qué dirección va antes de tocarlo.
//
// El mail lleva el mismo contenido que el papel —horas del mes, detalle día por día, total,
// vencimiento y a dónde transferir— en HTML y en texto plano. El texto plano no es un adorno de
// compatibilidad: es lo que se ve en la previsualización del teléfono y lo que queda si el cliente
// bloquea el HTML.

import { z } from "zod";
import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { definirAccion } from "../../lib/accion.ts";
import type { Actor } from "../../lib/actor.ts";
import { enviarEmail, type Mensaje } from "../../lib/email.ts";
import { detalleDeLiquidacion, type DetalleLiquidacion } from "./detalle-liquidacion.ts";
import { datosDeCobro, hayDatosDeCobro, type DatosDeCobro } from "../config/cobro.ts";
import { formatearPesos } from "../../dominio/tarifa.ts";
import { horasYMinutos, nombreDePeriodo } from "../../dominio/reporte.ts";

/** Escapa lo que va dentro del HTML. Un nombre con `&` o `<` no puede romper el mail. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const dia = (d: Date) => d.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" });
const fechaLarga = (d: Date) => d.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });

/** Las líneas "a dónde transferir", una por renglón. Se arma una vez y se usa en HTML y en texto. */
function lineasDeCobro(c: DatosDeCobro): string[] {
  const l: string[] = [];
  if (c.titular) l.push(`Titular: ${c.titular}`);
  if (c.cuit) l.push(`CUIT: ${c.cuit}`);
  if (c.banco) l.push(`Banco: ${c.banco}`);
  if (c.alias) l.push(`Alias: ${c.alias}`);
  if (c.cbu) l.push(`CBU/CVU: ${c.cbu}`);
  if (c.nota) l.push(c.nota);
  return l;
}

/**
 * Arma el mail. Separado del envío para poder mirarlo en un test sin tocar la red: lo que puede
 * salir mal en un mail —un importe mal, el detalle de otro mes, el nombre del de al lado— no lanza
 * ningún error, solo llega mal a alguien.
 */
export function mailDeLiquidacion(d: DetalleLiquidacion, cobro: DatosDeCobro, centro: string): Omit<Mensaje, "para"> {
  const plata = (n: bigint) => formatearPesos(n, d.moneda);
  const mes = nombreDePeriodo(d.periodo);
  const cobroLineas = d.totalCent > 0n && hayDatosDeCobro(cobro) ? lineasDeCobro(cobro) : [];

  const asunto = `${centro} · Consultorios de ${mes} · ${plata(d.totalCent)}`;

  const resumen = d.sesiones > 0
    ? `Para ${mes} reservaste ${horasYMinutos(d.minutosUsados)} de consultorio, en ${d.sesiones} ${d.sesiones === 1 ? "sesión" : "sesiones"}.`
    : `Liquidación de ${mes}.`;

  const filas = d.lineas.map((l) => ({ f: dia(l.fecha), q: l.detalle, i: plata(l.montoCent) }));

  const texto = [
    `Hola ${d.receptor},`,
    "",
    resumen,
    "",
    `Total del mes: ${plata(d.totalCent)}`,
    `Vence el ${fechaLarga(d.venceEl)}.`,
    "",
    ...(cobroLineas.length ? ["Para transferir:", ...cobroLineas.map((x) => `  ${x}`), ""] : []),
    "Detalle:",
    ...filas.map((r) => `  ${r.f}  ${r.q}  ${r.i}`),
    "",
    centro,
  ].join("\n");

  // HTML con estilos EN LÍNEA: los clientes de correo descartan las hojas de estilo, así que un
  // <style> en la cabecera se pierde y el mail llega sin formato.
  const html = `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#12303d;max-width:620px;line-height:1.55">
  <p style="margin:0 0 14px">Hola ${esc(d.receptor)},</p>
  <p style="margin:0 0 18px">${esc(resumen)}</p>

  <table style="border-collapse:collapse;width:100%;margin:0 0 18px">
    <tr><td style="padding:6px 0;color:#5c7382">Total del mes</td><td style="padding:6px 0;text-align:right;font-weight:600;font-size:19px">${esc(plata(d.totalCent))}</td></tr>
    <tr><td style="padding:6px 0;color:#5c7382">Vence el</td><td style="padding:6px 0;text-align:right">${esc(fechaLarga(d.venceEl))}</td></tr>
  </table>

  ${cobroLineas.length ? `<div style="background:#f4f9fb;border:1px solid #dbe8ee;border-radius:10px;padding:14px 16px;margin:0 0 18px">
    <p style="margin:0 0 8px;font-weight:600">Para transferir</p>
    ${cobroLineas.map((x) => `<p style="margin:2px 0;font-size:14px">${esc(x)}</p>`).join("")}
  </div>` : ""}

  <p style="margin:0 0 6px;font-weight:600">Detalle</p>
  <table style="border-collapse:collapse;width:100%;font-size:14px">
    ${filas.map((r) => `<tr>
      <td style="padding:6px 8px 6px 0;border-bottom:1px solid #eef4f7;white-space:nowrap;color:#5c7382">${esc(r.f)}</td>
      <td style="padding:6px 8px 6px 0;border-bottom:1px solid #eef4f7">${esc(r.q)}</td>
      <td style="padding:6px 0;border-bottom:1px solid #eef4f7;text-align:right;white-space:nowrap">${esc(r.i)}</td>
    </tr>`).join("")}
  </table>

  <p style="margin:18px 0 0;font-size:12px;color:#5c7382">${esc(centro)}</p>
</div>`.trim();

  return { asunto, html, texto };
}

export const EnviarInput = z.object({ liquidacionId: z.string().min(1) });

export type ResultadoEnvioLiq =
  | { ok: true; para: string }
  | { ok: false; error: "NO_ENCONTRADA" | "SIN_EMAIL" | "SIN_CONFIGURAR" | "FALLO_ENVIO" };

/** El sender se inyecta para poder testear el circuito entero sin mandar un mail de verdad. */
export type Enviador = typeof enviarEmail;

async function enviar(
  actor: Actor,
  input: z.infer<typeof EnviarInput>,
  db: PrismaClient,
  mandar: Enviador,
): Promise<ResultadoEnvioLiq> {
  const d = await detalleDeLiquidacion({ operadorId: actor.operadorId, liquidacionId: input.liquidacionId }, db);
  if (!d) return { ok: false, error: "NO_ENCONTRADA" };

  const [inq, cobro, operador] = await Promise.all([
    db.inquilino.findFirst({ where: { id: d.inquilinoId, operadorId: actor.operadorId }, select: { email: true } }),
    datosDeCobro(actor.operadorId, db),
    db.operador.findUniqueOrThrow({ where: { id: actor.operadorId }, select: { nombre: true } }),
  ]);

  const para = inq?.email?.trim();
  // Sin dirección no se inventa una: mandarlo a la casilla del administrador sería peor que no
  // mandarlo, porque quedaría marcado como enviado y el profesional no se enteró de nada.
  if (!para) return { ok: false, error: "SIN_EMAIL" };

  const r = await mandar({ para, ...mailDeLiquidacion(d, cobro, operador.nombre) });
  if (!r.ok) return { ok: false, error: r.motivo === "sin_configurar" ? "SIN_CONFIGURAR" : "FALLO_ENVIO" };
  return { ok: true, para };
}

const CFG_ENVIAR = {
  permiso: "periodo.cerrar",
  schema: EnviarInput,
  resumen: (i: z.infer<typeof EnviarInput>) => `enviar liquidación ${i.liquidacionId}`,
} as const;

export const enviarLiquidacion = definirAccion(CFG_ENVIAR, (a, i) => enviar(a, i, prisma, enviarEmail));

/** Versión inyectable, para los tests. */
export const enviarLiquidacionCon = (db: PrismaClient, mandar: Enviador) =>
  definirAccion({ ...CFG_ENVIAR, db }, (a, i) => enviar(a, i, db, mandar));
