// src/dominio/motor/tipos.ts
// Tipos base del motor. Tres representaciones del tiempo, sin superposición.
// Regla dura §14.2: todo instante se persiste en UTC; ninguna hora de pared vive sin su tz.

export type Instante = Date; // SIEMPRE UTC. Es lo único que se persiste.
export type FechaLocal = string; // 'YYYY-MM-DD' — día calendario EN LA ZONA DE LA SEDE.
export type HoraPared = string; // 'HH:MM' — 24h, sin zona, sin sentido por sí sola.
export type Tz = string; // Zona IANA (formato 'Continente/Ciudad'), obligatoria en cada firma.

/** Día de la semana. 0 = domingo (como getUTCDay). */
export type Dia = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Intervalo SEMIABIERTO [inicio, fin). fin > inicio SIEMPRE (invariante §14.1). */
export type Intervalo = { inicio: Instante; fin: Instante };

// ─────────────────────────────────────────────────────────────
// Horarios (§4.4)
// ─────────────────────────────────────────────────────────────
/** Franja de apertura en hora de pared. desde < hasta. */
export type Franja = { desde: HoraPared; hasta: HoraPared };

/** Apertura semanal de una sala (o de una membresía). Todos los días existen (puede ser []). */
export type HorarioSemanal = Record<Dia, Franja[]>;

// ─────────────────────────────────────────────────────────────
// Ocupación (vista del motor, §4.4) — NO es la fila de Prisma, es la foto que se le pasa.
// ─────────────────────────────────────────────────────────────
export type TipoOcup = "reserva" | "hold" | "bloqueo";

export type Ocupacion = {
  id: string;
  salaId: string | null; // null SOLO en tipo 'bloqueo' => todo el centro
  inquilinoId: string | null;
  tipo: TipoOcup;
  inicio: Instante;
  fin: Instante;
  bufferMin: number; // ESTAMPADO al nacer, no leído de la config actual (§4.6)
};

// ─────────────────────────────────────────────────────────────
// Política y entrada del motor de disponibilidad (§4.4)
// ─────────────────────────────────────────────────────────────
export type PasoMin = 10 | 15 | 20 | 30 | 60; // lista CERRADA

export type PoliticaCentro = {
  pasoMin: PasoMin;
  duracionMinMin: number; // >= DURACION_MIN_MIN
  duracionMaxMin: number; // <= DURACION_MAX_MIN
  bufferMin: number; // limpieza entre inquilinos distintos (se estampa al crear)
  bufferMismoInquilino: number; // default 0
  antelacionMinMin: number; // default 120 (2 h)
  horizonteDias: number; // default 60 en el portal
};

export type EntradaDisponibilidad = {
  fecha: FechaLocal;
  tz: Tz;
  horario: HorarioSemanal; // el de la SALA
  ocupaciones: Ocupacion[]; // de la sala + del inquilino + bloqueos aplicables
  politica: PoliticaCentro;
  duracionMin: number;
  ahora: Instante; // INYECTADO. El motor nunca lo lee del reloj.
  inquilinoId?: string; // para el buffer de mismo inquilino y el eje persona
};
