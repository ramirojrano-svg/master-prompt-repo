// src/dominio/proyeccion.ts — la reserva se proyecta SEGÚN QUIÉN MIRA (§6.3, regla dura).
// Ninguna query devuelve el registro crudo al cliente.
//
// Por qué: un psicólogo alquila el consultorio 3 los martes de 15 a 20. La lista de sus turnos,
// con horarios y frecuencia, es información de salud POR CONTEXTO aunque no haya diagnóstico.
// Además es inteligencia comercial (quién trabaja cuánto, qué días está muerto el centro).
//
// En la vista AJENA un ocupado tiene que ser INDISTINGUIBLE de un bloqueo de mantenimiento:
// un color distinto ya filtra información.

import { puede, type Rol } from "../lib/permisos.ts";

export type Vista = "ajena" | "operador" | "propia";

export type FilaReserva = {
  id: string;
  salaId: string | null;
  inquilinoId: string | null;
  inquilinoNombre: string | null;
  tipo: string;
  estado: string;
  inicio: Date;
  fin: Date;
  motivo: string | null;
  notaInterna: string | null;
  /** Si pertenece a una serie recurrente. Lo necesita el borrado por alcance. */
  serieId: string | null;
  /** Lo que se cobró por esa hora, estampado al nacer. null = no había precio cargado. */
  importeCent?: bigint | null;
};

export type ReservaAjenaDTO = { id: string; salaId: string | null; inicio: string; fin: string; estado: "ocupado" };
export type ReservaOperadorDTO = Omit<ReservaAjenaDTO, "estado"> & {
  estado: string;
  tipo: string;
  inquilinoId: string | null;
  inquilinoNombre: string | null;
  motivo: string | null;
  /** No null => es parte de una serie, y borrarlo pregunta si va uno, los siguientes o todos. */
  serieId: string | null;
  /** String, no bigint: un BigInt no se puede serializar del servidor al cliente. */
  importeCent: string | null;
};
export type ReservaPropiaDTO = ReservaOperadorDTO & { notaInterna: string | null };
export type ReservaDTO = ReservaAjenaDTO | ReservaOperadorDTO | ReservaPropiaDTO;

export function vistaDe(actor: { rol: Rol; inquilinoId: string | null }, r: { inquilinoId: string | null }): Vista {
  if (puede(actor.rol, "agenda.ver.identidad")) return "operador";
  return actor.inquilinoId !== null && actor.inquilinoId === r.inquilinoId ? "propia" : "ajena";
}

/**
 * Proyecta una fila según el actor. La `notaInterna` (donde el profesional escribe "Martín 16h"
 * para acordarse) NO la ve el operador ni la recepción: solo entra en la vista PROPIA.
 */
export function proyectarReserva(r: FilaReserva, actor: { rol: Rol; inquilinoId: string | null }): ReservaDTO {
  const vista = vistaDe(actor, r);
  const base = { id: r.id, salaId: r.salaId, inicio: r.inicio.toISOString(), fin: r.fin.toISOString() };

  if (vista === "ajena") {
    // Esto es TODO lo que sale. Sin nombre, sin tipo, sin motivo: un ocupado es un ocupado.
    return { ...base, estado: "ocupado" };
  }

  // La PLATA se gatea aparte de la identidad: la recepción sabe QUIÉN está en la sala (lo necesita
  // para atender) pero no cuánto paga. Y el profesional ve lo suyo solo si su rol ve su cuenta:
  // el staff de un consultorio agenda, no mira la facturación del titular (§6.2).
  const veLaPlata = puede(actor.rol, "cuenta.ver.todas") || (vista === "propia" && puede(actor.rol, "cuenta.ver.propia"));

  const conIdentidad: ReservaOperadorDTO = {
    ...base,
    estado: r.estado,
    tipo: r.tipo,
    inquilinoId: r.inquilinoId,
    inquilinoNombre: r.inquilinoNombre,
    motivo: r.motivo,
    serieId: r.serieId,
    importeCent: veLaPlata && r.importeCent != null ? r.importeCent.toString() : null,
  };

  if (vista === "operador") return conIdentidad;
  return { ...conIdentidad, notaInterna: r.notaInterna };
}
