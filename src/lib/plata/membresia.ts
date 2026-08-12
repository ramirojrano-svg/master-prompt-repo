// src/lib/plata/membresia.ts — EL único predicado de vigencia de membresía (§4.12).
// Lo comparten el motor de reservas, el descuento por membresía, el acceso al portal y la
// liquidación. Dos criterios distintos = alguien reserva gratis o le cobran una hora que su plan
// incluía. vigenteHasta es FECHA (§9): null o pasado => NO vigente (fail-closed).

export type EstadoMembresiaVigencia = { estado: string; vigenteHasta: Date | null };

export function membresiaVigente(m: EstadoMembresiaVigencia, ahora: Date): boolean {
  return m.estado === "activa" && m.vigenteHasta !== null && m.vigenteHasta > ahora;
}
