// src/servicios/reservas/comun.ts — piezas compartidas por los caminos de escritura.
import { EstadoOcupacion, TipoOcupacion } from "@prisma/client";
import type { Ocupacion } from "../../dominio/motor/tipos.ts";

/** Estados que OCUPAN la sala (espejo de la columna generada `ocupa`). */
export const OCUPAN: EstadoOcupacion[] = [
  EstadoOcupacion.confirmada,
  EstadoOcupacion.en_curso,
  EstadoOcupacion.usada,
  EstadoOcupacion.no_show,
];

/** Estados que ya alimentaron un dato derivado (plata / falta): la fila queda CONGELADA. */
export const CONGELAN: EstadoOcupacion[] = [EstadoOcupacion.usada, EstadoOcupacion.no_show];

export type FilaOcupacion = {
  id: string;
  salaId: string | null;
  inquilinoId: string | null;
  tipo: TipoOcupacion;
  inicio: Date;
  fin: Date;
  bufferMin: number;
};

export function aMotor(o: FilaOcupacion): Ocupacion {
  return { id: o.id, salaId: o.salaId, inquilinoId: o.inquilinoId, tipo: o.tipo, inicio: o.inicio, fin: o.fin, bufferMin: o.bufferMin };
}
