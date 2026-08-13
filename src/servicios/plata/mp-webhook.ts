// src/servicios/plata/mp-webhook.ts — procesamiento de un pago de Mercado Pago (§5.7.3).
// El body del webhook es un AVISO, no un dato: el route handler valida la firma, re-consulta el
// pago a MP con el token del operador, y recién ahí llama acá con el `pago` ya traído. Esta capa
// es pura respecto de HTTP (recibe el pago inyectado), así se testea sin MP.
//
// Reglas: (1) cross-tenant — el collector del pago tiene que ser el operador del external_reference,
// si no 403 y CERO escrituras. (2) monto — un aprobado por MENOS que lo esperado no acredita.
// (3) idempotencia — clave `mp:<id>`; MP renotifica y el P2002 se traga. (4) reversas — solo si
// el asiento original existe (un pending→cancelled que nunca acreditó no resta nada).

import { type PrismaClient } from "@prisma/client";
import { asentarIdempotente } from "./ledger.ts";

export type PagoMP = {
  id: string | number;
  status: string; // approved | refunded | charged_back | cancelled | pending | ...
  transaction_amount: number; // en unidades de la moneda (no centavos)
  collector_id: string | number;
};

export type ContextoPago = {
  operadorId: string;
  inquilinoId: string;
  mpUserIdOperador: string; // el collector_id que DEBE tener el pago
  montoEsperadoCent: bigint;
  moneda: string;
  periodo: string;
  fechaHecho: Date;
};

export type EfectoWebhook =
  | "cross_tenant" // 403, cero escrituras
  | "acreditado"
  | "ya_estaba" // renotificación
  | "pago_insuficiente" // aprobado por menos: no acredita, alerta
  | "reversado"
  | "sin_reversa" // reversa de un pago que nunca acreditó: no resta
  | "ignorado"; // estado que no sabemos traducir

const REVERSAS = new Set(["refunded", "charged_back", "cancelled"]);

export async function procesarPagoMP(
  db: Pick<PrismaClient, "asiento">,
  pago: PagoMP,
  ctx: ContextoPago,
): Promise<{ ok: boolean; efecto: EfectoWebhook }> {
  // (1) Cross-tenant: el cobrador tiene que ser el operador del external_reference.
  if (String(pago.collector_id) !== ctx.mpUserIdOperador) {
    return { ok: false, efecto: "cross_tenant" };
  }

  const claveMp = `mp:${pago.id}`;
  const brutoCent = BigInt(Math.round(pago.transaction_amount * 100));

  if (pago.status === "approved") {
    // (2) Monto: un aprobado por MENOS que lo esperado NO acredita.
    if (brutoCent < ctx.montoEsperadoCent) {
      return { ok: true, efecto: "pago_insuficiente" };
    }
    // (3) Acreditación idempotente. Monto BRUTO al inquilino (el fee de MP es egreso del
    //     operador, fila aparte; nunca se descuenta del asiento).
    const r = await asentarIdempotente(db, {
      operadorId: ctx.operadorId,
      inquilinoId: ctx.inquilinoId,
      concepto: "pago",
      montoCent: -brutoCent, // pago = a favor del inquilino
      moneda: ctx.moneda,
      periodo: ctx.periodo,
      fechaHecho: ctx.fechaHecho,
      clave: claveMp,
      pagoId: String(pago.id),
    });
    return { ok: true, efecto: r.creado ? "acreditado" : "ya_estaba" };
  }

  if (REVERSAS.has(pago.status)) {
    // (4) Reversas: SOLO si el asiento original existe.
    const original = await db.asiento.findFirst({ where: { operadorId: ctx.operadorId, clave: claveMp }, select: { id: true, montoCent: true } });
    if (!original) return { ok: true, efecto: "sin_reversa" };
    const r = await asentarIdempotente(db, {
      operadorId: ctx.operadorId,
      inquilinoId: ctx.inquilinoId,
      concepto: "ajuste_debito", // la plata volvió: el inquilino DEBE de nuevo (+)
      montoCent: -original.montoCent, // opuesto del original (que era negativo) => positivo
      moneda: ctx.moneda,
      periodo: ctx.periodo,
      fechaHecho: ctx.fechaHecho,
      clave: `mp-reversa:${pago.id}`,
      revierteAId: original.id,
      motivo: `reversa MP (${pago.status})`,
    });
    return { ok: true, efecto: r.creado ? "reversado" : "ya_estaba" };
  }

  // Un estado que no sabemos traducir no se adopta: se loguea y se devuelve 200.
  return { ok: true, efecto: "ignorado" };
}
