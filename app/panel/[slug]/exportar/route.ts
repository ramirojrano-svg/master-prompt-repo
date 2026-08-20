// app/panel/[slug]/exportar/route.ts — bajarse los datos del mes en CSV.
//
// Es una ruta y no una pantalla porque lo que devuelve es un archivo: el navegador lo baja y se
// abre en Excel. Acá solo está lo que la ruta tiene que decidir —quién puede, qué pidió, y con qué
// nombre baja—; el contenido lo arma `exportarCsv`, que sí se puede testear.

import { redirect } from "next/navigation";
import { actorDeSesion } from "../../../../src/lib/sesion.ts";
import { puede } from "../../../../src/lib/permisos.ts";
import { exportarCsv, queExportar } from "../../../../src/servicios/reportes/exportar.ts";
import { registrar } from "../../../../src/lib/auditoria.ts";

export async function GET(pedido: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const url = new URL(pedido.url);
  const periodo = url.searchParams.get("periodo") ?? "";
  const que = queExportar(url.searchParams.get("que"));

  const actor = await actorDeSesion(slug);
  if (!actor) redirect(`/login?centro=${encodeURIComponent(slug)}`);
  // Bajarse la plata del centro entero es lo mismo que verla: el mismo permiso que Negocio. Un
  // profesional no exporta nada — ni siquiera lo suyo — porque el archivo sale del centro.
  if (!puede(actor.rol, "finanzas.ver.agregada")) {
    await registrar({ actor, permiso: "datos.exportar", resultado: "SIN_PERMISO", resumen: `${que} de ${periodo}` });
    redirect(`/panel/${slug}`);
  }

  const csv = await exportarCsv({ operadorId: actor.operadorId, periodo, que });
  if (csv === null) return new Response("Período inválido", { status: 400 });

  // Bajarse la plata del centro queda registrado: es una salida de datos, y quién se los llevó es
  // parte de lo que hay que poder contestar.
  await registrar({ actor, permiso: "datos.exportar", resultado: "ok", resumen: `${que} de ${periodo}` });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // `attachment` para que baje en vez de mostrarse; el nombre lleva el mes, que es lo que uno
      // busca cuando tiene doce de estos en la carpeta de descargas.
      "Content-Disposition": `attachment; filename="emoapp-${que}-${periodo}.csv"`,
      // Nunca cacheado: son datos de plata y cambian todo el tiempo.
      "Cache-Control": "no-store",
    },
  });
}
