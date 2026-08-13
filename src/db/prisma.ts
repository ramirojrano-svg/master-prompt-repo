// src/db/prisma.ts — cliente Prisma singleton + guard de tenant transversal (§11.3).
//
// DOS mecanismos, y el segundo es el que de verdad salva:
//  (a) Este guard ($extends) inyecta operadorId en las operaciones con `where` arbitrario,
//      PERO SOLO cuando hay contexto de sesión (getTenantCtx()). Queda INERTE en todo camino
//      sin sesión (webhooks, crons, superficie pública): ahí no hay a quién scopear.
//  (b) El operadorId EXPLÍCITO en cada where (en los servicios). Es lo que sostiene el sistema;
//      el guard es la red que ataja el olvido. Por eso los servicios NO dependen del guard.
//
// El guard NO cubre findUnique/create: su where solo acepta campos únicos y va precedido de un
// chequeo de pertenencia explícito (findFirst({id, operadorId})).

import { PrismaClient } from "@prisma/client";
import { getTenantCtx } from "../lib/tenant.ts";

// Modelos con operadorId (tenant). Solo las ops donde un where olvidado filtra datos ajenos.
const TENANT_MODELS = new Set([
  "Sede",
  "Sala",
  "Inquilino",
  "Ocupacion",
  "EsperaSlot",
  "BolsaAsiento",
  "UsuarioOperador",
]);
const SCOPED_OPS = new Set(["findMany", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy", "updateMany", "deleteMany"]);

/**
 * Construye un cliente CON el guard de tenant. Exportada para que los tests puedan apuntar a su
 * propia base sin perder el guard (si el test usara el singleton, escribiría en la base de
 * desarrollo y la mitad del test miraría datos de otra parte).
 */
export function crearPrismaConGuard(datasourceUrl?: string): PrismaClient {
  const base = datasourceUrl ? new PrismaClient({ datasourceUrl }) : new PrismaClient();
  return base.$extends({
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          const ctx = getTenantCtx();
          if (ctx && TENANT_MODELS.has(model) && SCOPED_OPS.has(operation)) {
            const a = args as { where?: Record<string, unknown> };
            a.where = { ...(a.where ?? {}), operadorId: ctx.operadorId };
          }
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? crearPrismaConGuard();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
