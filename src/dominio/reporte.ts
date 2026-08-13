// src/dominio/reporte.ts — la aritmética del panel de datos. PURO y testeable.
//
// Dos reglas que hacen que un reporte sirva para discutir con un contador (§6.8):
//  1. El detalle SUMA EXACTO el total. Si sobra algo que no se pudo atribuir, se muestra como
//     "Sin detallar" en vez de desaparecer: un número que no cierra se descubre solo cuando ya
//     se facturó mal.
//  2. Nadie se cae de la lista. El profesional de baja y la sala archivada siguen apareciendo si
//     tuvieron actividad: un filtro no puede borrar historia.

export type FechaLocal = string; // 'YYYY-MM-DD'
export type Periodo = string; // 'YYYY-MM'

/** ¿Es un 'YYYY-MM' real? (mes 13 no existe). */
export function esPeriodoValido(p: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(p);
  if (!m) return false;
  const mes = Number(m[2]);
  return mes >= 1 && mes <= 12;
}

/** Todas las fechas del período, en orden. Sin Date: aritmética de calendario a mano. */
export function diasDelPeriodo(p: Periodo): FechaLocal[] {
  if (!esPeriodoValido(p)) return [];
  const anio = Number(p.slice(0, 4));
  const mes = Number(p.slice(5, 7));
  // Día 0 del mes siguiente = último del actual. Sirve para febrero bisiesto sin casos especiales.
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return Array.from({ length: ultimo }, (_, k) => `${p}-${String(k + 1).padStart(2, "0")}`);
}

/** El período anterior a uno dado ('2026-01' => '2025-12'). */
export function periodoAnterior(p: Periodo): Periodo {
  const anio = Number(p.slice(0, 4));
  const mes = Number(p.slice(5, 7));
  return mes === 1 ? `${anio - 1}-12` : `${anio}-${String(mes - 1).padStart(2, "0")}`;
}

/**
 * Minutos que la sala ESTUVO ABIERTA en el período: el denominador de la ocupación. Se cuenta
 * día por día contra el horario semanal — un mes con cinco lunes no abre lo mismo que uno con
 * cuatro, y usar "30 días × 14 h" infla el denominador y hunde el porcentaje.
 */
export function aperturaDelPeriodoMin(
  franjasPorDia: (dia: number) => { desdeMin: number; hastaMin: number }[],
  diaSemanaDe: (f: FechaLocal) => number | null,
  dias: FechaLocal[],
): number {
  let total = 0;
  for (const f of dias) {
    const d = diaSemanaDe(f);
    if (d == null) continue;
    for (const fr of franjasPorDia(d)) total += Math.max(0, fr.hastaMin - fr.desdeMin);
  }
  return total;
}

export type FilaDetalle = { id: string; montoCent: bigint };

/**
 * Lo que el detalle NO explica del total. Se calcula siempre y se muestra si no es cero: preferir
 * un "Sin detallar: $1.200" incómodo a un total que miente por $1.200.
 */
export function sinDetallar(totalCent: bigint, filas: FilaDetalle[]): bigint {
  return totalCent - filas.reduce((acc, f) => acc + f.montoCent, 0n);
}

/** Porcentaje entero, con el denominador a la vista. 0 minutos abiertos => 0%, nunca NaN ni ∞. */
export function porcentaje(parteMin: number, totalMin: number): number {
  return totalMin > 0 ? Math.round((parteMin / totalMin) * 100) : 0;
}

/** Minutos como '12 h 30′'. Sin decimales: nadie factura 12,5 horas, factura 12 h 30. */
export function horasYMinutos(min: number): string {
  const h = Math.floor(Math.abs(min) / 60);
  const m = Math.abs(min) % 60;
  const signo = min < 0 ? "−" : "";
  if (h === 0) return `${signo}${m}′`;
  return m === 0 ? `${signo}${h} h` : `${signo}${h} h ${m}′`;
}
