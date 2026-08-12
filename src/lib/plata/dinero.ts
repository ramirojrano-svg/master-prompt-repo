// src/lib/plata/dinero.ts — aritmética de plata, pura. Enteros de centavos (BigInt), jamás float.

/**
 * Desagrega IVA: el TOTAL es la verdad; neto e IVA se DERIVAN y cierran por resta (§5.8). Si se
 * calculan los tres por separado, la suma no da. `alicuotaDecimas` en décimas de % (210 = 21%).
 */
export function desagregarIva(totalCent: bigint, alicuotaDecimas: number): { netoCent: bigint; ivaCent: bigint } {
  if (alicuotaDecimas === 0) return { netoCent: totalCent, ivaCent: 0n };
  const d = BigInt(1000 + alicuotaDecimas);
  const netoCent = (totalCent * 1000n) / d; // trunca
  return { netoCent, ivaCent: totalCent - netoCent }; // por RESTA: siempre cierra
}

/**
 * Prorratea por días CALENDARIO restantes, contando el día del alta. Trunca hacia abajo: nunca
 * cobrar de más por un redondeo (§5.4).
 */
export function prorratear(montoCent: bigint, diasRestantes: number, diasDelMes: number): bigint {
  if (diasRestantes >= diasDelMes) return montoCent;
  if (diasRestantes <= 0) return 0n;
  return (montoCent * BigInt(diasRestantes)) / BigInt(diasDelMes);
}
