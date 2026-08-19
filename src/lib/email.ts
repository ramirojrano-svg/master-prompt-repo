// src/lib/email.ts — mandar un mail. Hoy hay uno solo: el de restablecer contraseña.
//
// Se habla con la API de Resend por `fetch` en vez de sumar su SDK: es un POST con un JSON, y una
// dependencia más es una superficie más para actualizar y auditar. Misma decisión que con los
// íconos y los gráficos.
//
// EL ENVÍO PUEDE NO ESTAR CONFIGURADO, y eso no es un error del programa: hasta que alguien cargue
// RESEND_API_KEY y EMAIL_FROM, la app corre igual. Lo que NO se hace es fingir que se mandó — el
// resultado dice `sin_configurar` y la pantalla lo cuenta, porque un usuario esperando un mail que
// nunca sale es peor que un mensaje que dice "esto todavía no está enchufado".

export type ResultadoEnvio =
  | { ok: true }
  | { ok: false; motivo: "sin_configurar" | "rechazado"; detalle?: string };

/** ¿Está configurado el envío? Se decide por la presencia de las dos variables, como Google. */
export function emailListo(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function enviarEmail(a: { para: string; asunto: string; html: string; texto: string }): Promise<ResultadoEnvio> {
  const clave = process.env.RESEND_API_KEY;
  const desde = process.env.EMAIL_FROM;
  if (!clave || !desde) return { ok: false, motivo: "sin_configurar" };

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${clave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: desde,
        to: [a.para],
        subject: a.asunto,
        html: a.html,
        // La versión en texto no es decoración: sin ella los filtros de correo puntúan peor el
        // mensaje, y este es justo el mail que NO puede caer en spam.
        text: a.texto,
      }),
    });
    if (!r.ok) return { ok: false, motivo: "rechazado", detalle: `${r.status} ${await r.text()}` };
    return { ok: true };
  } catch (e) {
    // Un fallo de red no puede tumbar la pantalla que lo pidió: se informa y quien llama decide.
    return { ok: false, motivo: "rechazado", detalle: String((e as Error)?.message ?? e) };
  }
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
