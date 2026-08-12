// src/db/prisma.ts — cliente Prisma singleton.
//
// NOTA (§11.3): el guard de tenant transversal ($extends que inyecta operadorId) llega con la
// sesión en F2 (necesita el AsyncLocalStorage que setea requireUser). Hasta entonces —y
// siempre, porque el guard queda inerte en los caminos sin sesión— cada query lleva su
// operadorId EXPLÍCITO, que es lo que de verdad sostiene el aislamiento. El guard es la red
// que ataja el olvido; el where explícito es lo que sostiene el sistema.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
