// src/lib/tenant.ts — contexto de tenant por request, vía AsyncLocalStorage (§11.3).
// Lo setea la capa de sesión (requireUsuario, en F2). El guard de prisma.ts lo lee para inyectar
// el operadorId como SEGUNDA cerradura. Sin contexto (caminos sin sesión: webhooks, crons, la
// superficie pública) el guard queda INERTE: ahí el operadorId explícito en cada where es lo
// único que separa un tenant de otro.

import { AsyncLocalStorage } from "node:async_hooks";

export type TenantCtx = { operadorId: string };

const als = new AsyncLocalStorage<TenantCtx>();

/**
 * Corre `fn` con el contexto de tenant activo. Envuelve en async + await a propósito: el
 * callback de la extensión de Prisma se ejecuta DIFERIDO, y sin el await el contexto se perdería
 * (als.run habría salido antes de que corra la extensión). Con el await, el contexto se propaga
 * por la cadena de promesas hasta que la query termina.
 */
export function conTenant<T>(ctx: TenantCtx, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, async () => await fn());
}

export function getTenantCtx(): TenantCtx | undefined {
  return als.getStore();
}
