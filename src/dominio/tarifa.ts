// src/dominio/tarifa.ts — resolución de tarifa y cotización. PURO y testeable.
//
// La misma función la usa la pantalla (para mostrar "esta hora sale $X") y la acción que
// confirma (para cobrarla). Prohibido reimplementar el precio en el front: el día que difieran,
// el profesional ve un número en pantalla y otro en la factura (§5.1).

export type TarifaVigente = {
  id: string;
  salaId: string | null; // null = todas las salas
  inquilinoId: string | null; // null = todos los profesionales
  precioHoraCent: bigint;
  vigenteDesde: Date;
  vigenteHasta: Date | null;
};

export type Cotizacion = {
  tarifaId: string | null;
  precioHoraCent: bigint;
  importeCent: bigint;
  /** De dónde salió el precio: se guarda para poder explicar, meses después, por qué salió eso. */
  fuente: "profesional_y_sala" | "profesional" | "sala" | "general" | "sin_tarifa";
};

/** Una tarifa rige en `ahora` si ya empezó y todavía no se cerró. */
export function tarifaRige(t: TarifaVigente, ahora: Date): boolean {
  if (t.vigenteDesde > ahora) return false;
  return t.vigenteHasta === null || t.vigenteHasta > ahora;
}

/**
 * Especificidad: cuanto más apunta a un caso concreto, más manda.
 *   3 = este profesional en esta sala · 2 = este profesional · 1 = esta sala · 0 = general
 */
function especificidad(t: TarifaVigente): number {
  return (t.inquilinoId ? 2 : 0) + (t.salaId ? 1 : 0);
}

function fuenteDe(t: TarifaVigente): Cotizacion["fuente"] {
  if (t.inquilinoId && t.salaId) return "profesional_y_sala";
  if (t.inquilinoId) return "profesional";
  if (t.salaId) return "sala";
  return "general";
}

/**
 * Elige la tarifa que aplica a (sala, profesional) en `ahora`. Entre dos igual de específicas
 * gana la que empezó DESPUÉS (la más nueva), que es lo que espera quien acaba de cambiar el
 * precio. Devuelve null si no hay ninguna: eso NO es un precio de cero, es "sin tarifa".
 */
export function resolverTarifa(
  tarifas: TarifaVigente[],
  ctx: { salaId: string; inquilinoId: string; ahora: Date },
): TarifaVigente | null {
  const aplicables = tarifas.filter(
    (t) =>
      tarifaRige(t, ctx.ahora) &&
      (t.salaId === null || t.salaId === ctx.salaId) &&
      (t.inquilinoId === null || t.inquilinoId === ctx.inquilinoId),
  );
  if (aplicables.length === 0) return null;

  return aplicables.reduce((mejor, t) => {
    const de = especificidad(t) - especificidad(mejor);
    if (de !== 0) return de > 0 ? t : mejor;
    return t.vigenteDesde > mejor.vigenteDesde ? t : mejor;
  });
}

/**
 * Importe de una reserva. Se prorratea por MINUTOS (media hora vale la mitad) y se redondea al
 * centavo hacia abajo: nunca cobrar de más por un redondeo (§5.4). BigInt, jamás float.
 */
export function cotizar(t: TarifaVigente | null, minutos: number): Cotizacion {
  if (!t) return { tarifaId: null, precioHoraCent: 0n, importeCent: 0n, fuente: "sin_tarifa" };
  const importeCent = (t.precioHoraCent * BigInt(Math.max(0, Math.round(minutos)))) / 60n;
  return { tarifaId: t.id, precioHoraCent: t.precioHoraCent, importeCent, fuente: fuenteDe(t) };
}

/** Formatea centavos como plata local: 800000 => "$ 8.000,00". */
export function formatearPesos(centavos: bigint, moneda = "ARS", locale = "es-AR"): string {
  const entero = Number(centavos) / 100;
  return new Intl.NumberFormat(locale, { style: "currency", currency: moneda, minimumFractionDigits: 2 }).format(entero);
}
