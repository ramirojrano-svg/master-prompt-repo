// src/servicios/reportes/movimientos.ts — cómo se parte el libro en "facturado" y "cobrado".
//
// Una sola definición, usada por TODAS las pantallas que muestran esos dos números: Negocio, el
// reporte mensual, Cobranza y la ficha del profesional. Estaba escrita cuatro veces, se arregló en
// una, y las otras tres siguieron mintiendo durante semanas sin que nada fallara.
//
// EL ERROR QUE ESTO CIERRA: clasificar por SIGNO. Parece obvio —lo positivo se factura, lo
// negativo se cobra— y es correcto hasta que algo se da vuelta:
//
//   · Cancelar un turno asienta una `nota_credito` NEGATIVA. Por signo caía en "cobrado": el
//     profesional figuraba pagando una plata que nunca mandó.
//   · Anular un cobro asienta un `ajuste_debito` POSITIVO. Por signo caía en "facturado": aparecía
//     una venta que no existió, y el pago anulado seguía contando como cobrado igual.
//
// Las dos juntas dejaban el saldo del mes en NEGATIVO —el centro debiéndole plata al profesional—
// cuando en realidad era al revés.
//
// EL CRITERIO CORRECTO es el concepto, y para una reversa el concepto del asiento que da vuelta:
// si el original era un `pago`, la reversa es plata que se fue; si no, es facturación que se cae.
//
//   facturado = todo lo que NO es pago ni reversa de pago, con su signo
//               (así una nota de crédito RESTA de lo facturado, que es lo que corresponde)
//   cobrado   = los pagos y sus reversas, cambiados de signo
//               (el pago es negativo ⇒ suma; su reversa es positiva ⇒ resta)
//
// Ambos se usan dentro de un SELECT que tenga `a` como el asiento y `orig` como el asiento al que
// `a."revierteAId"` apunta (LEFT JOIN, así `orig."concepto"` es NULL cuando no revierte nada).

import { Prisma } from "@prisma/client";

/** El LEFT JOIN que trae el asiento revertido. Va después del FROM "Asiento" a. */
export const JOIN_REVERTIDO = Prisma.sql`LEFT JOIN "Asiento" orig ON orig."id" = a."revierteAId"`;

/** Lo facturado: todo lo que no es plata que entró ni salió. Los créditos restan solos. */
export const SUMA_FACTURADO = Prisma.sql`
  COALESCE(SUM(CASE WHEN a."concepto" <> 'pago'::"Concepto"
                     AND (orig."concepto" IS NULL OR orig."concepto" <> 'pago'::"Concepto")
                    THEN a."montoCent" ELSE 0 END), 0)::bigint`;

/** Lo cobrado: los pagos y sus anulaciones, en positivo. Un pago anulado neto da cero. */
export const SUMA_COBRADO = Prisma.sql`
  COALESCE(SUM(CASE WHEN a."concepto" = 'pago'::"Concepto"
                      OR orig."concepto" = 'pago'::"Concepto"
                    THEN -a."montoCent" ELSE 0 END), 0)::bigint`;
