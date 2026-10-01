// src/servicios/config/tarifas.ts — precios por hora. Permiso: tarifa.administrar (solo owner).
//
// Regla dura (§8.8): un precio NO SE EDITA. Poner un precio nuevo = CERRAR el vigente
// (vigenteHasta = ahora) y CREAR otro (vigenteDesde = ahora), en la misma transacción. Si se
// editara la fila, cambiar el precio hoy reescribiría lo que se reservó y se facturó ayer, y no
// habría forma de explicarle a un profesional por qué su resumen del mes pasado cambió solo.
//
// Además, cada ocupación ESTAMPA el precio con el que nació (crear.ts). O sea: hay dos redes.
// Esta tabla dice cuánto sale de acá en adelante; la ocupación dice cuánto salió aquel día.

import { z } from "zod";
import { type PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { definirAccion } from "../../lib/accion.ts";
import { aplicarPrecioVigente } from "../plata/reajustar.ts";
import { rangoDiaEnZona } from "../../dominio/motor/zona.ts";
import { aPesos } from "../../dominio/tarifa.ts";
import { resolverTarifa, type TarifaVigente } from "../../dominio/tarifa.ts";
import type { Actor } from "../../lib/actor.ts";

/** El alcance de una tarifa. Vacío = general (todas las salas, todos los profesionales). */
const Alcance = z.object({
  // Los select mandan "" cuando el usuario elige "todas"/"todos": eso es null, no un id vacío.
  salaId: z.string().trim().transform((s) => s || null).nullable().default(null),
  inquilinoId: z.string().trim().transform((s) => s || null).nullable().default(null),
});

/**
 * Un importe en pesos tal como lo escribe el operador, incluido el punto de miles.
 *
 * `z.coerce.number()` leía "4.500" como 4.5 —mil veces menos, sin error— porque el campo es de
 * texto y el valor llega tal cual se tecleó. `aPesos` usa la misma convención con la que la app
 * MUESTRA plata, así que lo que uno ve y lo que uno escribe significan lo mismo.
 */
export const PlataEnPesos = z
  .preprocess((v) => aPesos(v) ?? v, z.number().finite().min(0).max(100_000_000));

export const TarifaInput = Alcance.extend({
  // Se escribe en PESOS (lo que el owner tiene en la cabeza) y se guarda en CENTAVOS.
  // Se lee con el punto de miles de este lado del mundo: "9.100" son nueve mil cien, no 9,1.
  precioHora: PlataEnPesos,
  /**
   * Desde cuándo rige, como 'YYYY-MM-DD'. Si no viene, desde este instante.
   *
   * Existe porque un aumento casi nunca empieza "ahora": se carga el 30 de septiembre y rige desde
   * el 1 de octubre, que es la unidad con la que este centro factura. Sin esta fecha, el precio
   * nuevo arrancaba en el minuto del guardado y las horas usadas ESE MISMO DÍA más temprano
   * quedaban al valor anterior — una profesional con nueve turnos de cuatro horas facturaba
   * 251.200 en vez de 255.600, y la diferencia se repetía en cada profesional que tuviera turno el
   * día del cambio.
   *
   * Se toma a las 00:00 de la zona del centro: "a partir del 1 de octubre" quiere decir el día
   * entero, no desde la hora en que uno se sentó a cargarlo.
   */
  vigenteDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha inválida").optional(),
});

export type TarifaInputT = z.infer<typeof TarifaInput>;

export type ResultadoTarifa =
  /**
   * `aplicadas` = cuántas reservas YA CARGADAS quedaron con el precio nuevo.
   *
   * Guardar un precio tiene que cambiar el precio, y no lo hacía: la tarifa quedaba guardada pero
   * las reservas ya agendadas conservaban el importe estampado al nacer (§8.8). El operador
   * cambiaba el valor de la hora, miraba la liquidación y seguía viendo el número anterior; para
   * que entrara en vigencia había que ir a buscar otro botón, en otra parte de la pantalla, que
   * nadie sabía que había que apretar.
   *
   * Se toca solo lo que todavía no salió del centro —futuro y sin liquidar—; esos frenos viven
   * adentro del reajuste y no se relajan acá.
   */
  | { ok: true; id: string; aplicadas: number; /** Tarifas viejas POR CONSULTORIO que este precio dejó sin efecto. */ porSala: number }
  | { ok: false; error: "SALA_INEXISTENTE" | "PROFESIONAL_INEXISTENTE" | "NO_ENCONTRADA" };

/**
 * "Todos menos…": el precio general MÁS el precio propio de los que quedan afuera de ese general.
 *
 * Existe porque las dos mitades son una sola decisión. Guardarlas por separado —primero el general,
 * después cada excepción— deja una ventana en la que el nuevo general ya rige para gente a la que
 * el operador acaba de decidir cobrarle otra cosa; si en esa ventana alguien reserva, se factura a
 * un precio que nadie quiso. Van juntas o no va ninguna.
 *
 * El precio de cada excepción se pide explícito y no se hereda: dejar a alguien "afuera del
 * general" sin decir cuánto paga lo deja SIN TARIFA, y sin tarifa una reserva no genera deuda. El
 * agujero sería silencioso — se descubre a fin de mes, cuando el resumen viene en cero.
 */
export const TarifasLoteInput = z.object({
  precioHora: PlataEnPesos,
  /** Igual que en `TarifaInput`: desde cuándo rige. Vale para el general y para las excepciones. */
  vigenteDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha inválida").optional(),
  excepciones: z
    .array(
      z.object({
        inquilinoId: z.string().min(1),
        precioHora: PlataEnPesos,
      }),
    )
    .max(500)
    .default([]),
});

export type TarifasLoteInputT = z.infer<typeof TarifasLoteInput>;

export type ResultadoLote =
  /** `aplicadas`: mismo criterio que en `ResultadoTarifa`. Guardar un precio lo pone en vigencia. */
  | { ok: true; general: string; excepciones: number; aplicadas: number }
  | { ok: false; error: "PROFESIONAL_INEXISTENTE" | "PROFESIONAL_REPETIDO" };

/** Pesos → centavos, sin float en el resultado. Math.round acá es sobre 2 decimales, no sobre plata acumulada. */
export function aCentavos(pesos: number): bigint {
  return BigInt(Math.round(pesos * 100));
}

/** Nombre legible del alcance, para la lista y la auditoría. */
function nombreDeAlcance(sala: string | null, prof: string | null): string {
  if (prof && sala) return `${prof} en ${sala}`;
  if (prof) return prof;
  if (sala) return sala;
  return "General";
}

async function poner(actor: Actor, input: TarifaInputT, db: PrismaClient): Promise<ResultadoTarifa> {
  // Pertenencia: los ids vienen del cliente. findFirst({id, operadorId}), nunca findUnique({id}).
  const [sala, inq] = await Promise.all([
    input.salaId ? db.sala.findFirst({ where: { id: input.salaId, operadorId: actor.operadorId }, select: { nombre: true } }) : null,
    input.inquilinoId ? db.inquilino.findFirst({ where: { id: input.inquilinoId, operadorId: actor.operadorId }, select: { nombre: true } }) : null,
  ]);
  if (input.salaId && !sala) return { ok: false, error: "SALA_INEXISTENTE" };
  if (input.inquilinoId && !inq) return { ok: false, error: "PROFESIONAL_INEXISTENTE" };

  const ahora = await instanteDeVigencia(db, actor.operadorId, input.vigenteDesde);
  const precioHoraCent = aCentavos(input.precioHora);

  const creada = await db.$transaction(async (tx) => {
    // 1. Cerrar lo que este precio viene a reemplazar. Se cierra en `ahora`, así una reserva
    //    creada un milisegundo antes sigue habiendo usado el precio viejo (vigenteHasta es
    //    exclusivo).
    //
    //    No alcanza con cerrar el MISMO alcance, y esa era la falla: el precio de este centro es
    //    del profesional o general, nunca por consultorio, pero quedaron tarifas viejas POR SALA
    //    de cuando sí se podía. Una tarifa (sala + profesional) es MÁS específica que una de
    //    profesional, así que le ganaba — y como el formulario ya no puede crear ni editar una
    //    tarifa por sala, no había forma de sacarla: se guardaba el precio nuevo, la pantalla lo
    //    mostraba, y las reservas seguían cotizando al viejo para siempre.
    //
    //    Por eso el barrido es por ALCANCE EFECTIVO: el precio de una persona reemplaza todo lo
    //    suyo (tenga sala o no), y el general reemplaza también los precios que eran solo de una
    //    sala, que son los únicos que le ganaban sin pertenecer a nadie. Lo que NO toca el general
    //    son los precios propios de cada profesional: ahí la precedencia es la correcta y es la
    //    que el operador espera.
    const alcance = {
      operadorId: actor.operadorId,
      vigenteHasta: null,
      ...(input.inquilinoId ? { inquilinoId: input.inquilinoId } : { inquilinoId: null }),
    };
    // Cuántas de las que se cierran son por sala. Es el dato que la pantalla informa: reemplazar
    // el precio anterior es lo normal y no merece mención, pero haber sacado de encima una tarifa
    // por consultorio sí — explica por qué hoy sí cambió algo que ayer no cambiaba.
    const porSala = await tx.tarifa.count({ where: { ...alcance, salaId: { not: null } } });
    await tx.tarifa.updateMany({ where: alcance, data: { vigenteHasta: ahora } });

    // 2. Crear la nueva. Fila nueva, no UPDATE: el historial queda entero.
    const t = await tx.tarifa.create({
      data: {
        operadorId: actor.operadorId,
        salaId: input.salaId,
        inquilinoId: input.inquilinoId,
        nombre: nombreDeAlcance(sala?.nombre ?? null, inq?.nombre ?? null),
        precioHoraCent,
        vigenteDesde: ahora,
      },
      select: { id: true },
    });
    return { ok: true as const, id: t.id, porSala };
  });

  // 3. Aplicarlo a lo que ya está agendado y todavía no salió del centro. Va FUERA de la
  //    transacción a propósito: el precio nuevo ya quedó guardado y esa parte no se discute; si
  //    el reajuste fallara, lo peor que pasa es que queden reservas al precio viejo —el estado de
  //    siempre— y el aviso de la pantalla de Precios las levanta. Meterlo adentro haría que un
  //    problema aplicando el cambio deshiciera también el cambio.
  const ap = await aplicarPrecioVigente(
    actor,
    // Un precio general puede tocar a cualquiera que no tenga uno propio, así que se barre todo.
    // Uno de una persona toca solo a esa: reajustar de más movería plata que nadie pidió mover.
    input.inquilinoId ? { inquilinoId: input.inquilinoId } : {},
    db,
  );
  return { ...creada, aplicadas: ap.reajustadas };
}

async function ponerLote(actor: Actor, input: TarifasLoteInputT, db: PrismaClient): Promise<ResultadoLote> {
  const ids = input.excepciones.map((e) => e.inquilinoId);
  // Dos precios para la misma persona en el mismo guardado: cuál gana dependería del orden del
  // array, que es una respuesta que no se le puede dar a nadie. Se rechaza y se pide corregir.
  if (new Set(ids).size !== ids.length) return { ok: false, error: "PROFESIONAL_REPETIDO" };

  // Pertenencia: los ids vienen del cliente. Se verifica que TODOS sean de este centro antes de
  // escribir nada — si uno solo es ajeno, no se guarda ni el general.
  if (ids.length > 0) {
    const propios = await db.inquilino.findMany({
      where: { id: { in: ids }, operadorId: actor.operadorId },
      select: { id: true, nombre: true },
    });
    if (propios.length !== ids.length) return { ok: false, error: "PROFESIONAL_INEXISTENTE" };

    const nombres = new Map(propios.map((p) => [p.id, p.nombre]));
    // Un solo instante para todo el lote: el general y las excepciones son UNA decisión, y dos
    // marcas de tiempo distintas dejarían una ventana en la que rige una mitad sola.
    const desde = await instanteDeVigencia(db, actor.operadorId, input.vigenteDesde);
    const general = await db.$transaction(async (tx) => {
      const g = await escribirTarifa(tx, actor.operadorId, null, "General", input.precioHora, desde);
      for (const e of input.excepciones) {
        await escribirTarifa(tx, actor.operadorId, e.inquilinoId, nombres.get(e.inquilinoId)!, e.precioHora, desde);
      }
      return g;
    });
    // Fuera de la transacción, por lo mismo que en `poner`: los precios ya quedaron guardados y un
    // problema aplicándolos no puede deshacerlos. Se barre todo el centro porque un general toca a
    // cualquiera que no tenga precio propio.
    const ap = await aplicarPrecioVigente(actor, {}, db);
    return { ok: true as const, general, excepciones: input.excepciones.length, aplicadas: ap.reajustadas };
  }

  const soloGeneral = await instanteDeVigencia(db, actor.operadorId, input.vigenteDesde);
  const general = await db.$transaction(async (tx) => escribirTarifa(tx, actor.operadorId, null, "General", input.precioHora, soloGeneral));
  const ap = await aplicarPrecioVigente(actor, {}, db);
  return { ok: true, general, excepciones: 0, aplicadas: ap.reajustadas };
}


/**
 * Desde qué instante rige un precio.
 *
 * Sin fecha, ahora mismo. Con fecha, las 00:00 de ESE día en la zona del centro: "a partir del 1
 * de octubre" tiene que querer decir el día entero, no desde la hora en que uno se sentó a
 * cargarlo — si no, las horas usadas esa misma mañana se facturan al precio anterior.
 *
 * La zona sale de la sede y no tiene default: adivinarla es el bug que el guardarraíl §14.4 evita.
 * Sin sede, se cae a "ahora", que es el comportamiento de siempre.
 */
async function instanteDeVigencia(
  db: Pick<PrismaClient, "sede">,
  operadorId: string,
  fecha: string | undefined,
): Promise<Date> {
  if (!fecha) return new Date();
  const sede = await db.sede.findFirst({ where: { operadorId, activa: true }, select: { zonaHoraria: true } });
  if (!sede) return new Date();
  const rango = rangoDiaEnZona(fecha, sede.zonaHoraria);
  return rango ? rango.inicio : new Date();
}

/**
 * Cerrar la vigente de ese alcance y crear la nueva. Es el gesto de §8.8 —un precio no se edita—
 * extraído para que el alta de a una y la de a lote no puedan divergir: si mañana cambia la regla
 * (por ejemplo, guardar quién lo cambió), cambia en un solo lugar.
 *
 * `tx` y no `db`: se llama N veces dentro de una transacción y las N tienen que ir juntas.
 */
async function escribirTarifa(
  tx: Pick<PrismaClient, "tarifa">,
  operadorId: string,
  inquilinoId: string | null,
  nombre: string,
  precioHora: number,
  ahora: Date,
): Promise<string> {
  // El precio NO depende del consultorio: es del profesional o general del centro. Por eso el
  // barrido ignora `salaId` y cierra todo lo del mismo alcance EFECTIVO — ver el comentario largo
  // en `poner`, que explica el bug: una tarifa vieja por sala le ganaba al precio nuevo y, como el
  // formulario ya no puede crear una, no había manera de sacarla.
  await tx.tarifa.updateMany({
    where: { operadorId, inquilinoId, vigenteHasta: null },
    data: { vigenteHasta: ahora },
  });
  const t = await tx.tarifa.create({
    data: { operadorId, salaId: null, inquilinoId, nombre, precioHoraCent: aCentavos(precioHora), vigenteDesde: ahora },
    select: { id: true },
  });
  return t.id;
}

/**
 * Da de baja un precio sin poner otro: el alcance vuelve a caer en el que le siga por
 * especificidad (la de sala, o la general). No borra: cierra.
 */
async function cerrar(actor: Actor, input: { tarifaId: string }, db: PrismaClient): Promise<ResultadoTarifa> {
  // A quién apuntaba, para poder reajustar solo a esa persona. Se lee ANTES de cerrarla.
  const previa = await db.tarifa.findFirst({
    where: { id: input.tarifaId, operadorId: actor.operadorId, vigenteHasta: null },
    select: { inquilinoId: true },
  });
  const r = await db.tarifa.updateMany({
    where: { id: input.tarifaId, operadorId: actor.operadorId, vigenteHasta: null },
    data: { vigenteHasta: new Date() },
  });
  if (r.count !== 1) return { ok: false, error: "NO_ENCONTRADA" };

  // Dar de baja un precio también CAMBIA el precio: el alcance cae en el que le siga. Si guardar
  // uno nuevo aplica a lo agendado, sacar uno tiene que hacer lo mismo, o la mitad de la pantalla
  // se comporta de una manera y la otra mitad de otra.
  const ap = await aplicarPrecioVigente(actor, previa?.inquilinoId ? { inquilinoId: previa.inquilinoId } : {}, db);
  return { ok: true, id: input.tarifaId, aplicadas: ap.reajustadas, porSala: 0 };
}

const CFG_TARIFA = {
  permiso: "tarifa.administrar",
  schema: TarifaInput,
  resumen: (i: z.infer<typeof TarifaInput>) => `precio ${i.precioHora} la hora para ${i.inquilinoId ?? "todos"}`,
} as const;

const CFG_TARIFA_LOTE = {
  permiso: "tarifa.administrar",
  schema: TarifasLoteInput,
  resumen: (i: z.infer<typeof TarifasLoteInput>) => `general ${i.precioHora} con ${i.excepciones.length} excepciones`,
} as const;

export const ponerTarifa = definirAccion(CFG_TARIFA, (a, i) => poner(a, i, prisma));
export const ponerTarifasEnLote = definirAccion(CFG_TARIFA_LOTE, (a, i) => ponerLote(a, i, prisma));
export const cerrarTarifa = definirAccion(
  { permiso: "tarifa.administrar", schema: z.object({ tarifaId: z.string().min(1) }) },
  (a, i) => cerrar(a, i, prisma),
);

/** Versiones inyectables, para los tests. */
export const tarifasCon = (db: PrismaClient) => ({
  poner: definirAccion({ ...CFG_TARIFA, db }, (a, i) => poner(a, i, db)),
  ponerLote: definirAccion({ ...CFG_TARIFA_LOTE, db }, (a, i) => ponerLote(a, i, db)),
  cerrar: definirAccion({ permiso: "tarifa.administrar", schema: z.object({ tarifaId: z.string().min(1) }), db }, (a, i) => cerrar(a, i, db)),
});

/** Las tarifas vigentes del operador, ordenadas de la más específica a la general. */
export async function tarifasVigentes(operadorId: string, db: PrismaClient = prisma) {
  const filas = await db.tarifa.findMany({
    where: { operadorId, vigenteHasta: null },
    select: { id: true, nombre: true, salaId: true, inquilinoId: true, precioHoraCent: true, vigenteDesde: true, vigenteHasta: true },
    orderBy: [{ inquilinoId: "asc" }, { salaId: "asc" }, { vigenteDesde: "desc" }],
  });
  return filas.sort((a, b) => {
    const esp = (t: { salaId: string | null; inquilinoId: string | null }) => (t.inquilinoId ? 2 : 0) + (t.salaId ? 1 : 0);
    return esp(b) - esp(a) || a.nombre.localeCompare(b.nombre, "es");
  });
}

/**
 * Qué precio le sale HOY a cada (profesional, sala). Misma función que usa el alta de reserva
 * (`resolverTarifa`), no una copia: si el cuadro dice $8.000 la reserva cobra $8.000 (§5.1).
 */
export function cuadroDePrecios(
  tarifas: TarifaVigente[],
  salas: { id: string; nombre: string }[],
  inquilinos: { id: string; nombre: string }[],
  ahora = new Date(),
) {
  return inquilinos.map((i) => ({
    inquilino: i,
    celdas: salas.map((s) => ({
      sala: s,
      tarifa: resolverTarifa(tarifas, { salaId: s.id, inquilinoId: i.id, ahora }),
    })),
  }));
}
