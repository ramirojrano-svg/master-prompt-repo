// src/dominio/alta-entrada.ts — borde de entrada del alta, PURO y testeable (§11.2 regla 3).
// Vive afuera del archivo "use server" para poder importarlo y testearlo.

import { z } from "zod";

// Slug: minúsculas, números y guiones. La lista de reservados evita chocar con rutas de la app
// y con nombres phishing-prone (§6.11); el ciclo de vida completo (historial + 308) llega con F6.
export const SLUGS_RESERVADOS = new Set([
  "admin", "api", "app", "login", "logout", "alta", "panel", "mi", "mostrador", "c",
  "pagos", "soporte", "www", "ns1", "smtp", "mail", "secure", "static", "assets", "_next",
]);

export const AltaInput = z.object({
  nombreOperador: z.string().min(2).max(120),
  slug: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "solo minúsculas, números y guiones")
    .refine((s) => !SLUGS_RESERVADOS.has(s), "esa dirección está reservada"),
  pais: z.string().length(2),
  nombreSede: z.string().min(2).max(120),
  direccion: z.string().max(200).optional(),
  nombreUsuario: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export type AltaInputT = z.infer<typeof AltaInput>;
