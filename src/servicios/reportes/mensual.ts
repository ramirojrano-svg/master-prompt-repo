// src/servicios/reportes/mensual.ts — el panel de datos del mes (§6.8).
//
// Todo se agrega EN SQL. Nada de findMany + sumar en JS: con `take` de por medio el total sale
// mal y nadie se da cuenta hasta que el contador pregunta (§9). Cada query filtra por
// operadorId explícito.
//
// Dos criterios que el reporte deja escritos porque después nadie se acuerda:
//  · Una reserva cuenta en el mes en que EMPIEZA (una de 23:30 del 31 cuenta en ese mes).
//  · Lo FACTURADO sale del libro de plata (los asientos del período), no de multiplicar horas por
//    precio: si hubo un ajuste, una penalidad o una nota de crédito, el libro los tiene y la
//    multiplicación no.

import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { parseHorarios } from "../../dominio/motor/horarios.ts";
import { diaSemanaDeFecha, fechaEnZona, minutosAHora, rangoDiaEnZona } from "../../dominio/motor/zona.ts";
import { minutosDelDia } from "../../dominio/grilla.ts";
import {
  aperturaDelPeriodoMin,
  diasDelPeriodo,
  esPeriodoValido,
  porcentaje,
  sinDetallar,
} from "../../dominio/reporte.ts";
import type { Actor } from "../../lib/actor.ts";

export type FilaProfesional = {
  id: string;
  nombre: string;
  activo: boolean;
  reservas: number;
  minutos: number;
  /** Lo que se le facturó EN EL PERÍODO (débitos del libro). */
  facturadoCent: bigint;
  /** Lo que pagó en el período (créditos, en positivo). */
  pagadoCent: bigint;
  /** Saldo ACUMULADO al día de hoy, no el del mes: > 0 = debe. */
  saldoCent: bigint;
};

export type FilaSala = {
  id: string;
  nombre: string;
  activa: boolean;
  reservas: number;
  minutos: number;
  aperturaMin: number;
  ocupacionPct: number;
  importeCent: bigint;
};

export type ReporteMensual = {
  periodo: string;
  tz: string;
  moneda: string;
  profesionales: FilaProfesional[];
  salas: FilaSala[];
  totales: {
    facturadoCent: bigint;
    cobradoCent: bigint;
    /** Deuda real: suma SOLO de los saldos positivos. Netear con los que tienen saldo a favor la esconde (§5.6). */
    deudaCent: bigint;
    reservas: number;
    minutos: number;
    aperturaMin: number;
    ocupacionPct: number;
    profesionalesConActividad: number;
  };
  /** Lo que el detalle por profesional no explica del total facturado. Debería ser 0. */
  sinDetallarCent: bigint;
};

// Los estados que representan una hora VENDIDA. El no_show también: la sala estuvo bloqueada y
// (según la política) se cobra igual; sacarlo del reporte esconde plata real.
const ESTADOS_VENDIDOS = ["confirmada", "en_curso", "usada", "no_show"];

type FilaCruda = { id: string; reservas: bigint; minutos: number | null; importe: bigint | null };

export async function reporteMensual(
  a: { actor: Actor; periodo: string },
  db: PrismaClient = prisma,
): Promise<ReporteMensual | null> {
  if (!esPeriodoValido(a.periodo)) return null;

  const sede = await db.sede.findFirst({
    where: { operadorId: a.actor.operadorId, activa: true },
    select: { zonaHoraria: true },
  });
  if (!sede) return null;
  const tz = sede.zonaHoraria;
  const op = a.actor.operadorId;

  // Los bordes del mes se calculan en la zona de la SEDE, no en UTC: si no, el mes de un centro
  // argentino arranca a las 21:00 del 31 anterior y las reservas de esa noche caen en otro mes.
  const dias = diasDelPeriodo(a.periodo);
  const primero = rangoDiaEnZona(dias[0]!, tz);
  const ultimo = rangoDiaEnZona(dias.at(-1)!, tz);
  if (!primero || !ultimo) return null;
  const desde = primero.inicio;
  const hasta = ultimo.fin;

  const [operador, salasTodas, inquilinos, porInquilino, porSala, plataPeriodo, saldos, totalFacturado] =
    await Promise.all([
      db.operador.findUniqueOrThrow({ where: { id: op }, select: { moneda: true } }),

      // Todas, incluidas las archivadas: si tuvieron actividad tienen que aparecer (§3.6).
      db.sala.findMany({
        where: { operadorId: op },
        orderBy: [{ orden: "asc" }, { nombre: "asc" }],
        select: { id: true, nombre: true, activa: true, horarioJson: true },
      }),

      // Todos, incluidos los de baja, por lo mismo.
      db.inquilino.findMany({
        where: { operadorId: op },
        select: { id: true, nombre: true, estado: true },
        orderBy: { nombre: "asc" },
      }),

      // Horas e importe por profesional, agregado por Postgres.
      db.$queryRaw<FilaCruda[]>`
        SELECT o."inquilinoId" AS id,
               COUNT(*) AS reservas,
               COALESCE(SUM(EXTRACT(EPOCH FROM (o."fin" - o."inicio")) / 60), 0)::float8 AS minutos,
               COALESCE(SUM(o."importeCent"), 0)::bigint AS importe
        FROM "Ocupacion" o
        WHERE o."operadorId" = ${op}
          AND o."tipo" = 'reserva'
          AND o."estado"::text = ANY(${ESTADOS_VENDIDOS})
          AND o."inquilinoId" IS NOT NULL
          AND o."inicio" >= ${desde} AND o."inicio" < ${hasta}
        GROUP BY o."inquilinoId"`,

      db.$queryRaw<FilaCruda[]>`
        SELECT o."salaId" AS id,
               COUNT(*) AS reservas,
               COALESCE(SUM(EXTRACT(EPOCH FROM (o."fin" - o."inicio")) / 60), 0)::float8 AS minutos,
               COALESCE(SUM(o."importeCent"), 0)::bigint AS importe
        FROM "Ocupacion" o
        WHERE o."operadorId" = ${op}
          AND o."tipo" = 'reserva'
          AND o."estado"::text = ANY(${ESTADOS_VENDIDOS})
          AND o."salaId" IS NOT NULL
          AND o."inicio" >= ${desde} AND o."inicio" < ${hasta}
        GROUP BY o."salaId"`,

      // Débitos y créditos del período, por profesional. Los dos por separado: un neto esconde
      // que alguien facturó $100.000 y pagó $100.000 el mismo mes.
      db.$queryRaw<{ id: string; debe: bigint; haber: bigint }[]>`
        SELECT "inquilinoId" AS id,
               COALESCE(SUM(CASE WHEN "montoCent" > 0 THEN "montoCent" ELSE 0 END), 0)::bigint AS debe,
               COALESCE(SUM(CASE WHEN "montoCent" < 0 THEN -"montoCent" ELSE 0 END), 0)::bigint AS haber
        FROM "Asiento"
        WHERE "operadorId" = ${op} AND "cuenta" = 'corriente' AND "periodo" = ${a.periodo}
        GROUP BY "inquilinoId"`,

      // Saldo ACUMULADO (todos los períodos): es lo que se le reclama a alguien, no el del mes.
      db.$queryRaw<{ id: string; saldo: bigint }[]>`
        SELECT "inquilinoId" AS id, COALESCE(SUM("montoCent"), 0)::bigint AS saldo
        FROM "Asiento"
        WHERE "operadorId" = ${op} AND "cuenta" = 'corriente'
        GROUP BY "inquilinoId"`,

      // El total, calculado APARTE del detalle: si no coinciden, se muestra la diferencia.
      db.$queryRaw<{ debe: bigint; haber: bigint }[]>`
        SELECT COALESCE(SUM(CASE WHEN "montoCent" > 0 THEN "montoCent" ELSE 0 END), 0)::bigint AS debe,
               COALESCE(SUM(CASE WHEN "montoCent" < 0 THEN -"montoCent" ELSE 0 END), 0)::bigint AS haber
        FROM "Asiento"
        WHERE "operadorId" = ${op} AND "cuenta" = 'corriente' AND "periodo" = ${a.periodo}`,
    ]);

  const ocup = new Map(porInquilino.map((r) => [r.id, r]));
  const mov = new Map(plataPeriodo.map((r) => [r.id, r]));
  const saldo = new Map(saldos.map((r) => [r.id, r.saldo]));

  // La lista arranca de los inquilinos y suma cualquier id que aparezca solo en las agregaciones:
  // un id huérfano no puede hacer que la plata se evapore del reporte.
  const ids = new Set<string>([...inquilinos.map((i) => i.id), ...ocup.keys(), ...mov.keys()]);
  const nombre = new Map(inquilinos.map((i) => [i.id, i.nombre]));

  const profesionales: FilaProfesional[] = [...ids]
    .map((id) => {
      const o = ocup.get(id);
      const m = mov.get(id);
      return {
        id,
        nombre: nombre.get(id) ?? "(profesional dado de baja del sistema)",
        activo: inquilinos.find((i) => i.id === id)?.estado === "activo",
        reservas: Number(o?.reservas ?? 0),
        minutos: Math.round(o?.minutos ?? 0),
        facturadoCent: m?.debe ?? 0n,
        pagadoCent: m?.haber ?? 0n,
        saldoCent: saldo.get(id) ?? 0n,
      };
    })
    // Primero quien más facturó; los que no tuvieron movimiento quedan al final pero NO se filtran.
    .sort((x, y) => Number(y.facturadoCent - x.facturadoCent) || y.minutos - x.minutos || x.nombre.localeCompare(y.nombre, "es"));

  const porSalaMap = new Map(porSala.map((r) => [r.id, r]));
  const salas: FilaSala[] = salasTodas
    .map((s) => {
      const r = porSalaMap.get(s.id);
      const h = parseHorarios(s.horarioJson);
      // Una sala archivada dejó de abrir: su denominador es lo que abrió mientras estuvo activa.
      // Como no guardamos cuándo se archivó por franja, para las archivadas sin actividad el
      // denominador es 0 y el porcentaje no se muestra (mejor un guion que un número inventado).
      const aperturaMin = s.activa
        ? aperturaDelPeriodoMin((d) => h[d as 0 | 1 | 2 | 3 | 4 | 5 | 6].map((f) => ({ desdeMin: hm(f.desde), hastaMin: hm(f.hasta) })), diaSemanaDeFecha, dias)
        : 0;
      const minutos = Math.round(r?.minutos ?? 0);
      return {
        id: s.id,
        nombre: s.nombre,
        activa: s.activa,
        reservas: Number(r?.reservas ?? 0),
        minutos,
        aperturaMin,
        ocupacionPct: porcentaje(minutos, aperturaMin),
        importeCent: r?.importe ?? 0n,
      };
    })
    .filter((s) => s.activa || s.reservas > 0); // la archivada sin actividad ese mes no aporta nada

  const tot = totalFacturado[0] ?? { debe: 0n, haber: 0n };
  const minutosTotal = salas.reduce((acc, s) => acc + s.minutos, 0);
  const aperturaTotal = salas.reduce((acc, s) => acc + s.aperturaMin, 0);

  return {
    periodo: a.periodo,
    tz,
    moneda: operador.moneda,
    profesionales,
    salas,
    totales: {
      facturadoCent: tot.debe,
      cobradoCent: tot.haber,
      deudaCent: profesionales.reduce((acc, p) => acc + (p.saldoCent > 0n ? p.saldoCent : 0n), 0n),
      reservas: salas.reduce((acc, s) => acc + s.reservas, 0),
      minutos: minutosTotal,
      aperturaMin: aperturaTotal,
      ocupacionPct: porcentaje(minutosTotal, aperturaTotal),
      profesionalesConActividad: profesionales.filter((p) => p.reservas > 0).length,
    },
    sinDetallarCent: sinDetallar(tot.debe, profesionales.map((p) => ({ id: p.id, montoCent: p.facturadoCent }))),
  };
}

/** 'HH:MM' → minutos. Local al módulo: un horario mal guardado vale 0, no NaN. */
function hm(s: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

// ── Detalle de UN profesional ───────────────────────────────────────────────
// "Cuántas horas usó, qué días y a qué hora, y cuánto factura": las tres preguntas que el operador
// hace cuando alguien discute su resumen. Se responden con las filas reales, no con un promedio.

export type TurnoDelMes = {
  id: string;
  fecha: string; // 'YYYY-MM-DD' en la zona de la SEDE
  diaSemana: number;
  horaTexto: string; // "09:00 – 10:30"
  /** Para poder mover el turno de sala desde "Mis reservas" sin volver a consultar. */
  salaId: string | null;
  salaNombre: string;
  minutos: number;
  importeCent: bigint | null; // null = se creó sin tarifa cargada (≠ $0)
  /** El precio por hora con el que NACIÓ la reserva. null si se creó sin tarifa cargada. */
  precioHoraCent: bigint | null;
  estado: string;
};

export type DetalleProfesional = {
  periodo: string;
  tz: string;
  moneda: string;
  inquilino: { id: string; nombre: string; activo: boolean; pagador: string | null };
  turnos: TurnoDelMes[];
  /** Cuántas horas por día de la semana: "siempre martes y jueves" se ve de una. */
  porDiaSemana: { dia: number; reservas: number; minutos: number }[];
  /** En qué franjas horarias entra: mañana (<13), tarde (13-18), noche (>=18). */
  porFranja: { franja: "mañana" | "tarde" | "noche"; reservas: number; minutos: number }[];
  totales: {
    reservas: number;
    minutos: number;
    /** Suma de los importes ESTAMPADOS en los turnos del mes. */
    importeCent: bigint;
    /** Lo facturado según el libro (puede diferir: ajustes, penalidades, notas de crédito). */
    facturadoCent: bigint;
    pagadoCent: bigint;
    saldoCent: bigint;
    diasDistintos: number;
  };
};

export async function detalleProfesional(
  a: { actor: Actor; periodo: string; inquilinoId: string },
  db: PrismaClient = prisma,
): Promise<DetalleProfesional | null> {
  if (!esPeriodoValido(a.periodo)) return null;

  const op = a.actor.operadorId;
  // Pertenencia: el id vino de la URL. findFirst({id, operadorId}), nunca findUnique({id}).
  const inq = await db.inquilino.findFirst({
    where: { id: a.inquilinoId, operadorId: op },
    select: { id: true, nombre: true, estado: true, pagador: true },
  });
  if (!inq) return null;

  const sede = await db.sede.findFirst({ where: { operadorId: op, activa: true }, select: { zonaHoraria: true } });
  if (!sede) return null;
  const tz = sede.zonaHoraria;

  const dias = diasDelPeriodo(a.periodo);
  const primero = rangoDiaEnZona(dias[0]!, tz);
  const ultimo = rangoDiaEnZona(dias.at(-1)!, tz);
  if (!primero || !ultimo) return null;

  const [operador, filas, movs, saldoFila] = await Promise.all([
    db.operador.findUniqueOrThrow({ where: { id: op }, select: { moneda: true } }),
    db.ocupacion.findMany({
      where: {
        operadorId: op,
        inquilinoId: inq.id,
        tipo: "reserva",
        estado: { in: ESTADOS_VENDIDOS as never[] },
        inicio: { gte: primero.inicio, lt: ultimo.fin },
      },
      select: { id: true, inicio: true, fin: true, estado: true, importeCent: true, precioHoraCent: true, salaId: true, sala: { select: { nombre: true } } },
      orderBy: { inicio: "asc" },
    }),
    db.$queryRaw<{ debe: bigint; haber: bigint }[]>`
      SELECT COALESCE(SUM(CASE WHEN "montoCent" > 0 THEN "montoCent" ELSE 0 END), 0)::bigint AS debe,
             COALESCE(SUM(CASE WHEN "montoCent" < 0 THEN -"montoCent" ELSE 0 END), 0)::bigint AS haber
      FROM "Asiento"
      WHERE "operadorId" = ${op} AND "inquilinoId" = ${inq.id} AND "cuenta" = 'corriente' AND "periodo" = ${a.periodo}`,
    db.asiento.aggregate({ where: { operadorId: op, inquilinoId: inq.id, cuenta: "corriente" }, _sum: { montoCent: true } }),
  ]);

  const turnos: TurnoDelMes[] = filas.map((f) => {
    const fecha = fechaEnZona(f.inicio, tz);
    const desdeMin = minutosDelDia(f.inicio, tz);
    const hastaMin = minutosDelDia(f.fin, tz) || 24 * 60;
    return {
      id: f.id,
      fecha,
      diaSemana: diaSemanaDeFecha(fecha) ?? 0,
      horaTexto: `${minutosAHora(desdeMin)} – ${minutosAHora(hastaMin % (24 * 60))}`,
      salaId: f.salaId,
      salaNombre: f.sala?.nombre ?? "—",
      minutos: Math.round((f.fin.getTime() - f.inicio.getTime()) / 60_000),
      importeCent: f.importeCent,
      precioHoraCent: f.precioHoraCent,
      estado: f.estado,
    };
  });

  const porDiaSemana = [0, 1, 2, 3, 4, 5, 6].map((dia) => {
    const del = turnos.filter((t) => t.diaSemana === dia);
    return { dia, reservas: del.length, minutos: del.reduce((acc, t) => acc + t.minutos, 0) };
  });

  const franjaDe = (t: TurnoDelMes): "mañana" | "tarde" | "noche" => {
    const h = Number(t.horaTexto.slice(0, 2));
    return h < 13 ? "mañana" : h < 18 ? "tarde" : "noche";
  };
  const porFranja = (["mañana", "tarde", "noche"] as const).map((franja) => {
    const del = turnos.filter((t) => franjaDe(t) === franja);
    return { franja, reservas: del.length, minutos: del.reduce((acc, t) => acc + t.minutos, 0) };
  });

  const mov = movs[0] ?? { debe: 0n, haber: 0n };
  return {
    periodo: a.periodo,
    tz,
    moneda: operador.moneda,
    inquilino: { id: inq.id, nombre: inq.nombre, activo: inq.estado === "activo", pagador: inq.pagador },
    turnos,
    porDiaSemana,
    porFranja,
    totales: {
      reservas: turnos.length,
      minutos: turnos.reduce((acc, t) => acc + t.minutos, 0),
      importeCent: turnos.reduce((acc, t) => acc + (t.importeCent ?? 0n), 0n),
      facturadoCent: mov.debe,
      pagadoCent: mov.haber,
      saldoCent: saldoFila._sum.montoCent ?? 0n,
      diasDistintos: new Set(turnos.map((t) => t.fecha)).size,
    },
  };
}

// ── Ocupación por consultorio, sola ─────────────────────────────────────────
// La agenda muestra una barrita por consultorio en su lateral, y ahí no se puede llamar a
// `reporteMensual`: pide permiso de finanzas (un profesional no lo tiene) y calcula facturación,
// deuda y detalle por profesional para usar dos números. Esta función hace SOLO la ocupación.
//
// Usa los mismos helpers y el mismo criterio de "hora vendida" que el reporte. Que den lo mismo no
// se deja librado a que nadie los toque: hay un test que compara las dos salidas para el mismo
// período. Dos porcentajes de ocupación distintos en dos pantallas es de los errores más caros de
// explicar, porque los dos parecen correctos.

export type OcupacionSala = { salaId: string; minutos: number; aperturaMin: number; pct: number };

export async function ocupacionMensualPorSala(
  a: { operadorId: string; periodo: string },
  db: PrismaClient = prisma,
): Promise<OcupacionSala[]> {
  if (!esPeriodoValido(a.periodo)) return [];

  const sede = await db.sede.findFirst({ where: { operadorId: a.operadorId, activa: true }, select: { zonaHoraria: true } });
  if (!sede) return [];

  const dias = diasDelPeriodo(a.periodo);
  const primero = rangoDiaEnZona(dias[0]!, sede.zonaHoraria);
  const ultimo = rangoDiaEnZona(dias.at(-1)!, sede.zonaHoraria);
  if (!primero || !ultimo) return [];

  // Los bordes salen a variables antes del SQL, igual que en `reporteMensual`: el guardarraíl de
  // §4.2 prohíbe `>=` pegado a un `.inicio`/`.fin` fuera de intervalos.ts, y tiene razón — es la
  // forma en que se cuela un solape mal comparado. Acá son los bordes de un mes, no un intervalo
  // de reserva, y con los extremos nombrados la consulta también se lee mejor.
  const desde = primero.inicio;
  const hasta = ultimo.fin;

  const [salas, porSala] = await Promise.all([
    db.sala.findMany({ where: { operadorId: a.operadorId }, select: { id: true, activa: true, horarioJson: true } }),
    db.$queryRaw<{ id: string; minutos: number | null }[]>`
      SELECT o."salaId" AS id,
             COALESCE(SUM(EXTRACT(EPOCH FROM (o."fin" - o."inicio")) / 60), 0)::float8 AS minutos
      FROM "Ocupacion" o
      WHERE o."operadorId" = ${a.operadorId}
        AND o."tipo" = 'reserva'
        AND o."estado"::text = ANY(${ESTADOS_VENDIDOS})
        AND o."salaId" IS NOT NULL
        AND o."inicio" >= ${desde} AND o."inicio" < ${hasta}
      GROUP BY o."salaId"`,
  ]);

  const usados = new Map(porSala.map((r) => [r.id, Math.round(r.minutos ?? 0)]));
  return salas.map((s) => {
    const h = parseHorarios(s.horarioJson);
    // Igual que en el reporte: una sala archivada dejó de abrir, así que su denominador es 0 y el
    // porcentaje no se muestra — mejor un guion que un número inventado.
    const aperturaMin = s.activa
      ? aperturaDelPeriodoMin((d) => h[d as 0 | 1 | 2 | 3 | 4 | 5 | 6].map((f) => ({ desdeMin: hm(f.desde), hastaMin: hm(f.hasta) })), diaSemanaDeFecha, dias)
      : 0;
    const minutos = usados.get(s.id) ?? 0;
    return { salaId: s.id, minutos, aperturaMin, pct: porcentaje(minutos, aperturaMin) };
  });
}
