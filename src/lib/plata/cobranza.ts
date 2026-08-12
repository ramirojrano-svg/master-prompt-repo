// src/lib/plata/cobranza.ts — UN solo predicado de "está al día" (§5.5), server-side, compartido
// por el portal del inquilino, el panel del operador, la API y la pantalla. En cuanto haya dos
// criterios, alguien alquila gratis o le cobran una hora que su plan incluía.

export type EstadoCobranza = "al_dia" | "gracia" | "suspendido" | "baja";

export const DIAS_GRACIA = 7;
export const DIAS_CORTE = 30;

export function estadoCobranza(i: {
  deudaVencidaCent: bigint;
  diasDesdeVencimiento: number;
  excepcionHasta: Date | null; // override del operador, con motivo y auditoría
  ahora: Date;
}): EstadoCobranza {
  if (i.excepcionHasta && i.excepcionHasta > i.ahora) return "al_dia";
  if (i.deudaVencidaCent <= 0n) return "al_dia";
  if (i.diasDesdeVencimiento <= DIAS_GRACIA) return "gracia";
  if (i.diasDesdeVencimiento <= DIAS_CORTE) return "suspendido";
  return "baja";
}
