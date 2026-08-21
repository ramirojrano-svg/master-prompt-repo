// app/api/cron/liquidaciones/route.ts — el disparador del envío mensual.
//
// Vercel Cron pega acá todos los días. El que decide si hoy corresponde mandar es `envioMensual`,
// no el cron: la fecha metida en la expresión del cron no se puede probar ni leer, y "el último
// día hábil" no es un día fijo del mes — en mayo de 2026 el 31 cae domingo y el que vale es el 29.
//
// Devuelve con `Response.json` y no con `NextResponse`: no hace falta nada propio de Next para
// mandar un JSON, y depender de `next/server` volvía la ruta imposible de probar sin levantar el
// framework entero — que es como una puerta termina sin una sola prueba.
//
// AUTENTICACIÓN. Esta ruta manda mails a veintinueve personas, así que no puede quedar abierta a
// quien adivine la URL. Vercel manda `Authorization: Bearer $CRON_SECRET` en cada disparo; sin esa
// variable configurada la ruta se niega a correr, en vez de quedar abierta por omisión — que es
// como se filtra una función que nadie miró.

import { prisma } from "../../../../src/db/prisma.ts";
import { envioMensual } from "../../../../src/servicios/plata/envio-mensual.ts";
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
  // Sin secreto configurado NO corre. Abierta por omisión sería una ruta que manda mails a
  // veintinueve personas y solo hace falta saber su nombre.
  if (!secreto) return Response.json({ error: "CRON_SECRET sin configurar" }, { status: 503 });

  const traido = pedido.headers.get("authorization") ?? "";
  if (!igual(traido, `Bearer ${secreto}`)) return Response.json({ error: "no autorizado" }, { status: 401 });

  // Se corre para TODOS los centros: la ruta es del sistema, no de una sesión, así que no hay un
  // operador "actual" del que colgarse.
  const operadores = await prisma.operador.findMany({ select: { id: true, nombre: true } });
  const salida: unknown[] = [];

  for (const op of operadores) {
    const sede = await prisma.sede.findFirst({
      where: { operadorId: op.id, activa: true },
      select: { zonaHoraria: true },
    });
    // El día es el del CENTRO, no el del servidor: a las 21 de Buenos Aires en Vercel ya es el día
    // siguiente en UTC, y el aviso saldría un mes tarde o un día antes.
    const hoy = fechaEnZona(new Date(), sede?.zonaHoraria ?? "UTC");

    const r = await envioMensual({ operadorId: op.id, hoy });
    salida.push({ centro: op.nombre, ...r });

    // Queda registrado incluso cuando no corresponde correr: el día que alguien pregunte "¿por
    // qué no salieron los avisos?", lo primero que hay que poder contestar es si el cron llegó.
    await registrar({
      actor: { usuarioId: "cron", operadorId: op.id, rol: "owner", inquilinoId: null },
      permiso: "periodo.cerrar",
      resultado: "corrio" in r ? "no_es_el_dia" : "ok",
      resumen: "corrio" in r ? `${hoy}` : `${r.periodo}: ${r.enviadas} enviadas, ${r.fallidas.length} fallidas`,
    });
  }

  return Response.json({ ok: true, centros: salida });
}
