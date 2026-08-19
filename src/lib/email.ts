// src/lib/email.ts — mandar un mail. Hoy hay uno solo: el de restablecer contraseña.
//
// Hay DOS formas de salir, y la app soporta las dos porque responden a dos situaciones distintas:
//
//  · SMTP (Gmail, típicamente). No necesita dominio propio: el correo sale de una casilla que ya
//    existe y que Google ya verificó. Es la salida de un centro que todavía no compró un dominio.
//  · Resend. Necesita un dominio verificado, y a cambio el mail sale de una dirección del centro
//    (no-responder@…), que es lo que corresponde cuando el centro tiene identidad propia.
//
// Conviven a propósito. Empezar por Gmail y mudarse a Resend el día que haya dominio tiene que ser
// cambiar variables de entorno, no reescribir código: si soportáramos una sola, esa migración
// sería una excusa para no hacerla.
//
// Si están las dos configuradas gana Resend, que es la de mejor identidad.
//
// Y EL ENVÍO PUEDE NO ESTAR CONFIGURADO, que no es un error del programa: hasta que alguien cargue
// las variables, la app corre igual. Lo que NO se hace es fingir que se mandó — el resultado dice
// `sin_configurar` y la pantalla lo cuenta, porque un usuario esperando un mail que nunca sale es
// peor que un mensaje que dice "esto todavía no está enchufado".

export type ResultadoEnvio =
  | { ok: true; via: "resend" | "smtp" }
  | { ok: false; motivo: "sin_configurar" | "rechazado"; detalle?: string };

/** Puerto 465 = TLS desde el saludo. Cualquier otro (587, el de Gmail) = STARTTLS. */
const PUERTO_TLS_DIRECTO = 465;
const SMTP_PUERTO_DEFAULT = 587;
const SMTP_HOST_DEFAULT = "smtp.gmail.com";

/** Ninguna operación de red puede colgar el pedido que la disparó. Diez segundos es de sobra para
 *  un SMTP sano y poco para uno que no contesta. */
const TIMEOUT_MS = 10_000;

function configResend(): { clave: string; desde: string } | null {
  const clave = process.env.RESEND_API_KEY;
  const desde = process.env.EMAIL_FROM;
  return clave && desde ? { clave, desde } : null;
}

function configSmtp(): { host: string; puerto: number; usuario: string; clave: string; desde: string } | null {
  const usuario = process.env.SMTP_USER;
  const clave = process.env.SMTP_PASS;
  if (!usuario || !clave) return null;

  const puerto = Number(process.env.SMTP_PORT) || SMTP_PUERTO_DEFAULT;
  return {
    host: process.env.SMTP_HOST || SMTP_HOST_DEFAULT,
    puerto,
    usuario,
    clave,
    // Sin EMAIL_FROM, el remitente es la propia casilla que autentica. No es una comodidad: Gmail
    // REESCRIBE un From que no sea la cuenta autenticada (o uno de sus alias), así que poner otra
    // cosa no la haría aparecer — solo haría que lo que se ve no sea lo que se pidió.
    desde: process.env.EMAIL_FROM || `EMOAPP <${usuario}>`,
  };
}

/** ¿Está configurado el envío? Alcanza con que UNA de las dos vías lo esté. */
export function emailListo(): boolean {
  return Boolean(configResend() || configSmtp());
}

/** Cuál se va a usar. Sirve para que el panel pueda decir por dónde sale el correo sin adivinar. */
export function viaDeEmail(): "resend" | "smtp" | null {
  if (configResend()) return "resend";
  if (configSmtp()) return "smtp";
  return null;
}

export type Mensaje = { para: string; asunto: string; html: string; texto: string };

export async function enviarEmail(a: Mensaje): Promise<ResultadoEnvio> {
  const resend = configResend();
  if (resend) return enviarPorResend(a, resend);

  const smtp = configSmtp();
  if (smtp) return enviarPorSmtp(a, smtp);

  return { ok: false, motivo: "sin_configurar" };
}

/**
 * Resend por `fetch` en vez de su SDK: es un POST con un JSON, y una dependencia más es una
 * superficie más para actualizar y auditar. Misma decisión que con los íconos y los gráficos.
 */
async function enviarPorResend(a: Mensaje, c: { clave: string; desde: string }): Promise<ResultadoEnvio> {
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${c.clave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: c.desde, to: [a.para], subject: a.asunto, html: a.html, text: a.texto }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) return { ok: false, motivo: "rechazado", detalle: `${r.status} ${await r.text()}` };
    return { ok: true, via: "resend" };
  } catch (e) {
    return { ok: false, motivo: "rechazado", detalle: sinSecretos(e) };
  }
}

/**
 * SMTP con nodemailer. Acá SÍ hace falta la librería: SMTP es una conversación sobre un socket,
 * no un POST, y `fetch` no puede hablarlo.
 *
 * El import es DINÁMICO para que quien use Resend no cargue nodemailer nunca.
 */
async function enviarPorSmtp(
  a: Mensaje,
  c: { host: string; puerto: number; usuario: string; clave: string; desde: string },
): Promise<ResultadoEnvio> {
  try {
    const { createTransport } = await import("nodemailer");
    const transporte = createTransport({
      host: c.host,
      port: c.puerto,
      secure: c.puerto === PUERTO_TLS_DIRECTO,
      auth: { user: c.usuario, pass: c.clave },
      // Los tres timeouts, no uno: un servidor puede aceptar la conexión y no saludar nunca, o
      // saludar y colgarse a mitad del mensaje. Sin esto el pedido se queda esperando y el que
      // apretó el botón mira una pantalla trabada.
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
    await transporte.sendMail({ from: c.desde, to: a.para, subject: a.asunto, html: a.html, text: a.texto });
    return { ok: true, via: "smtp" };
  } catch (e) {
    return { ok: false, motivo: "rechazado", detalle: sinSecretos(e) };
  }
}

/**
 * El detalle del error termina en el log del servidor. Los errores de SMTP suelen traer el diálogo
 * completo adentro, y en ese diálogo puede venir la contraseña: se tacha antes de escribirla.
 *
 * Exportada para poder testearla: es una propiedad de seguridad, y una propiedad de seguridad que
 * nadie verifica es una intención.
 */
export function sinSecretos(e: unknown): string {
  const texto = String((e as Error)?.message ?? e);
  const clave = process.env.SMTP_PASS;
  return clave ? texto.split(clave).join("***") : texto;
}

/** El mail de restablecer, en las dos versiones. El enlace es lo único que importa: va grande y solo. */
export function mailDeReset(a: { nombre: string; enlace: string; minutos: number }): { asunto: string; html: string; texto: string } {
  const asunto = "Restablecer tu contraseña de EMOAPP";
  const texto = [
    `Hola ${a.nombre},`,
    "",
    "Pediste restablecer tu contraseña. Abrí este enlace para poner una nueva:",
    a.enlace,
    "",
    `El enlace vence en ${a.minutos} minutos y sirve una sola vez.`,
    "Si no fuiste vos, ignorá este mensaje: tu contraseña sigue igual.",
    "",
    "Espacio Montes de Oca",
  ].join("\n");

  // HTML con estilos EN LÍNEA y tabla: los clientes de correo no aplican hojas de estilo ni
  // entienden flexbox. No es descuido, es lo único que se ve igual en Gmail y en Outlook.
  const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px;background:#f4f9fb;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#0f2c3f">
  <table role="presentation" style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #dbe8ee;border-radius:12px">
    <tr><td style="padding:28px">
      <p style="margin:0 0 14px;font-size:16px">Hola ${escapar(a.nombre)},</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.5">
        Pediste restablecer tu contraseña. Tocá el botón para poner una nueva.
      </p>
      <p style="margin:0 0 20px">
        <a href="${escapar(a.enlace)}" style="display:inline-block;padding:12px 24px;background:#1a8fc1;color:#fff;text-decoration:none;border-radius:999px;font-weight:600">
          Poner una contraseña nueva
        </a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#5c7382">
        El enlace vence en ${a.minutos} minutos y sirve una sola vez.
      </p>
      <p style="margin:0;font-size:13px;color:#5c7382">
        Si no fuiste vos, ignorá este mensaje: tu contraseña sigue igual.
      </p>
    </td></tr>
  </table>
</body></html>`;

  return { asunto, html, texto };
}

/** Escape mínimo para meter texto en el HTML del mail. El nombre lo escribe una persona. */
function escapar(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
