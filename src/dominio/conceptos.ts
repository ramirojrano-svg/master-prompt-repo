// src/dominio/conceptos.ts — cómo se llama cada concepto en castellano.
//
// Módulo PURO. Existe porque el enum de la base está escrito para el código —`penalidad_noshow`,
// `deposito_ejecucion`— y ese texto no puede ser lo que lea un profesional en el papel que recibe.
// Un documento donde figura "cargo_uso" no es un documento: es un volcado de la base.

import type { Concepto } from "@prisma/client";

const NOMBRES: Record<Concepto, string> = {
  cargo_uso: "Uso de consultorio",
  cargo_excedente: "Horas excedentes",
  cargo_membresia: "Membresía",
  cargo_exclusividad: "Exclusividad",
  cargo_bono: "Bono de horas",
  penalidad_tardia: "Cancelación fuera de término",
  penalidad_noshow: "Ausencia sin aviso",
  ajuste_debito: "Ajuste a favor del centro",
  deposito_alta: "Depósito en garantía",
  interes_mora: "Intereses por mora",
  pago: "Pago recibido",
  pago_con_deposito: "Pago tomado del depósito",
  nota_credito: "Nota de crédito",
  penalidad_revertida: "Penalidad sin efecto",
  reintegro: "Reintegro",
  ajuste_credito: "Ajuste a favor del profesional",
  deposito_devolucion: "Devolución del depósito",
  deposito_ejecucion: "Depósito ejecutado",
};

/** El nombre para mostrar. Si algún día se agrega un concepto y nadie toca este archivo, cae al
 *  identificador con los guiones bajos convertidos en espacios: feo, pero legible y nunca vacío. */
export function nombreDeConcepto(c: Concepto | string): string {
  return NOMBRES[c as Concepto] ?? String(c).replace(/_/g, " ");
}
