// src/dominio/locks.test.ts — T-33, T-34 (§15)
import { test } from "node:test";
import assert from "node:assert/strict";
import { claveLockInquilino, claveLockSala, clavesDeLock, diasTocados } from "./locks.ts";
import { instanteDeHoraLocal } from "./motor/zona.ts";

const AR = ["America", "Argentina", "Buenos_Aires"].join("/");

test("T-33 · una reserva que cruza la medianoche local toca los DOS días", () => {
  const inicio = instanteDeHoraLocal("2026-08-12", "23:00", AR)!;
  const fin = instanteDeHoraLocal("2026-08-13", "01:00", AR)!;
  assert.deepEqual(diasTocados(inicio, fin, AR), ["2026-08-12", "2026-08-13"]);

  const claves = clavesDeLock({ salaId: "sa1", inquilinoId: "in1", inicio, fin, tz: AR });
  assert.ok(claves.includes(claveLockSala("sa1", "2026-08-12")));
  assert.ok(claves.includes(claveLockSala("sa1", "2026-08-13")));
  assert.ok(claves.includes(claveLockInquilino("in1", "2026-08-12")));
  assert.ok(claves.includes(claveLockInquilino("in1", "2026-08-13")));
});

test("fin exclusivo: 23:00-00:00 toca un solo día", () => {
  const inicio = instanteDeHoraLocal("2026-08-12", "23:00", AR)!;
  const fin = instanteDeHoraLocal("2026-08-13", "00:00", AR)!;
  assert.deepEqual(diasTocados(inicio, fin, AR), ["2026-08-12"]);
});

test("T-34 · las claves salen SIEMPRE ordenadas ascendentemente (anti-deadlock)", () => {
  const inicio = instanteDeHoraLocal("2026-08-12", "10:00", AR)!;
  const fin = instanteDeHoraLocal("2026-08-12", "11:00", AR)!;
  // dos series con salas invertidas: ambas producen el MISMO orden de claves
  const a = clavesDeLock({ salaId: "sa9", inquilinoId: "in1", inicio, fin, tz: AR });
  const b = clavesDeLock({ salaId: "sa1", inquilinoId: "in9", inicio, fin, tz: AR });
  assert.deepEqual(a, [...a].sort());
  assert.deepEqual(b, [...b].sort());
});

test("sin inquilino (bloqueo) solo hay claves de sala", () => {
  const inicio = instanteDeHoraLocal("2026-08-12", "10:00", AR)!;
  const fin = instanteDeHoraLocal("2026-08-12", "11:00", AR)!;
  const claves = clavesDeLock({ salaId: "sa1", inquilinoId: null, inicio, fin, tz: AR });
  assert.deepEqual(claves, [claveLockSala("sa1", "2026-08-12")]);
});
