// src/servicios/plata/envio-mensual.ts — el aviso del mes, solo.
//
// El último día hábil de agosto, cada profesional recibe en su casilla lo que va a pagar por
// SEPTIEMBRE. Este centro cobra a mes entrante: se paga por las horas reservadas, antes de usarlas.
//
// La tarea hace las dos cosas en orden, porque una sin la otra no sirve:
//  1. CIERRA el mes que viene — emite la liquidación de cada profesional con cargos pendientes.
//  2. MANDA cada liquidación a la casilla del profesional.
//
// Tres decisiones que la hacen segura para dejarla corriendo sola:
//
//  · Es IDEMPOTENTE. Cerrar dos veces el mismo mes es imposible por el unique de la base, y a
//    quien ya se le mandó no se le manda de nuevo (queda registrado con `avisadaEl`). Si el cron
//    se dispara dos veces, o si alguien la corre a mano después, no llegan mails repetidos.
//  · Un fallo NO frena al resto. Veintinueve mails son veintinueve intentos independientes: que
//    la casilla de uno rebote no puede dejar sin aviso a los otros veintiocho.
//  · Solo corre el día que corresponde, y eso lo decide ESTE módulo y no el cron. Vercel dispara
//    todos los días a la misma hora; acá se pregunta si hoy es el último hábil. Un cron con la
//    fecha adentro no se puede probar y no se puede leer.

import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { esUltimoHabil } from "../../dominio/habiles.ts";
import { periodoSiguiente } from "../../dominio/reporte.ts";
import { enviarEmail } from "../../lib/email.ts";
import { cerrarPeriodo } from "./liquidacion.ts";
import { detalleDeLiquidacion } from "./detalle-liquidacion.ts";
import { datosDeCobro } from "../config/cobro.ts";
import { mailDeLiquidacion, type Enviador } from "./mail-liquidacion.ts";
import { seLeFactura } from "./facturable.ts";
import { nombreSinEspecialidad } from "../../dominio/perfil.ts";
import { purgarAuditoria } from "../../lib/auditoria.ts";
import { purgarFrenos } from "../../lib/freno.ts";

export type ResultadoEnvioMensual = {
  /** Cuánto tardó la corrida, en milisegundos. Es lo que dice si el bucle se está acercando al
   *  límite de la función antes de que lo choque de verdad. */
  msTardo: number;
  /** Filas viejas que se limpiaron de paso. */
  purgado: { auditoria: number; frenos: number };
  /** El mes que se facturó. */
  periodo: string;
  /** Liquidaciones emitidas en esta corrida (las que ya existían no se recuentan). */
  emitidas: number;
  enviadas: number;
  /** Tenían liquidación pero no se les pudo mandar, con el motivo. */
  fallidas: { nombre: string; motivo: string }[];
  /** Ya habían sido avisados antes: la corrida no hizo nada con ellos. */
  yaAvisadas: number;
};

/** No es el día: se contesta sin tocar nada. Se distingue de "corrió y no hizo nada". */
export type SinCorrer = { corrio: false; motivo: "no_es_el_dia" };

export async function envioMensual(
  a: { operadorId: string; hoy: string; forzar?: boolean },
  db: PrismaClient = prisma,
  mandar: Enviador = enviarEmail,
): Promise<ResultadoEnvioMensual | SinCorrer> {
  // El cron dispara todos los días; el que sabe qué día corresponde es este módulo.
  if (!a.forzar && !esUltimoHabil(a.hoy)) return { corrio: false, motivo: "no_es_el_dia" };

  // A mes entrante: hoy es 31 de agosto, se factura septiembre.
  const periodo = periodoSiguiente(a.hoy.slice(0, 7));

  const [operador, cobro, inquilinos] = await Promise.all([
    db.operador.findUniqueOrThrow({ where: { id: a.operadorId }, select: { nombre: true, cobroDiaVencimiento: true } }),
    datosDeCobro(a.operadorId, db),
    db.inquilino.findMany({
      where: { operadorId: a.operadorId, estado: { not: "baja" } },
      select: { id: true, nombre: true, pagador: true, email: true },
    }),
  ]);

  const venceEl = new Date(`${periodo}-${String(operador.cobroDiaVencimiento).padStart(2, "0")}T12:00:00.000Z`);
  const arranque = Date.now();
  const resultado: ResultadoEnvioMensual = {
    periodo, emitidas: 0, enviadas: 0, fallidas: [], yaAvisadas: 0,
    msTardo: 0, purgado: { auditoria: 0, frenos: 0 },
  };

  for (const inq of inquilinos) {
    // A quien no se le factura no se le emite nada: no hay plata que reclamarle.
    if (!(await seLeFactura(db, a.operadorId, inq.id))) continue;

    // Cerrar es idempotente por (centro, profesional, mes): si ya estaba cerrado, devuelve
    // YA_LIQUIDADO y se sigue igual, porque igual hay que mandarlo.
    const cierre = await cerrarPeriodo(
      {
        operadorId: a.operadorId,
        inquilinoId: inq.id,
        periodo,
        alicuotaDecimas: 0,
        venceEl,
        receptorRazonSocial: nombreSinEspecialidad(inq.pagador?.trim() || inq.nombre),
        receptorCondIva: "no informada",
      },
      db,
    );
    if (cierre.ok) resultado.emitidas++;

    const liq = await db.liquidacion.findFirst({
      where: { operadorId: a.operadorId, inquilinoId: inq.id, periodo },
      select: { id: true, avisadaEl: true },
    });
    // Sin liquidación no hay nada que mandar: el mes no tenía cargos para este profesional.
    if (!liq) continue;
    // Ya avisado: la garantía de que un segundo disparo del cron no manda dos veces lo mismo.
    if (liq.avisadaEl) {
      resultado.yaAvisadas++;
      continue;
    }

    const para = inq.email?.trim();
    if (!para) {
      resultado.fallidas.push({ nombre: inq.nombre, motivo: "sin email cargado" });
      continue;
    }

    // Cada mail, en su propio try: que la casilla de uno rebote no puede dejar sin aviso a los
    // otros veintiocho.
    try {
      const d = await detalleDeLiquidacion({ operadorId: a.operadorId, liquidacionId: liq.id }, db);
      if (!d) continue;
      const r = await mandar({ para, ...mailDeLiquidacion(d, cobro, operador.nombre) });
      if (!r.ok) {
        resultado.fallidas.push({ nombre: inq.nombre, motivo: r.motivo });
        continue;
      }
      // Se sella DESPUÉS de que el envío salió bien. Al revés, un fallo dejaría la liquidación
      // marcada como avisada y nadie volvería a intentarlo.
      await db.liquidacion.update({ where: { id: liq.id }, data: { avisadaEl: new Date() } });
      resultado.enviadas++;
    } catch (e) {
      resultado.fallidas.push({ nombre: inq.nombre, motivo: (e as Error)?.message ?? "error" });
    }
  }

  // La limpieza va acá y no en una tarea aparte: es una vez por mes, y una tarea más es una cosa
  // más que puede dejar de correr sin que nadie lo note.
  try {
    resultado.purgado.auditoria = await purgarAuditoria(db, new Date(a.hoy));
    resultado.purgado.frenos = await purgarFrenos(db, new Date(a.hoy));
  } catch (e) {
    // Que falle la limpieza no puede voltear el envío: los avisos son el objetivo, esto es aseo.
    console.error("[envio-mensual] no se pudo purgar:", (e as Error)?.message ?? e);
  }

  resultado.msTardo = Date.now() - arranque;
  return resultado;
}
