"use client";

// app/panel/[slug]/Horario.tsx — "empieza / termina", con la duración al lado de cada opción.
//
// Antes se pedía la hora de inicio y una DURACIÓN ("1 hora", "2 horas"). Nadie piensa así al
// agendar: piensa "de 8 a 11". Con la duración hay que hacer la cuenta mentalmente para saber a
// qué hora termina, y es donde se cometen los errores — se elige "3 horas" queriendo decir "hasta
// las 11" cuando se empezó a las 9.
//
// Ahora se elige la hora de FIN y la duración se muestra al lado de cada opción, como en Google
// Calendar: "11:00 (3 h)". Se ven las dos cosas sin calcular ninguna.
//
// Al servidor sigue viajando `duracionMin`, que es lo que el motor entiende: la conversión se hace
// acá y no se toca el contrato de la acción.

import { useState } from "react";
import { DURACION_MAX_MIN, DURACION_MIN_MIN } from "../../../src/dominio/motor/limites.ts";

/** Cada cuánto se puede EMPEZAR. Media hora: un turno a las 15:30 es de lo más común. */
const PASO_INICIO_MIN = 30;

/**
 * Cada cuánto crece la duración una vez pasada la primera hora. Se alquila POR HORA, así que la
 * lista va 1 h, 2 h, 3 h. Con medias horas quedaba el doble de opciones —1.5 h, 2.5 h, 3.5 h— para
 * ofrecer duraciones que casi nadie pide, y encontrar "3 h" costaba el doble de scroll.
 */
const PASO_DURACION_MIN = 60;

const aMinutos = (hhmm: string): number => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};
const aHora = (min: number): string =>
  `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** 90 → "1.5 h"; 60 → "1 h"; 30 → "30 min". Como lo escribe Google: corto y sin ceremonia. */
function duracionCorta(min: number): string {
  if (min < 60) return `${min} min`;
  const h = min / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1).replace(".0", "")} h`;
}

export function Horario({ horaInicial = "09:00", duracionInicial = 60 }: { horaInicial?: string; duracionInicial?: number }) {
  const [inicio, setInicio] = useState(horaInicial);
  const [duracion, setDuracion] = useState(duracionInicial);

  const desdeMin = aMinutos(inicio);

  // Las opciones de fin se recalculan desde la hora de inicio: mover el inicio no puede dejar un
  // fin anterior, que es lo que pasaba si el fin fuera un campo suelto.
  // Solo horas enteras: 1 h, 2 h, 3 h. El consultorio se alquila por hora y esa es la unidad con
  // la que se piensa y se cobra; los pedazos (15, 30, 45 min) ensuciaban la lista con duraciones
  // que acá no se usan. El motor sigue aceptando 15 minutos —el mínimo es del dominio, no de este
  // selector—, así que si algún día hacen falta, vuelven agregándolas a esta lista.
  const duraciones: number[] = [];
  for (let d = 60; d <= DURACION_MAX_MIN; d += PASO_DURACION_MIN) duraciones.push(d);

  const opciones: { min: number; etiqueta: string }[] = [];
  for (const d of duraciones) {
    if (d < DURACION_MIN_MIN) continue;
    // El día tiene 24 h: un turno que cruza la medianoche no existe en un consultorio.
    if (desdeMin + d > 24 * 60) break;
    opciones.push({ min: d, etiqueta: `${aHora(desdeMin + d)} (${duracionCorta(d)})` });
  }

  // Si el inicio se movió tanto que la duración elegida ya no entra, se cae a la última que sí.
  const valida = opciones.some((o) => o.min === duracion) ? duracion : (opciones.at(-1)?.min ?? DURACION_MIN_MIN);

  return (
    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1.35fr" }}>
      <div>
        <label htmlFor="hora">Empieza</label>
        <input
          id="hora"
          name="hora"
          type="time"
          step={PASO_INICIO_MIN * 60}
          required
          value={inicio}
          onChange={(e) => setInicio(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="duracionMin">Termina</label>
        {/* El name sigue siendo duracionMin: al servidor viaja la duración, que es lo que el motor
            entiende. Cambiar la etiqueta de un campo no es motivo para cambiar el contrato. */}
        <select id="duracionMin" name="duracionMin" value={valida} onChange={(e) => setDuracion(Number(e.target.value))}>
          {opciones.map((o) => (
            <option key={o.min} value={o.min}>
              {o.etiqueta}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
