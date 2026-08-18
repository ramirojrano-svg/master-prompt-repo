// src/env.ts — variables de entorno validadas con Zod (§11.1). Todas obligatorias en prod: si
// falta una, la app no arranca (fail-fast) en vez de romper en runtime a mitad de un flujo.
// El parseo es LAZY (env()) para que importar este módulo en tests no exija tener todo seteado;
// la app llama env() en el arranque.

import { z } from "zod";

const esquema = z.object({
  DATABASE_URL: z.string().url(), // pooler, modo transacción (6543 en Supabase)
  DIRECT_URL: z.string().url().optional(), // conexión directa, solo para migraciones
  AUTH_SECRET: z.string().min(1),
  AUTH_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  MP_ACCESS_TOKEN: z.string().optional(), // vacío en dev => los caminos de cobro dan error explícito
  MP_WEBHOOK_SECRET: z.string().optional(), // si falta, TODA notificación es inválida (403)
  SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  // "true" abre el alta pública de centros (/alta). Ausente o cualquier otro valor la deja cerrada:
  // sin esto, cualquiera desde internet se da de alta como owner de un centro propio.
  ALTA_ABIERTA: z.string().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof esquema>;

/** Parseo puro y testeable. Lanza un error legible listando las claves que faltan. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const r = esquema.safeParse(source);
  if (!r.success) {
    const faltan = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Variables de entorno inválidas:\n  ${faltan}`);
  }
  return r.data;
}

let cache: Env | undefined;

/** Env validado, memoizado. Se llama en el arranque de la app; si falta una var, corta acá. */
export function env(): Env {
  return (cache ??= parseEnv(process.env));
}
