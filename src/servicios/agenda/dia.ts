// src/servicios/agenda/dia.ts — arma la vista día multi-sala (§6.4).
// Toda query filtra por operadorId EXPLÍCITO. Las filas se PROYECTAN según el actor antes de
// salir del servidor (§6.3): el cliente nunca recibe el registro crudo.

import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { parseHorarios } from "../../dominio/motor/horarios.ts";
import { rangoDiaEnZona, horaAMinutos, diaSemanaDeFecha, fechaEnZona } from "../../dominio/motor/zona.ts";
import { minutosDelDia, rangoVisible, ubicarBloques, filasTotales, type BloqueEntrada } from "../../dominio/grilla.ts";
import { proyectarReserva, type ReservaDTO } from "../../dominio/proyeccion.ts";
import { LOOKBACK_MIN } from "../../dominio/motor/limites.ts";
import type { Actor } from "../../lib/actor.ts";

export type SalaVista = { id: string; nombre: string; color: string; activa: boolean };

export type DiaVista = {
  fecha: string;
  tz: string;
  salas: SalaVista[];
  reservas: ReservaDTO[];
  ubicaciones: ReturnType<typeof ubicarBloques>;
  aperturaMin: number;
  cierreMin: number;
  pasoMin: number;
  filas: number;
  kpis: { ocupadasMin: number; disponiblesMin: number; ocupacionPct: number };
};

const PASO = 30;

export async function cargarDia(
  // `fecha` null = HOY en la zona de la SEDE. Resolverlo acá (y no en la página) es lo que
  // impide que alguien clave una zona para calcular "hoy": la zona sale de la sede, siempre.
  a: { actor: Actor; fecha: string | null; ahora?: Date },
  db: PrismaClient = prisma,
): Promise<DiaVista | null> {
  const sede = await db.sede.findFirst({ where: { operadorId: a.actor.operadorId, activa: true }, select: { id: true, zonaHoraria: true } });
  if (!sede) return null;
  const tz = sede.zonaHoraria;

  const fecha = a.fecha ?? fechaEnZona(a.ahora ?? new Date(), tz);
  const rango = rangoDiaEnZona(fecha, tz);
  if (!rango) return null;

  // Salas activas + las ARCHIVADAS que tengan algo ese día: un filtro nunca puede hacer
  // desaparecer una fila que existe (§6.4). Ante la duda, se muestra de más.
  const salasTodas = await db.sala.findMany({
    where: { operadorId: a.actor.operadorId },
    orderBy: [{ orden: "asc" }, { nombre: "asc" }],
    select: { id: true, nombre: true, color: true, activa: true, horarioJson: true },
  });

  const desdeLookback = new Date(rango.inicio.getTime() - LOOKBACK_MIN * 60_000);
  const filasOcup = await db.ocupacion.findMany({
    where: {
      operadorId: a.actor.operadorId,
      estado: { in: ["confirmada", "en_curso", "usada", "no_show"] },
      inicio: { gte: desdeLookback, lt: rango.fin },
      fin: { gt: rango.inicio },
    },
    select: {
      id: true, salaId: true, inquilinoId: true, tipo: true, estado: true, inicio: true, fin: true,
      motivo: true, notaInterna: true,
      inquilino: { select: { nombre: true } },
    },
    orderBy: { inicio: "asc" },
  });

  const conActividad = new Set(filasOcup.map((f) => f.salaId).filter((s): s is string => s !== null));
  const salas: SalaVista[] = salasTodas
    .filter((s) => s.activa || conActividad.has(s.id))
    .map((s) => ({ id: s.id, nombre: s.nombre, color: s.color, activa: s.activa }));

  // Apertura del DÍA que se muestra (no de toda la semana): es el denominador del KPI.
  const diaSemana = diaSemanaDeFecha(fecha);
  const aperturas: { desdeMin: number; hastaMin: number }[] = [];
  const aperturaPorSala = new Map<string, number>(); // minutos de apertura de ESE día, por sala
  for (const s of salasTodas) {
    if (!salas.some((v) => v.id === s.id)) continue;
    const h = parseHorarios(s.horarioJson);
    const franjas = diaSemana == null ? [] : h[diaSemana];
    let minutos = 0;
    for (const f of franjas) {
      const d = horaAMinutos(f.desde);
      const t = horaAMinutos(f.hasta);
      if (d != null && t != null) {
        aperturas.push({ desdeMin: d, hastaMin: t });
        minutos += t - d;
      }
    }
    aperturaPorSala.set(s.id, minutos);
  }
  const bloquesMin = filasOcup.map((f) => ({ desdeMin: minutosDelDia(f.inicio, tz), hastaMin: minutosDelDia(f.fin, tz) || 24 * 60 }));
  const { aperturaMin, cierreMin } = rangoVisible({ aperturas, bloques: bloquesMin });

  const reservas = filasOcup.map((f) =>
    proyectarReserva(
      { id: f.id, salaId: f.salaId, inquilinoId: f.inquilinoId, inquilinoNombre: f.inquilino?.nombre ?? null, tipo: f.tipo, estado: f.estado, inicio: f.inicio, fin: f.fin, motivo: f.motivo, notaInterna: f.notaInterna },
      a.actor,
    ),
  );

  const bloques: BloqueEntrada[] = filasOcup
    .filter((f) => f.salaId !== null)
    .map((f) => ({ id: f.id, columnaId: f.salaId!, inicio: f.inicio, fin: f.fin }));

  const rv = { inicioDia: rango.inicio, aperturaMin, cierreMin, pasoMin: PASO };
  const ubicaciones = ubicarBloques(bloques, rv);

  // KPIs (§6.4). Ocupación = horas RESERVADAS ÷ horas DISPONIBLES, donde disponibles = horas de
  // APERTURA de la sala − bloqueos. Ojo con dos errores fáciles y caros:
  //  · usar el rango VISIBLE como denominador (incluye los márgenes de una hora y lo infla);
  //  · contar el mantenimiento como uso (no es una hora vendida: es una hora que no se pudo vender).
  // El denominador se muestra siempre: un porcentaje sin denominador no se puede auditar.
  const duracion = (f: { inicio: Date; fin: Date }) => Math.round((f.fin.getTime() - f.inicio.getTime()) / 60_000);
  let ocupadasMin = 0;
  let bloqueadasMin = 0;
  for (const f of filasOcup) {
    if (f.salaId === null) continue;
    if (f.tipo === "reserva") ocupadasMin += duracion(f);
    else bloqueadasMin += duracion(f); // mantenimiento / bloqueo / hold: sale del denominador
  }
  const aperturaTotalMin = salas.filter((s) => s.activa).reduce((acc, s) => acc + (aperturaPorSala.get(s.id) ?? 0), 0);
  const disponiblesMin = Math.max(0, aperturaTotalMin - bloqueadasMin);
  const ocupacionPct = disponiblesMin > 0 ? Math.round((ocupadasMin / disponiblesMin) * 100) : 0;

  return {
    fecha, tz, salas, reservas, ubicaciones,
    aperturaMin, cierreMin, pasoMin: PASO, filas: filasTotales(rv),
    kpis: { ocupadasMin, disponiblesMin, ocupacionPct },
  };
}
