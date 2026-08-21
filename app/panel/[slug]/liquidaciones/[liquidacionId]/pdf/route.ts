// app/panel/[slug]/liquidaciones/[liquidacionId]/pdf/route.ts — bajar la liquidación.
//
// Es una ruta y no una pantalla porque devuelve un archivo. `Content-Disposition: attachment` es
// lo que hace que el navegador la baje sola en vez de abrirla en una pestaña: tocar el ícono en
// Cierre de mes tiene que dejar el PDF en Descargas y nada más.

import { redirect } from "next/navigation";
import { actorDeSesion } from "../../../../../../src/lib/sesion.ts";
import { puede } from "../../../../../../src/lib/permisos.ts";
import { detalleDeLiquidacion } from "../../../../../../src/servicios/plata/detalle-liquidacion.ts";
import { datosDeCobro } from "../../../../../../src/servicios/config/cobro.ts";
import { nombreDelArchivo, pdfDeLiquidacion } from "../../../../../../src/servicios/plata/liquidacion-pdf.ts";
import { registrar } from "../../../../../../src/lib/auditoria.ts";

export async function GET(_pedido: Request, ctx: { params: Promise<{ slug: string; liquidacionId: string }> }) {
  const { slug, liquidacionId } = await ctx.params;

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);

  const d = await detalleDeLiquidacion({ operadorId: actor.operadorId, liquidacionId });
  // Inexistente y ajena dan lo mismo: distinguirlas confirmaría qué ids existen (§6.11).
  if (!d) redirect(`/panel/${slug}`);

  // El profesional puede bajar LA SUYA: es su cuenta. La del de al lado, no. Misma regla que la
  // pantalla, escrita acá también porque una ruta no hereda el guard de la otra.
  const propia = actor.inquilinoId !== null && actor.inquilinoId === d.inquilinoId;
  if (!puede(actor.rol, "cuenta.ver.todas") && !(propia && puede(actor.rol, "cuenta.ver.propia"))) {
    redirect(`/panel/${slug}`);
  }

  const cobro = await datosDeCobro(actor.operadorId);
  const pdf = pdfDeLiquidacion(d, cobro);

  await registrar({ actor, permiso: "datos.exportar", resultado: "ok", resumen: `pdf de liquidación ${d.periodo}` });

  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nombreDelArchivo(d)}"`,
      // Nunca cacheado: el nombre y los datos de cobro pueden cambiar entre una descarga y otra.
      "Cache-Control": "no-store",
    },
  });
}
