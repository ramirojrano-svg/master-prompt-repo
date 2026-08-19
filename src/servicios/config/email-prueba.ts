// src/servicios/config/email-prueba.ts — mandar un mail de prueba desde el panel.
//
// Existe porque "no llega el mail" es de los problemas más difíciles de diagnosticar a ciegas: el
// circuito real (pedir reset) contesta lo MISMO exista o no el email, a propósito, para no
// convertirse en un padrón. Esa opacidad es correcta de cara a internet y pésima para el que está
// configurando la instalación, que necesita justamente el detalle.
//
// Acá se invierte: es una acción del administrador sobre SU PROPIA casilla, así que puede devolver
// el error crudo del proveedor —"401 clave inválida", "403 dominio no verificado"— que es lo único
// que dice qué hay que corregir.
//
// El destino NO se elige: va siempre al mail del que aprieta el botón. Un formulario con un campo
// "para" sería un relay abierto: cualquiera con acceso al panel podría mandar correo con la
// identidad del centro a donde quisiera.

import { z } from "zod";
import { definirAccion } from "../../lib/accion.ts";
import { enviarEmail, viaDeEmail } from "../../lib/email.ts";
import type { Actor } from "../../lib/actor.ts";

export const EmailPruebaInput = z.object({ para: z.string().trim().toLowerCase().email() });

export type ResultadoPrueba =
  | { ok: true; via: "resend" | "smtp" }
  | { ok: false; motivo: "sin_configurar" | "rechazado"; detalle?: string };

async function probar(_actor: Actor, input: z.infer<typeof EmailPruebaInput>): Promise<ResultadoPrueba> {
  const via = viaDeEmail();
  if (!via) return { ok: false, motivo: "sin_configurar" };

  const cuando = new Date().toLocaleString("es-AR");
  const r = await enviarEmail({
    para: input.para,
    asunto: "Prueba de envío de EMOAPP",
    texto: [
      "Si estás leyendo esto, el envío de correos de EMOAPP funciona.",
      "",
      `Salió por: ${via}.`,
      `Enviado: ${cuando}.`,
      "",
      "Ya podés avisarles a los profesionales que pueden usar '¿Olvidaste tu contraseña?'.",
    ].join("\n"),
    html: `<div style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#0f2c3f;line-height:1.5">
      <p style="font-size:16px;margin:0 0 12px"><b>El envío de correos funciona.</b></p>
      <p style="margin:0 0 8px">Salió por <b>${via}</b>, el ${cuando}.</p>
      <p style="margin:0;color:#5c7382;font-size:13px">
        Ya podés avisarles a los profesionales que pueden usar “¿Olvidaste tu contraseña?”.
      </p>
    </div>`,
  });

  return r.ok ? { ok: true, via: r.via } : { ok: false, motivo: r.motivo, detalle: r.detalle };
}

/** Configurar el envío de correo es parte de administrar el acceso de la gente a la app. */
export const mandarEmailDePrueba = definirAccion(
  { permiso: "usuarios.administrar", schema: EmailPruebaInput },
  probar,
);
