// src/servicios/agenda/dia.ts — arma la agenda en sus tres vistas: día, semana y mes (§6.4).
// Toda query filtra por operadorId EXPLÍCITO. Las filas se PROYECTAN según el actor antes de
// salir del servidor (§6.3): el cliente nunca recibe el registro crudo.
//
// Un solo cargador para las tres vistas a propósito: si cada una tuviera su query, el día y la
// semana terminarían mostrando números distintos del mismo turno, y el que descubre eso es el
// profesional que reclama.

import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { parseHorarios } from "../../dominio/motor/horarios.ts";
import { rangoDiaEnZona, horaAMinutos, diaSemanaDeFecha, fechaEnZona, minutosAHora } from "../../dominio/motor/zona.ts";
import { minutosDelDia, rangoVisible, ubicarBloques, filasTotales, type BloqueEntrada } from "../../dominio/grilla.ts";
import { diasDeVista, tituloDeVista, type Vista } from "../../dominio/calendario.ts";
import { proyectarReserva, type ReservaDTO } from "../../dominio/proyeccion.ts";
import { LOOKBACK_MIN } from "../../dominio/motor/limites.ts";
import type { Actor } from "../../lib/actor.ts";

/** Id de la columna sintética donde caen las reservas que no usan consultorio. */
export const SIN_SALA = "sin-sala";

export type SalaVista = { id: string; nombre: string; color: string; activa: boolean };

/**
 * Una reserva lista para dibujar: los campos de la PROYECCIÓN más lo que la pantalla necesita
 * para ubicarla. Nada de esto agrega información privada — `titulo` sale de la proyección, así
 * que en la vista ajena dice "Ocupado" igual que el DTO.
 */
export type EventoAgenda = ReservaDTO & {
  fechaLocal: string; // el día (en la zona de la sede) en que arranca: agrupa la semana y el mes
  salaNombre: string;
  color: string;
  desdeMin: number; // minutos desde la medianoche local
  hastaMin: number;
  horaTexto: string; // "09:00 – 10:30", ya formateado en la zona de la SEDE
  esBloqueo: boolean; // el centro cerró la franja: se dibuja rayado y no cuenta como hora vendida
  titulo: string;
  /** ¿Este actor puede abrir el detalle? Falso para el turno del de al lado, que se proyecta sin
   *  identidad y por lo tanto no tiene detalle que mostrar. Sale de la PROYECCIÓN y no de mirar si
   *  el título dice "Ocupado": el día que ese texto cambie, la regla de privacidad seguiría
   *  colgada de una cadena. */
  abrible: boolean;
};

export type AgendaVista = {
  vista: Vista;
  fecha: string; // el día ancla (el seleccionado)
  titulo: string;
  tz: string;
  moneda: string;
  dias: string[]; // 1 (día), 7 (semana) o 42 (mes)
  salas: SalaVista[];
  salasVisibles: string[]; // ids que quedaron después del filtro del lateral
  reservas: EventoAgenda[];
  ubicaciones: ReturnType<typeof ubicarBloques>;
  aperturaMin: number;
  cierreMin: number;
  pasoMin: number;
  filas: number;
  kpis: { ocupadasMin: number; disponiblesMin: number; ocupacionPct: number };
};

/** Compatibilidad: la vista día es la agenda con `vista: "dia"`. */
export type DiaVista = AgendaVista;

const PASO = 30;

export async function cargarAgenda(
  // `fecha` null = HOY en la zona de la SEDE. Resolverlo acá (y no en la página) es lo que
  // impide que alguien clave una zona para calcular "hoy": la zona sale de la sede, siempre.
  a: { actor: Actor; fecha: string | null; vista?: Vista; salas?: string[] | null; ahora?: Date },
  db: PrismaClient = prisma,
): Promise<AgendaVista | null> {
  const sede = await db.sede.findFirst({
    where: { operadorId: a.actor.operadorId, activa: true },
    select: { id: true, zonaHoraria: true, operador: { select: { moneda: true } } },
  });
  if (!sede) return null;
  const tz = sede.zonaHoraria;
  const vista: Vista = a.vista ?? "dia";

  const fecha = a.fecha ?? fechaEnZona(a.ahora ?? new Date(), tz);
  const dias = diasDeVista(vista, fecha);
  const rangoIni = rangoDiaEnZona(dias[0]!, tz);
  const rangoFin = rangoDiaEnZona(dias.at(-1)!, tz);
  if (!rangoIni || !rangoFin) return null;
  const desde = rangoIni.inicio;
  const hasta = rangoFin.fin;

  // Salas activas + las ARCHIVADAS que tengan algo en el rango: un filtro nunca puede hacer
  // desaparecer una fila que existe (§6.4). Ante la duda, se muestra de más.
  const salasTodas = await db.sala.findMany({
    where: { operadorId: a.actor.operadorId },
    orderBy: [{ orden: "asc" }, { nombre: "asc" }],
    select: { id: true, nombre: true, color: true, activa: true, horarioJson: true },
  });

  const desdeLookback = new Date(desde.getTime() - LOOKBACK_MIN * 60_000);
  const filasOcup = await db.ocupacion.findMany({
    where: {
      operadorId: a.actor.operadorId,
      estado: { in: ["confirmada", "en_curso", "usada", "no_show"] },
      inicio: { gte: desdeLookback, lt: hasta },
      fin: { gt: desde },
    },
    select: {
      id: true, salaId: true, inquilinoId: true, tipo: true, estado: true, inicio: true, fin: true,
      motivo: true, notaInterna: true, importeCent: true, serieId: true,
      inquilino: { select: { nombre: true } },
    },
    orderBy: { inicio: "asc" },
  });

  const conActividad = new Set(filasOcup.map((f) => f.salaId).filter((s): s is string => s !== null));

  // Las reservas SIN CONSULTORIO se facturan pero no usan el espacio (el profesional que ese día
  // atiende afuera). Necesitan una columna igual: sin ella serían invisibles en la agenda y
  // "no aparece" es indistinguible de "no se creó". La columna es SINTÉTICA —no hay una fila
  // `Sala` detrás— y solo se dibuja los días en que hay algo, para no ocupar ancho por las dudas.
  const haySinSala = filasOcup.some((f) => f.salaId === null && f.tipo === "reserva");
  const salas: SalaVista[] = [
    ...salasTodas
      .filter((s) => s.activa || conActividad.has(s.id))
      .map((s) => ({ id: s.id, nombre: s.nombre, color: s.color, activa: s.activa })),
    ...(haySinSala ? [{ id: SIN_SALA, nombre: "Sin consultorio", color: "#5c7382", activa: true }] : []),
  ];

  // Filtro del lateral (las casillas de "calendarios"). Un id que no existe se ignora en vez de
  // dejar la pantalla vacía; sin filtro, se ven todas.
  const pedidas = a.salas?.filter((id) => salas.some((s) => s.id === id)) ?? null;
  const salasVisibles = pedidas && pedidas.length > 0 ? pedidas : salas.map((s) => s.id);
  const visible = new Set(salasVisibles);
  const enVista = filasOcup.filter((f) => f.salaId === null || visible.has(f.salaId));

  // Apertura de CADA día del rango (no de una semana en abstracto): es el denominador del KPI.
  const aperturas: { desdeMin: number; hastaMin: number }[] = [];
  let aperturaTotalMin = 0;
  for (const s of salasTodas) {
    if (!visible.has(s.id)) continue;
    const h = parseHorarios(s.horarioJson);
    for (const f of dias) {
      const diaSemana = diaSemanaDeFecha(f);
      if (diaSemana == null) continue;
      for (const fr of h[diaSemana]) {
        const d = horaAMinutos(fr.desde);
        const t = horaAMinutos(fr.hasta);
        if (d == null || t == null) continue;
        aperturas.push({ desdeMin: d, hastaMin: t });
        // Solo las salas ACTIVAS aportan denominador: una archivada ya no se puede vender.
        if (s.activa) aperturaTotalMin += t - d;
      }
    }
  }

  const bloquesMin = enVista.map((f) => ({ desdeMin: minutosDelDia(f.inicio, tz), hastaMin: minutosDelDia(f.fin, tz) || 24 * 60 }));
  const { aperturaMin, cierreMin } = rangoVisible({ aperturas, bloques: bloquesMin });

  const colorDe = new Map(salasTodas.map((s) => [s.id, s.color]));
  const nombreDe = new Map(salasTodas.map((s) => [s.id, s.nombre]));

  const reservas: EventoAgenda[] = enVista.map((f) => {
    const dto = proyectarReserva(
      { id: f.id, salaId: f.salaId, inquilinoId: f.inquilinoId, inquilinoNombre: f.inquilino?.nombre ?? null, tipo: f.tipo, estado: f.estado, inicio: f.inicio, fin: f.fin, motivo: f.motivo, notaInterna: f.notaInterna, serieId: f.serieId, importeCent: f.importeCent },
      a.actor,
    );
    const conIdentidad = "inquilinoNombre" in dto ? dto : null;
    const desdeMin = minutosDelDia(f.inicio, tz);
    const hastaMin = minutosDelDia(f.fin, tz) || 24 * 60;
    return {
      ...dto,
      fechaLocal: fechaEnZona(f.inicio, tz),
      salaNombre: f.salaId ? (nombreDe.get(f.salaId) ?? "") : f.tipo === "reserva" ? "Sin consultorio" : "Todo el centro",
      color: f.salaId ? (colorDe.get(f.salaId) ?? "#1a8fc1") : "#5c7382",
      desdeMin,
      hastaMin,
      horaTexto: `${minutosAHora(desdeMin)} – ${minutosAHora(hastaMin % (24 * 60))}`,
      // El tipo solo existe en la vista con identidad; para el de al lado, un ocupado es un
      // ocupado y se dibuja igual que un bloqueo (§6.3).
      esBloqueo: conIdentidad?.tipo === "bloqueo",
      titulo: conIdentidad?.inquilinoNombre ?? conIdentidad?.motivo ?? "Ocupado",
      abrible: Boolean(conIdentidad),
    };
  });

  // En día las columnas son las SALAS; en semana, los DÍAS. El mes no usa grilla de tiempo.
  const bloques: BloqueEntrada[] = enVista
    // Un bloqueo GLOBAL (sin sala) no tiene columna propia: le pega a todo el centro y se dibuja
    // como cierre. Una reserva sin sala sí, en la columna sintética.
    .filter((f) => f.salaId !== null || f.tipo === "reserva")
    .map((f) => ({
      id: f.id,
      columnaId: vista === "semana" ? fechaEnZona(f.inicio, tz) : (f.salaId ?? SIN_SALA),
      inicio: f.inicio,
      fin: f.fin,
    }));

  const rv = { inicioDia: rangoIni.inicio, aperturaMin, cierreMin, pasoMin: PASO };
  // En semana cada columna es un día distinto: los minutos se miden contra SU medianoche, no
  // contra la del domingo (si no, el sábado arrancaría en la fila 8.640 y encima el DST del
  // miércoles correría media semana una hora). Se ubica día por día y se junta.
  const ubicaciones =
    vista === "semana"
      ? dias.flatMap((f) => {
          const r = rangoDiaEnZona(f, tz);
          if (!r) return [];
          return ubicarBloques(
            bloques.filter((b) => b.columnaId === f),
            { inicioDia: r.inicio, aperturaMin, cierreMin, pasoMin: PASO },
          );
        })
      : ubicarBloques(bloques, rv);

  // KPIs (§6.4). Ocupación = horas RESERVADAS ÷ horas DISPONIBLES, donde disponibles = horas de
  // APERTURA de la sala − bloqueos. Ojo con dos errores fáciles y caros:
  //  · usar el rango VISIBLE como denominador (incluye los márgenes de una hora y lo infla);
  //  · contar los bloqueos como uso (no es una hora vendida: es una hora que no se pudo vender).
  // El denominador se muestra siempre: un porcentaje sin denominador no se puede auditar.
  const duracion = (f: { inicio: Date; fin: Date }) => Math.round((f.fin.getTime() - f.inicio.getTime()) / 60_000);
  let ocupadasMin = 0;
  let bloqueadasMin = 0;
  for (const f of enVista) {
    if (f.salaId === null) continue;
    if (f.tipo === "reserva") ocupadasMin += duracion(f);
    else bloqueadasMin += duracion(f); // mantenimiento / bloqueo / hold: sale del denominador
  }
  const disponiblesMin = Math.max(0, aperturaTotalMin - bloqueadasMin);
  const ocupacionPct = disponiblesMin > 0 ? Math.round((ocupadasMin / disponiblesMin) * 100) : 0;

  return {
    vista,
    fecha,
    titulo: tituloDeVista(vista, fecha),
    tz,
    moneda: sede.operador.moneda,
    dias,
    salas,
    salasVisibles,
    reservas,
    ubicaciones,
    aperturaMin,
    cierreMin,
    pasoMin: PASO,
    filas: filasTotales(rv),
    kpis: { ocupadasMin, disponiblesMin, ocupacionPct },
  };
}

/** La vista día, que es la de siempre. */
export function cargarDia(
  a: { actor: Actor; fecha: string | null; ahora?: Date },
  db: PrismaClient = prisma,
): Promise<AgendaVista | null> {
  return cargarAgenda({ ...a, vista: "dia" }, db);
}
