// app/l/[token]/route.ts — la liquidación en PDF, para el profesional que la recibió.
//
// Es la ÚNICA ruta de la app que responde sin sesión, y por eso la dirección es corta y vive
// afuera de `/panel`: lo que llega por WhatsApp se ve entero en la burbuja del mensaje, y un link
// de ciento veinte caracteres se corta y da desconfianza.
//
// La autorización es el token y nada más: una firma HMAC sobre el id del documento y su
// vencimiento (ver `enlace-firmado.ts`). No crea sesión, no toca cookies y no sirve para nada que
// no sea ESE PDF — si el token no verifica, la respuesta es la misma 404 que para un id que no
// existe, porque distinguirlas confirmaría cuáles existen (§6.11).
//
// `inline` y no `attachment`: el que lo recibe por WhatsApp lo quiere MIRAR, y el visor del
// teléfono abre el PDF en pantalla en vez de dejarlo en Descargas. La ruta del panel sigue
// bajándolo, que es lo que corresponde cuando uno lo pide desde el escritorio.

import { prisma } from "../../../src/db/prisma.ts";
import { verificarEnlace } from "../../../src/lib/enlace-firmado.ts";
import { detalleDeLiquidacion } from "../../../src/servicios/plata/detalle-liquidacion.ts";
import { datosDeCobro } from "../../../src/servicios/config/cobro.ts";
import { nombreDelArchivo, pdfDeLiquidacion } from "../../../src/servicios/plata/liquidacion-pdf.ts";

export const dynamic = "force-dynamic";

/** Una sola respuesta para todo lo que no abre: inválido, vencido e inexistente se ven igual. */
function noHayNada() {
  return new Response("No encontrado", { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_pedido: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  const v = verificarEnlace(token);
  if (!v.ok) return noHayNada();

  // El operador sale del propio documento, no de una sesión que no hay. El token ya dijo CUÁL es,
  // así que no hay nada que elegir: se lee ese y se arma con sus datos.
  const liq = await prisma.liquidacion.findUnique({
    where: { id: v.id },
    select: { id: true, operadorId: true },
  });
  if (!liq) return noHayNada();

  const d = await detalleDeLiquidacion({ operadorId: liq.operadorId, liquidacionId: liq.id });
  if (!d) return noHayNada();

  const cobro = await datosDeCobro(liq.operadorId);
  const pdf = pdfDeLiquidacion(d, cobro);

  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${nombreDelArchivo(d)}"`,
      // Ni el navegador ni un proxy guardan copia: el papel lleva CUIT, CBU y el nombre de una
      // persona.
      "Cache-Control": "no-store, private",
      // No es una página: que nadie la indexe ni la liste.
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
