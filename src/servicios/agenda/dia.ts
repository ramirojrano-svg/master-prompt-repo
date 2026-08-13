// src/servicios/agenda/dia.ts — arma la vista día multi-sala (§6.4).
// Toda query filtra por operadorId EXPLÍCITO. Las filas se PROYECTAN según el actor antes de
// salir del servidor (§6.3): el cliente nunca recibe el registro crudo.

import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { parseHorarios } from "../../dominio/motor/horarios.ts";
import { rangoDiaEnZona, horaAMinutos } from "../../dominio/motor/zona.ts";
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
  a: { actor: Actor; fecha: string },
  db: PrismaClient = prisma,
): Promise<DiaVista | null> {
  const sede = await db.sede.findFirst({ where: { operadorId: a.actor.operadorId, activa: true }, select: { id: true, zonaHoraria: true } });
  if (!sede) return null;
  const tz = sede.zonaHoraria;

  const rango = rangoDiaEnZona(a.fecha, tz);
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

  // Rango vertical = unión de aperturas y bloques, con margen (§6.4).
  const aperturas: { desdeMin: number; hastaMin: number }[] = [];
  for (const s of salasTodas) {
    if (!salas.some((v) => v.id === s.id)) continue;
    const h = parseHorarios(s.horarioJson);
    for (const dia of Object.values(h)) {
      for (const f of dia) {
        const d = horaAMinutos(f.desde);
        const t = horaAMinutos(f.hasta);
        if (d != null && t != null) aperturas.push({ desdeMin: d, hastaMin: t });
      }
    }
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

  // KPIs con el DENOMINADOR visible: un porcentaje sin denominador no se puede auditar (§6.4).
  const ocupadasMin = filasOcup.reduce((acc, f) => acc + Math.round((f.fin.getTime() - f.inicio.getTime()) / 60_000), 0);
  const disponiblesMin = salas.filter((s) => s.activa).length * (cierreMin - aperturaMin);
  const ocupacionPct = disponiblesMin > 0 ? Math.round((ocupadasMin / disponiblesMin) * 100) : 0;

  return {
    fecha: a.fecha, tz, salas, reservas, ubicaciones,
    aperturaMin, cierreMin, pasoMin: PASO, filas: filasTotales(rv),
    kpis: { ocupadasMin, disponiblesMin, ocupacionPct },
  };
}
