// src/servicios/plata/membresias.ts — alta, cobro y otorgamiento de cupo de una membresía (§4.12
// / §5.4). El cupo se otorga PEREZOSAMENTE en el primer uso del período, por diferencia y con
// clave idempotente: una cuenta muerta (membresía no vigente) no acumula regalos.

import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { membresiaVigente } from "../../lib/plata/membresia.ts";
import { asentarIdempotente } from "./ledger.ts";
import { otorgarCupoMes } from "./cupo.ts";

export type AltaMembresia = {
  operadorId: string;
  inquilinoId: string;
  nombre: string;
  precioMensualCent: bigint;
  minutosIncluidos: number;
  precioExcedenteCent?: bigint;
  vigenteDesde: Date;
  vigenteHasta: Date; // fin del período; se corre hacia adelante con cada cobro
};

export async function altaMembresia(a: AltaMembresia, db: PrismaClient = prisma): Promise<{ membresiaId: string }> {
  const m = await db.membresia.create({
    data: {
      operadorId: a.operadorId,
      inquilinoId: a.inquilinoId,
      nombre: a.nombre,
      precioMensualCent: a.precioMensualCent,
      minutosIncluidos: a.minutosIncluidos,
      precioExcedenteCent: a.precioExcedenteCent ?? null,
      estado: "activa",
      vigenteDesde: a.vigenteDesde,
      vigenteHasta: a.vigenteHasta,
    },
    select: { id: true },
  });
  return { membresiaId: m.id };
}

/** Cargo mensual del abono. Idempotente: un solo cargo por (membresía, período). */
export async function cobrarMembresia(
  db: Pick<PrismaClient, "asiento">,
  a: { operadorId: string; inquilinoId: string; membresiaId: string; periodo: string; montoCent: bigint; moneda: string; fechaHecho: Date },
): Promise<{ creado: boolean }> {
  const r = await asentarIdempotente(db, {
    operadorId: a.operadorId,
    inquilinoId: a.inquilinoId,
    concepto: "cargo_membresia",
    montoCent: a.montoCent,
    moneda: a.moneda,
    periodo: a.periodo,
    fechaHecho: a.fechaHecho,
    clave: `cargo_membresia:${a.membresiaId}:${a.periodo}`,
  });
  return { creado: r.creado };
}

/**
 * Otorga el cupo de horas de la membresía en el período, PEREZOSAMENTE y por diferencia. Si la
 * membresía no está vigente, no acredita nada (§9: una cuenta muerta no acumula regalos). La
 * clave `cupo:<membresiaId>:<periodo>` hace idempotente el primer otorgamiento del período; un
 * upgrade usa otra clave y acredita la diferencia (ver cupo.ts).
 */
export async function otorgarCupoDeMembresia(
  db: Pick<PrismaClient, "bolsaAsiento">,
  a: {
    membresia: { id: string; operadorId: string; inquilinoId: string; minutosIncluidos: number; estado: string; vigenteHasta: Date | null };
    periodo: string;
    ahora: Date;
  },
): Promise<{ otorgado: number }> {
  if (!membresiaVigente(a.membresia, a.ahora)) return { otorgado: 0 };
  return otorgarCupoMes(db, {
    operadorId: a.membresia.operadorId,
    inquilinoId: a.membresia.inquilinoId,
    clave: `cupo:${a.membresia.id}:${a.periodo}`,
    periodo: a.periodo,
    minutosObjetivo: a.membresia.minutosIncluidos,
    origenId: a.membresia.id,
  });
}
