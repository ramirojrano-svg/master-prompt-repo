// src/dominio/motor/serie.test.ts — T-39, T-40 (§15)
import { test } from "node:test";
import assert from "node:assert/strict";
import { planificarSerie, type EntradaSerie } from "./serie.ts";
import { formatHora, instanteDeHoraLocal, sumarDiasLocal } from "./zona.ts";
import type { HorarioSemanal, Ocupacion, PoliticaCentro } from "./tipos.ts";

const AR = ["America", "Argentina", "Buenos_Aires"].join("/");
const CL = ["America", "Santiago"].join("/");
const abierto = [{ desde: "06:00", hasta: "23:00" }];
const HOR: HorarioSemanal = { 0: abierto, 1: abierto, 2: abierto, 3: abierto, 4: abierto, 5: abierto, 6: abierto };
const POL: PoliticaCentro = { pasoMin: 30, duracionMinMin: 15, duracionMaxMin: 720, bufferMin: 15, bufferMismoInquilino: 0, antelacionMinMin: 0, horizonteDias: 400 };

function serie(over: Partial<EntradaSerie>): EntradaSerie {
  return { fechaInicio: "2026-08-12", hora: "10:00", duracionMin: 60, semanas: 4, tz: AR, ocupaciones: [], horario: HOR, politica: POL, ...over };
}

test("T-39 · DST en el medio: todas las ocurrencias caen a las 09:00 locales (Santiago)", () => {
  // 2026-08-30 (invierno CL, -4) cruzando el salto del 2026-09-06 (verano CL, -3).
  const plan = planificarSerie(serie({ fechaInicio: "2026-08-30", hora: "09:00", tz: CL, semanas: 3 }));
  assert.equal(plan.ocurrencias.length, 3);
  for (const o of plan.ocurrencias) assert.equal(formatHora(o.inicio, CL), "09:00");
  // los instantes UTC NO son equidistantes por el cambio de offset
  const [a, b, c] = plan.ocurrencias.map((o) => o.inicio.getTime());
  assert.notEqual(b! - a!, c! - b!);
  assert.equal(plan.resumen.libres, 3);
});

test("T-40 · choque parcial: 12 semanas, 3 chocan => 9 libres + reporte, ninguna silenciosa", () => {
  const semanasChoque = [0, 5, 11];
  const ocupaciones: Ocupacion[] = semanasChoque.map((k) => {
    const fecha = sumarDiasLocal("2026-08-12", k * 7)!;
    const inicio = instanteDeHoraLocal(fecha, "10:00", AR)!;
    return { id: `choque-${k}`, salaId: "sa1", inquilinoId: "otro", tipo: "reserva", inicio, fin: new Date(inicio.getTime() + 60 * 60_000), bufferMin: 0 };
  });

  const plan = planificarSerie(serie({ semanas: 12, ocupaciones }));
  assert.equal(plan.ocurrencias.length, 12);
  assert.equal(plan.resumen.libres, 9);
  assert.equal(plan.resumen.conflictos, 3);
  for (const k of semanasChoque) assert.equal(plan.ocurrencias[k]!.estado, "choca_reserva");
  assert.ok(plan.ocurrencias[0]!.conflictoCon?.id === "choque-0");
});

test("una ocurrencia fuera del horario de apertura se marca fuera_de_horario", () => {
  // 03:00 AR está fuera de 06:00-23:00
  const plan = planificarSerie(serie({ hora: "03:00", semanas: 1 }));
  assert.equal(plan.ocurrencias[0]!.estado, "fuera_de_horario");
});
