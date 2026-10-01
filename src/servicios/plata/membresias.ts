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

/**
 * Cargo mensual del abono. Un solo cargo por (PROFESIONAL, período).
 *
 * La clave era por MEMBRESÍA, y eso dejaba entrar un duplicado por una puerta que se usa seguido:
 * cambiar el importe del abono no edita la membresía, la cierra y crea otra (§8.8). Así que
 * corregir un abono y volver a apretar "cobrar los abonos del mes" posteaba un SEGUNDO cargo del
 * mismo mes —el viejo y el nuevo, los dos vivos— y al profesional le aparecían dos renglones. Es
 * exactamente lo que pasa cuando uno se equivoca al cargar el importe, que es cuando más
 * probable es que lo corrija y vuelva a apretar.
 *
 * Por eso la clave es del profesional y el mes: no hay forma de que haya dos. Y como el abono
 * puede haber cambiado entre un intento y el otro, si ya existe un cargo del mes SIN LIQUIDAR y
 * por otro importe, se corrige al vigente en vez de ignorarlo: el operador aprieta justamente
 * porque el número anterior estaba mal. Lo ya liquidado no se toca — hay un papel emitido.
 */
export async function cobrarMembresia(
  db: Pick<PrismaClient, "asiento">,
  a: { operadorId: string; inquilinoId: string; membresiaId: string; periodo: string; montoCent: bigint; moneda: string; fechaHecho: Date },
): Promise<{ creado: boolean; corregido: boolean; consolidados: number }> {
  const clave = `cargo_membresia:${a.inquilinoId}:${a.periodo}`;

  // Los duplicados que ya quedaron en la base, de cuando la clave era por membresía. Se juntan en
  // uno solo: son el mismo hecho económico contado dos veces, y mientras estén el profesional ve
  // dos renglones por un abono que es uno.
  const previos = await db.asiento.findMany({
    where: {
      operadorId: a.operadorId, inquilinoId: a.inquilinoId,
      periodo: a.periodo, concepto: "cargo_membresia", liquidacionId: null,
    },
    select: { id: true, montoCent: true, clave: true },
    orderBy: { id: "asc" },
  });

  if (previos.length > 0) {
    const sobran = previos.slice(1);
    if (sobran.length > 0) {
      await db.asiento.deleteMany({ where: { id: { in: sobran.map((x) => x.id) } } });
    }
    const queda = previos[0]!;
    const hayQueCorregir = queda.montoCent !== a.montoCent || queda.clave !== clave;
    if (hayQueCorregir) {
      await db.asiento.update({ where: { id: queda.id }, data: { montoCent: a.montoCent, clave } });
    }
    return { creado: false, corregido: hayQueCorregir, consolidados: sobran.length };
  }

  const r = await asentarIdempotente(db, {
    operadorId: a.operadorId,
    inquilinoId: a.inquilinoId,
    concepto: "cargo_membresia",
    montoCent: a.montoCent,
    moneda: a.moneda,
    periodo: a.periodo,
    fechaHecho: a.fechaHecho,
    clave,
  });
  return { creado: r.creado, corregido: false, consolidados: 0 };
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
