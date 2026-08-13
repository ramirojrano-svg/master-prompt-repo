"use server";
// app/(alta)/alta/acciones.ts — server action del alta.
// Un archivo "use server" solo puede exportar funciones async: por eso el schema vive en
// src/dominio/alta-entrada.ts (puro y testeable) y los tipos se declaran como `type` exportado
// desde... otro lado. Acá solo va la función.
//
// ⚠️ Una server action ES un endpoint HTTP público: la validación se hace SIEMPRE acá, no en el
// formulario. Los mensajes son honestos (§6.9): nunca "no se pudo" cuando la causa es conocida.

import { AltaInput } from "../../../src/dominio/alta-entrada.ts";
import { altaOperador } from "../../../src/servicios/operador/alta.ts";
import type { SalidaAlta } from "./tipos.ts";

export async function crearCentro(raw: unknown): Promise<SalidaAlta> {
  const p = AltaInput.safeParse(raw);
  if (!p.success) {
    const primero = p.error.issues[0];
    return { ok: false, mensaje: `Revisá el campo "${primero?.path.join(".") ?? "?"}": ${primero?.message ?? "dato inválido"}.` };
  }

  const r = await altaOperador(p.data);
  if (r.ok) return { ok: true, zonaHoraria: r.zonaHoraria };

  switch (r.error) {
    case "PAIS_INVALIDO":
      return { ok: false, mensaje: "Ese país todavía no está habilitado." };
    case "SLUG_TOMADO":
      return { ok: false, mensaje: "Esa dirección web ya está usada. Probá con otra." };
    case "EMAIL_TOMADO":
      return { ok: false, mensaje: "Ya hay una cuenta con ese email. Iniciá sesión en vez de crear otra." };
  }
}
