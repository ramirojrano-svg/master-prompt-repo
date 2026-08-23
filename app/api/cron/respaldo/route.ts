// app/api/cron/respaldo/route.ts — el disparador del respaldo mensual.
//
// Gemela de la ruta de liquidaciones, y por las mismas razones: Vercel Cron pega acá todos los
// días, el que decide si hoy corresponde es `respaldoMensual` (el primero de cada mes), y la
// puerta está cerrada con el mismo `CRON_SECRET`. Manda por mail al administrador los CSV del mes
// que cerró; sin la variable configurada se niega a correr en vez de quedar abierta por omisión.
//
// Acepta `?forzar=1` para poder hacer una prueba controlada sin esperar al primero de mes. Es
// seguro porque, a diferencia del aviso a los profesionales, esto le manda un solo correo al
// dueño: forzarlo no le llega a nadie más.

import { prisma } from "../../../../src/db/prisma.ts";
import { respaldoMensual } from "../../../../src/servicios/reportes/respaldo-mensual.ts";
import { fechaEnZona } from "../../../../src/dominio/motor/zona.ts";
import { registrar } from "../../../../src/lib/auditoria.ts";

// Nunca cacheada: el resultado depende del día y de lo que haya en la base.
export const dynamic = "force-dynamic";

/** Comparación en tiempo constante, para no filtrar el secreto por cuánto tarda en fallar. */
function igual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function GET(pedido: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) return Response.json({ error: "CRON_SECRET sin configurar" }, { status: 503 });

  const traido = pedido.headers.get("authorization") ?? "";
  if (!igual(traido, `Bearer ${secreto}`)) return Response.json({ error: "no autorizado" }, { status: 401 });

  const forzar = new URL(pedido.url).searchParams.get("forzar") === "1";

  // Se corre para TODOS los centros: la ruta es del sistema, no de una sesión.
  const operadores = await prisma.operador.findMany({ select: { id: true, nombre: true } });
  const salida: unknown[] = [];

  for (const op of operadores) {
    const sede = await prisma.sede.findFirst({
      where: { operadorId: op.id, activa: true },
      select: { zonaHoraria: true },
    });
    // El día es el del CENTRO, no el del servidor: a las 21 de Buenos Aires en Vercel ya es el día
    // siguiente en UTC, y el respaldo saldría el 2 —o el 31 del mes anterior— en vez del 1.
    const hoy = fechaEnZona(new Date(), sede?.zonaHoraria ?? "UTC");

    const r = await respaldoMensual({ operadorId: op.id, hoy, forzar });
    salida.push({ centro: op.nombre, ...r });

    // Solo un respaldo que NO salió cuenta como rechazo. El "hoy no toca" de todos los días se
    // asienta como ok con su motivo en el resumen: si se marcara rechazo, la vista de auditoría
    // —que por defecto muestra solo rechazos— quedaría tapada de no-eventos diarios y enterraría
    // los rechazos que sí importan (un login fallido, un permiso negado).
    const fallo = !("corrio" in r) && !r.enviado;
    await registrar({
      actor: { usuarioId: "cron", operadorId: op.id, rol: "owner", inquilinoId: null },
      permiso: "datos.exportar",
      resultado: fallo ? "RECHAZADO" : "ok",
      resumen: "corrio" in r
        ? r.motivo
        : `${r.periodo} -> ${r.destino}${r.enviado ? ` (${r.bytes} bytes)` : ` no salió: ${r.motivo}`}`,
    });
  }

  return Response.json({ ok: true, centros: salida });
}
