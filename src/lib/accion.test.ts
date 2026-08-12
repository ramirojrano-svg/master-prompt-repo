// src/lib/accion.test.ts — el envoltorio definirAccion (§6.2)
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { definirAccion } from "./accion.ts";
import type { Actor } from "./actor.ts";

const schema = z.object({ salaId: z.string().min(1) });
const accion = definirAccion({ permiso: "sala.administrar", schema }, async (actor, input) => {
  return `${actor.rol}:${input.salaId}`;
});

const owner: Actor = { usuarioId: "u", operadorId: "op1", rol: "owner", inquilinoId: null };
const inquilino: Actor = { usuarioId: "u", operadorId: "op1", rol: "inquilino_titular", inquilinoId: "in1" };

test("permitido: rol con el permiso + input válido => ok", async () => {
  assert.deepEqual(await accion(owner, { salaId: "sa1" }), { ok: true, data: "owner:sa1" });
});

test("SIN_PERMISO: el rol no tiene el permiso (aunque el input sea válido)", async () => {
  assert.deepEqual(await accion(inquilino, { salaId: "sa1" }), { ok: false, error: "SIN_PERMISO" });
});

test("ENTRADA_INVALIDA: rol con permiso pero input roto", async () => {
  assert.deepEqual(await accion(owner, { salaId: "" }), { ok: false, error: "ENTRADA_INVALIDA" });
});

test("el permiso se chequea ANTES del schema (no filtra forma del input a quien no puede)", async () => {
  assert.deepEqual(await accion(inquilino, { basura: 1 }), { ok: false, error: "SIN_PERMISO" });
});
