// src/dominio/motor/cancelacion.ts — política de reembolso, no-show (§4.10). Motor PURO.
// El reloj corre contra el INSTANTE UTC de inicio, así el DST no regala ni roba horas de
// ventana. Plata en centavos enteros (BigInt), nunca floats (§5 regla 4).

import type { Instante } from "./tipos.ts";

export type EscalonCancelacion = { horasAntes: number; reembolsoPct: number };

/** Escalones ordenados DESC por horasAntes; gana el primero que cumple (>=). */
export const ESCALONES_DEFAULT: EscalonCancelacion[] = [
  { horasAntes: 48, reembolsoPct: 100 },
  { horasAntes: 24, reembolsoPct: 50 },
  { horasAntes: 0, reembolsoPct: 0 },
];

export type BolsaOrigen = "membresia_mes" | "bono" | "pago_suelto";
export type OrigenCancelacion = "inquilino" | "operador";

export type ResultadoCancelacion = {
  reembolsoPct: number;
  devueltoCentavos: bigint;
  retenidoCentavos: bigint;
  minutosAReintegrar: number;
  bolsaDestino: BolsaOrigen; // vuelve a la MISMA bolsa de la que salió
  liberaSlot: boolean;
};

function horasHasta(ahora: Instante, inicio: Instante): number {
  return (inicio.getTime() - ahora.getTime()) / 3_600_000;
}

function escalonQueAplica(escalones: EscalonCancelacion[], horas: number): EscalonCancelacion | undefined {
  return [...escalones].sort((a, b) => b.horasAntes - a.horasAntes).find((e) => horas >= e.horasAntes);
}

export function calcularCancelacion(p: {
  inicio: Instante;
  ahora: Instante;
  cobradoCentavos: bigint;
  bolsaOrigen: BolsaOrigen;
  minutosDeCupoConsumidos: number;
  escalones: EscalonCancelacion[];
  origen: OrigenCancelacion;
}): ResultadoCancelacion {
  // Cancelación iniciada por el OPERADOR: 100% + compensación. NUNCA cae bajo la política del
  // inquilino — el que rompió el trato fue el centro.
  const pct = p.origen === "operador"
    ? 100
    : (escalonQueAplica(p.escalones, horasHasta(p.ahora, p.inicio))?.reembolsoPct ?? 0);

  // Enteros de centavos. La división de BigInt trunca hacia abajo (positivos).
  const devuelto = (p.cobradoCentavos * BigInt(pct)) / 100n;
  return {
    reembolsoPct: pct,
    devueltoCentavos: devuelto,
    retenidoCentavos: p.cobradoCentavos - devuelto,
    minutosAReintegrar: Math.round((p.minutosDeCupoConsumidos * pct) / 100),
    bolsaDestino: p.bolsaOrigen,
    liberaSlot: p.ahora < p.inicio,
  };
}

/** No-show: cobra 100%, consume el cupo igual que una hora usada, NO libera nada (ya pasó). */
export function calcularNoShow(p: { cobradoCentavos: bigint; minutosDeCupoConsumidos: number }): {
  retenidoCentavos: bigint;
  minutosConsumidos: number;
  liberaSlot: boolean;
} {
  return { retenidoCentavos: p.cobradoCentavos, minutosConsumidos: p.minutosDeCupoConsumidos, liberaSlot: false };
}
