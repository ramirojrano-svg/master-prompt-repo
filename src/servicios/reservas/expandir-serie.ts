// src/servicios/reservas/expandir-serie.ts — materializa una serie recurrente (§4.9).
// Escribe las N filas en UNA transacción, tomando TODOS los locks de (sala, fecha) ordenados
// ascendentemente (sin el orden, dos series concurrentes se deadlockean). Re-chequea cada
// ocurrencia contra el `tx`. 'saltear_silencioso' no existe: una ocurrencia que desaparece sin
// decirlo es un inquilino que llega a la puerta cerrada.

import { randomUUID } from "node:crypto";
import { CuentaTipo, EstadoOcupacion, type PrismaClient, TipoOcupacion } from "@prisma/client";
import { prisma } from "../../db/prisma.ts";
import { clavesDeLock } from "../../dominio/locks.ts";
import { evaluarReserva, type CodigoReserva } from "../../dominio/motor/reserva.ts";
import { alcanzadasPor } from "../../dominio/motor/intervalos.ts";
import { LOOKBACK_MIN, DURACION_MAX_MIN, DURACION_MIN_MIN } from "../../dominio/motor/limites.ts";
import { instanteDeHoraLocal, periodoDeInstante } from "../../dominio/motor/zona.ts";
import { cotizar, resolverTarifa } from "../../dominio/tarifa.ts";
import { seLeFactura } from "../plata/facturable.ts";
import { fechasDeSerie, OCURRENCIAS_MAX, type Repeticion } from "../../dominio/repeticion.ts";
import type { CtxReserva } from "./crear.ts";
import { aMotor, OCUPAN } from "./comun.ts";

export type ModoSerie = "parcial" | "todo_o_nada";

export type ParamsSerie = {
  /** null = la serie no usa consultorio: factura pero no ocupa el espacio. */
  salaId: string | null;
  hora: string; // 'HH:MM'
  duracionMin: number;
  fechaInicio: string; // 'YYYY-MM-DD'
  /** Qué patrón repite: diaria, hábiles, semanal, mensual ("el segundo viernes") o anual. */
  repeticion: Repeticion;
  /** Cuántas ocurrencias. Los meses que no tienen la fecha se saltean SIN gastar cupo. */
  cantidad: number;
  modo: ModoSerie;
  motivo?: string;
};

export type Conflicto = { fecha: string; codigo: CodigoReserva };

export type ResultadoSerie =
  | { ok: true; serieId: string; creadas: string[]; conflictos: Conflicto[] }
  | { ok: false; error: "SALA_INEXISTENTE" | "DATOS_INVALIDOS" | "SERIE_ABORTADA"; conflictos?: Conflicto[] };

class AbortarSerie extends Error {
  conflictos: Conflicto[];
  constructor(conflictos: Conflicto[]) {
    super("serie abortada por conflicto (todo_o_nada)");
    this.conflictos = conflictos;
  }
}

export async function expandirSerie(p: ParamsSerie, ctx: CtxReserva, db: PrismaClient = prisma): Promise<ResultadoSerie> {
  const ahora = ctx.ahora ?? new Date();
  if (p.cantidad < 1 || p.cantidad > OCURRENCIAS_MAX) return { ok: false, error: "DATOS_INVALIDOS" };
  if (p.duracionMin < DURACION_MIN_MIN || p.duracionMin > DURACION_MAX_MIN) return { ok: false, error: "DATOS_INVALIDOS" };

  // Sin consultorio la zona sale de la SEDE: no hay sala de la que sacarla. Ver la nota de
  // crear.ts — son horas que se consumen y se facturan sin usar el espacio.
  const sala = p.salaId ? await db.sala.findFirst({ where: { id: p.salaId, operadorId: ctx.operadorId }, include: { sede: true } }) : null;
  if (p.salaId && (!sala || !sala.activa)) return { ok: false, error: "SALA_INEXISTENTE" };
  const sede = sala?.sede ?? (await db.sede.findFirst({ where: { operadorId: ctx.operadorId, activa: true } }));
  if (!sede) return { ok: false, error: "SALA_INEXISTENTE" };
  const tz = sede.zonaHoraria;

  // Las FECHAS las decide el módulo puro de repetición (calendario, sin horas ni zonas). Acá
  // solo se les pone la hora, cada una en la zona de SU sede: nunca +7*24h sobre un instante.
  const ocurrencias: { fecha: string; inicio: Date; fin: Date }[] = [];
  for (const fecha of fechasDeSerie(p.fechaInicio, p.repeticion, p.cantidad)) {
    const inicio = instanteDeHoraLocal(fecha, p.hora, tz);
    if (!inicio) continue;
    ocurrencias.push({ fecha, inicio, fin: new Date(inicio.getTime() + p.duracionMin * 60_000) });
  }
  if (ocurrencias.length === 0) return { ok: false, error: "DATOS_INVALIDOS" };

  // Todos los locks, ordenados ascendentemente y deduplicados.
  const claves = [
    ...new Set(ocurrencias.flatMap((o) => clavesDeLock({ salaId: sala?.id ?? null, inquilinoId: ctx.inquilinoId, inicio: o.inicio, fin: o.fin, tz }))),
  ].sort();

  const serieId = randomUUID();

  try {
    return await db.$transaction(async (tx) => {
      // TODOS los locks en UNA consulta. Antes era un `await` por clave, y con una serie semanal de
      // un año son más de cien idas y vueltas — ver la nota de arriba sobre por qué eso mata la
      // transacción contra una base remota.
      //
      // `WITH ORDINALITY` + `ORDER BY` NO es decorativo: el orden de toma es lo único que evita
      // que dos series concurrentes se deadlockeen, y sin el ORDER BY el motor puede evaluar el
      // unnest en cualquier orden.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(k))
        FROM unnest(${claves}::text[]) WITH ORDINALITY AS t(k, n)
        ORDER BY t.n`;

      // La tarifa vigente se resuelve UNA vez para toda la serie: no cambia entre ocurrencias
      // dentro de la misma transacción, y consultarla N veces sería N consultas para el mismo dato.
      const tarifas = await tx.tarifa.findMany({
        where: { operadorId: ctx.operadorId, vigenteDesde: { lte: ahora }, OR: [{ vigenteHasta: null }, { vigenteHasta: { gt: ahora } }] },
        select: { id: true, salaId: true, inquilinoId: true, precioHoraCent: true, vigenteDesde: true, vigenteHasta: true },
      });
      // A quien no se le factura no se le resuelve tarifa: ni precio estampado ni cargo. Una
      // serie son decenas de ocurrencias, así que acá el error se multiplica por cincuenta.
      const factura = await seLeFactura(tx, ctx.operadorId, ctx.inquilinoId);
      const tarifa = factura ? resolverTarifa(tarifas, { salaId: sala?.id ?? "", inquilinoId: ctx.inquilinoId, ahora }) : null;
      const cot = tarifa ? cotizar(tarifa, p.duracionMin) : null;

      const creadas: string[] = [];
      const conflictos: Conflicto[] = [];

      // La foto de lo que ya está ocupado se trae UNA vez para todo el rango de la serie, y
      // después se filtra en memoria ocurrencia por ocurrencia. Antes eran DOS consultas por
      // fecha: con 57 miércoles, 114 idas y vueltas que no aportaban nada que no estuviera en
      // estas dos.
      //
      // El rango va desde el lookback de la PRIMERA hasta el fin de la ÚLTIMA, así que contiene
      // todo lo que cualquier ocurrencia podría llegar a mirar.
      const primera = ocurrencias[0]!;
      const ultima = ocurrencias[ocurrencias.length - 1]!;
      const desdeTodo = new Date(primera.inicio.getTime() - LOOKBACK_MIN * 60_000);
      const hastaTodo = ultima.fin;

      const [ocupSalaTodas, ocupInqTodas] = await Promise.all([
        // Sin sala no hay eje de sala que chocar; el del profesional sigue valiendo.
        sala
          ? tx.ocupacion.findMany({
              where: { operadorId: ctx.operadorId, salaId: sala.id, estado: { in: OCUPAN }, inicio: { gte: desdeTodo, lt: hastaTodo }, fin: { gt: primera.inicio } },
            })
          : Promise.resolve([]),
        tx.ocupacion.findMany({
          where: { operadorId: ctx.operadorId, inquilinoId: ctx.inquilinoId, tipo: TipoOcupacion.reserva, estado: { in: OCUPAN }, inicio: { gte: desdeTodo, lt: hastaTodo }, fin: { gt: primera.inicio } },
        }),
      ]);

      /** El mismo recorte que hacía la consulta por ocurrencia, ahora en memoria. La comparación
       *  vive en intervalos.ts, que es donde §4.2 manda que viva. */
      const solapanCon = <T extends { inicio: Date; fin: Date }>(filas: T[], o: { inicio: Date; fin: Date }): T[] =>
        alcanzadasPor(filas, o, LOOKBACK_MIN);

      /** Lo que la propia serie va creando. Una ocurrencia tiene que ver a las anteriores: antes lo
       *  lograba porque cada consulta corría después del create previo, y ahora la foto es una
       *  sola. Con series de una hora en días distintos nunca se tocan, pero la regla no puede
       *  depender de eso — el día que alguien cargue una diaria de doce horas, se tocan. */
      const propias: { salaId: string | null; inquilinoId: string; inicio: Date; fin: Date; tipo: TipoOcupacion; bufferMin: number; id: string }[] = [];

      // Las filas a escribir se juntan y se insertan de una sola vez al final.
      const aCrear: { id: string; o: (typeof ocurrencias)[number] }[] = [];

      for (const o of ocurrencias) {
        const ocupSala = [...solapanCon(ocupSalaTodas, o), ...(sala ? solapanCon(propias.filter((x) => x.salaId === sala.id), o) : [])];
        const ocupInq = [...solapanCon(ocupInqTodas, o), ...solapanCon(propias, o)];

        const veredicto = evaluarReserva({
          fecha: o.fecha,
          tz,
          horario: ctx.horario,
          politica: ctx.politica,
          intervalo: { inicio: o.inicio, fin: o.fin },
          inquilinoId: ctx.inquilinoId,
          bloqueaProfesional: ctx.bloqueaProfesional,
          ocupacionesSala: ocupSala.map(aMotor),
          ocupacionesInquilino: ocupInq.map(aMotor),
        });

        if (!veredicto.ok) {
          conflictos.push({ fecha: o.fecha, codigo: veredicto.codigo });
          continue;
        }

        // El id se genera ACÁ y no lo pone la base: hace falta para armar la clave del asiento
        // (`cargo_uso:<id>`) sin tener que preguntarle a Postgres qué id le tocó a cada fila.
        const id = randomUUID();
        aCrear.push({ id, o });
        propias.push({
          id,
          salaId: sala?.id ?? null,
          inquilinoId: ctx.inquilinoId,
          inicio: o.inicio,
          fin: o.fin,
          tipo: TipoOcupacion.reserva,
          bufferMin: ctx.politica.bufferMin,
        });
        creadas.push(id);
      }

      // ── Las escrituras, en dos consultas ────────────────────────────────
      // Antes era un INSERT por ocurrencia más otro por cargo: con 57 miércoles, 114 escrituras
      // de a una. Ahora son dos, y el tiempo deja de crecer con el largo de la serie.
      if (aCrear.length > 0) {
        await tx.ocupacion.createMany({
          data: aCrear.map(({ id, o }) => ({
            id,
            operadorId: ctx.operadorId,
            sedeId: sede.id,
            salaId: sala?.id ?? null,
            inquilinoId: ctx.inquilinoId,
            tipo: TipoOcupacion.reserva,
            estado: EstadoOcupacion.confirmada,
            inicio: o.inicio,
            fin: o.fin,
            bufferMin: ctx.politica.bufferMin,
            tzSede: tz,
            bloqueaProfesional: ctx.bloqueaProfesional,
            serieId,
            motivo: p.motivo ?? null,
            // El precio se ESTAMPA igual que en un alta suelta. Sin esto una serie nacía sin
            // precio y sin cargo: cincuenta turnos que ocupaban la sala y no le facturaban un
            // peso a nadie, y el resumen del mes los mostraba como horas regaladas.
            tarifaId: cot?.tarifaId ?? null,
            precioHoraCent: cot?.precioHoraCent ?? null,
            importeCent: cot?.importeCent ?? null,
          })),
        });

        // Los cargos van en la MISMA transacción que las filas, cada uno con el período de SU
        // ocurrencia: una serie cruza meses, y todas las cuotas no pueden caer en el mes de la
        // primera.
        //
        // `skipDuplicates` hace el mismo trabajo que hacía `asentarIdempotente` fila por fila: la
        // clave es única, así que si un cargo ya existiera no se duplica. Nadie se cobra dos veces.
        if (cot && cot.importeCent > 0n) {
          await tx.asiento.createMany({
            data: aCrear.map(({ id, o }) => ({
              operadorId: ctx.operadorId,
              inquilinoId: ctx.inquilinoId,
              cuenta: CuentaTipo.corriente,
              concepto: "cargo_uso" as const,
              montoCent: cot.importeCent,
              moneda: ctx.moneda ?? "ARS",
              periodo: periodoDeInstante(o.inicio, tz),
              fechaHecho: o.inicio,
              clave: `cargo_uso:${id}`,
              reservaId: id,
            })),
            skipDuplicates: true,
          });
        }
      }

      // todo_o_nada: una sola ocurrencia que choque aborta la serie entera (rollback => 0 filas).
      if (p.modo === "todo_o_nada" && conflictos.length > 0) throw new AbortarSerie(conflictos);

      return { ok: true as const, serieId, creadas, conflictos };
    });
  } catch (e) {
    if (e instanceof AbortarSerie) return { ok: false, error: "SERIE_ABORTADA", conflictos: e.conflictos };
    throw e;
  }
}
