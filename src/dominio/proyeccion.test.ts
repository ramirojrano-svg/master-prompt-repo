// src/dominio/proyeccion.test.ts — §6.3, la regla dura de privacidad.
import { test } from "node:test";
import assert from "node:assert/strict";
import { proyectarReserva, vistaDe, type FilaReserva } from "./proyeccion.ts";
import type { Rol } from "../lib/permisos.ts";

const fila: FilaReserva = {
  id: "oc1",
  salaId: "sa1",
  inquilinoId: "in1",
  inquilinoNombre: "María Gómez (Psicología)",
  tipo: "reserva",
  estado: "confirmada",
  serieId: null,
  inicio: new Date("2026-08-12T12:00:00Z"),
  fin: new Date("2026-08-12T13:00:00Z"),
  motivo: null,
  notaInterna: "Martín 16h",
};

const actor = (rol: Rol, inquilinoId: string | null = null) => ({ rol, inquilinoId });

test("la vista AJENA no filtra identidad: solo id, sala, horario y 'ocupado'", () => {
  const dto = proyectarReserva(fila, actor("inquilino_titular", "in9"));
  assert.deepEqual(Object.keys(dto).sort(), ["estado", "fin", "id", "inicio", "salaId"]);
  assert.equal((dto as { estado: string }).estado, "ocupado");
  // el nombre y la nota NO aparecen en ninguna parte del payload
  assert.ok(!JSON.stringify(dto).includes("María"));
  assert.ok(!JSON.stringify(dto).includes("Martín"));
});

test("un ocupado y un mantenimiento son INDISTINGUIBLES para un inquilino ajeno", () => {
  const mantenimiento: FilaReserva = { ...fila, id: "oc2", tipo: "mantenimiento", inquilinoId: null, inquilinoNombre: null, motivo: "Limpieza profunda", notaInterna: null };
  const a = proyectarReserva(fila, actor("inquilino_titular", "in9"));
  const b = proyectarReserva(mantenimiento, actor("inquilino_titular", "in9"));
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
  assert.equal((a as { estado: string }).estado, (b as { estado: string }).estado);
});

test("el OPERADOR ve identidad pero NO la nota privada del inquilino", () => {
  const dto = proyectarReserva(fila, actor("owner")) as Record<string, unknown>;
  assert.equal(dto.inquilinoNombre, "María Gómez (Psicología)");
  assert.equal("notaInterna" in dto, false, "la nota privada no sale ni para el owner");
});

test("la recepción ve identidad (necesita saber quién entra) pero tampoco la nota", () => {
  const dto = proyectarReserva(fila, actor("recepcion")) as Record<string, unknown>;
  assert.equal(dto.inquilinoNombre, "María Gómez (Psicología)");
  assert.equal("notaInterna" in dto, false);
});

test("la vista PROPIA sí incluye la nota privada", () => {
  const dto = proyectarReserva(fila, actor("inquilino_titular", "in1")) as Record<string, unknown>;
  assert.equal(dto.notaInterna, "Martín 16h");
});

test("vistaDe: operador / propia / ajena", () => {
  assert.equal(vistaDe(actor("owner"), fila), "operador");
  assert.equal(vistaDe(actor("inquilino_titular", "in1"), fila), "propia");
  assert.equal(vistaDe(actor("inquilino_titular", "in9"), fila), "ajena");
  // un inquilino sin vínculo nunca "hereda" una reserva sin dueño
  assert.equal(vistaDe(actor("inquilino_titular", null), { inquilinoId: null }), "ajena");
});

// ── La PLATA se gatea aparte de la identidad ────────────────────────────────
const conPrecio: FilaReserva = { ...fila, importeCent: 1_200_000n };

test("el owner ve el importe de la reserva", () => {
  const dto = proyectarReserva(conPrecio, actor("owner")) as Record<string, unknown>;
  assert.equal(dto.importeCent, "1200000", "string: un BigInt no viaja al cliente");
});

test("la RECEPCIÓN ve quién está en la sala pero NO cuánto paga", () => {
  const dto = proyectarReserva(conPrecio, actor("recepcion")) as Record<string, unknown>;
  assert.equal(dto.inquilinoNombre, "María Gómez (Psicología)");
  assert.equal(dto.importeCent, null, "identidad y plata son permisos distintos (§6.2)");
});

test("el profesional ve el importe de SU reserva", () => {
  const dto = proyectarReserva(conPrecio, actor("inquilino_titular", "in1")) as Record<string, unknown>;
  assert.equal(dto.importeCent, "1200000");
});

test("el staff del profesional agenda pero no mira la facturación del titular", () => {
  const dto = proyectarReserva(conPrecio, actor("inquilino_staff", "in1")) as Record<string, unknown>;
  assert.equal(dto.notaInterna, "Martín 16h", "es su vista propia");
  assert.equal(dto.importeCent, null, "pero sin cuenta.ver.propia no hay plata");
});

test("el importe JAMÁS aparece en la vista ajena", () => {
  const dto = proyectarReserva(conPrecio, actor("inquilino_titular", "in9"));
  assert.equal("importeCent" in dto, false);
  assert.ok(!JSON.stringify(dto).includes("1200000"));
});

test("sin precio cargado el importe es null, no cero", () => {
  const dto = proyectarReserva(fila, actor("owner")) as Record<string, unknown>;
  assert.equal(dto.importeCent, null);
});
