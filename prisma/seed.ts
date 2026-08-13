// prisma/seed.ts — datos del piloto real: Espacio Montes de Oca (EMOAPP).
//
// Incluye a propósito los CASOS FEOS (§11.8): el dataset lindo no encuentra nada.
//   · una sala ARCHIVADA con reservas históricas (tiene que seguir apareciendo en reportes)
//   · un inquilino DE BAJA con horas facturadas del mes pasado
//   · una reserva de 15' (altura mínima del bloque) y una que arranca antes de la apertura
//   · dos reservas pegadas 09-10 / 10-11 (bordes exactos: NO chocan)
//
// Correr:  DATABASE_URL=... npm run seed

import { randomUUID } from "node:crypto";
import { EstadoInquilino, EstadoOcupacion, PrismaClient, Rol, TipoOcupacion } from "@prisma/client";
import { hashPassword } from "../src/lib/password.ts";
import { diaSemanaDeFecha, instanteDeHoraLocal, sumarDiasLocal, fechaEnZona, periodoDeInstante } from "../src/dominio/motor/zona.ts";
import { zonaDePais } from "../src/dominio/paises.ts";
import { cotizar, resolverTarifa } from "../src/dominio/tarifa.ts";

const prisma = new PrismaClient();

const SLUG = "espacio-moca";
const PAIS = "AR";
const TZ = zonaDePais(PAIS)!;
const PASSWORD_DEMO = "emoapp-2026";
const TARIFA_HORA_CENT = 800_000n; // $8.000 ARS

// L-V 08:00–22:00, sábado y domingo cerrado (horario real del centro).
const HORARIO = {
  0: [],
  1: [{ desde: "08:00", hasta: "22:00" }],
  2: [{ desde: "08:00", hasta: "22:00" }],
  3: [{ desde: "08:00", hasta: "22:00" }],
  4: [{ desde: "08:00", hasta: "22:00" }],
  5: [{ desde: "08:00", hasta: "22:00" }],
  6: [],
};

const ESPECIALIDADES = [
  "Odontología general", "Psicología", "Kinesiología", "Médico PAMI", "Pediatría",
  "Cosmiatría", "Estética", "Urología", "Dermatología", "Psiquiatría", "Neumonología",
  "Alergia", "Perito",
];

const APELLIDOS = [
  "Gómez", "Fernández", "Rodríguez", "López", "Martínez", "Pérez", "García", "Sánchez",
  "Romero", "Sosa", "Torres", "Álvarez", "Ruiz", "Benítez", "Acosta", "Medina", "Herrera",
  "Aguirre", "Pereyra", "Gutiérrez", "Molina", "Silva", "Castro", "Ortiz", "Núñez",
];
const NOMBRES = ["María", "Juan", "Ana", "Carlos", "Laura", "Diego", "Sofía", "Martín", "Lucía", "Pablo"];

function nombreProfesional(i: number): string {
  const n = NOMBRES[i % NOMBRES.length]!;
  const a = APELLIDOS[i % APELLIDOS.length]!;
  const esp = ESPECIALIDADES[i % ESPECIALIDADES.length]!;
  return `${n} ${a} (${esp})`;
}

/** Instante UTC de una hora de pared en la zona del centro. */
function T(fecha: string, hm: string): Date {
  return instanteDeHoraLocal(fecha, hm, TZ)!;
}

async function main() {
  console.log(`Seed EMOAPP — ${SLUG} · zona ${TZ}`);

  // Limpieza (idempotente): borra el operador y todo lo suyo en cascada.
  await prisma.operador.deleteMany({ where: { slug: SLUG } });
  await prisma.usuario.deleteMany({ where: { email: { in: ["ramirojrano@gmail.com", "maria@email.com", "ana@email.com"] } } });

  const operador = await prisma.operador.create({
    data: { nombre: "Espacio Montes de Oca", slug: SLUG, pais: PAIS, moneda: "ARS" },
  });

  const sede = await prisma.sede.create({
    data: {
      operadorId: operador.id,
      nombre: "Sede Montes de Oca",
      direccion: "Av. Montes de Oca 1234, CABA",
      zonaHoraria: TZ, // ESTAMPADA del país, nunca default de esquema (§14.4)
    },
  });

  // 3 salas activas (las reales) + 1 archivada CON historia (caso feo §11.8).
  const salas = await Promise.all(
    [
      { nombre: "Consultorio 1", color: "#1a8fc1", orden: 1, equipamiento: ["camilla", "wifi"] },
      { nombre: "Consultorio 2", color: "#17b6c4", orden: 2, equipamiento: ["sillón odontológico", "wifi"] },
      { nombre: "Consultorio 3", color: "#149e8a", orden: 3, equipamiento: ["camilla", "espejo", "wifi"] },
    ].map((s) =>
      prisma.sala.create({
        data: { ...s, operadorId: operador.id, sedeId: sede.id, horarioJson: HORARIO, bufferMin: 0 },
      }),
    ),
  );

  const salaArchivada = await prisma.sala.create({
    data: {
      operadorId: operador.id, sedeId: sede.id, nombre: "Consultorio 4 (cerrado)", color: "#63788a",
      orden: 4, horarioJson: HORARIO, activa: false, archivadaEl: new Date("2026-06-30T00:00:00Z"),
    },
  });

  // 50 inquilinos (el número real del piloto). El #7 va DE BAJA con historia (caso feo).
  const inquilinos = [];
  for (let i = 0; i < 50; i++) {
    inquilinos.push(
      await prisma.inquilino.create({
        data: {
          operadorId: operador.id,
          nombre: nombreProfesional(i),
          estado: i === 7 ? EstadoInquilino.baja : EstadoInquilino.activo,
        },
      }),
    );
  }
  // La Dra. María Gómez es el inquilino 0 (tiene usuario propio).
  const maria = inquilinos[0]!;
  await prisma.inquilino.update({ where: { id: maria.id }, data: { nombre: "María Gómez (Psicología)" } });

  // Usuarios del centro: los tres roles reales.
  const hash = await hashPassword(PASSWORD_DEMO);
  const ramiro = await prisma.usuario.create({ data: { email: "ramirojrano@gmail.com", nombre: "Ramiro Raño", passwordHash: hash } });
  const gomez = await prisma.usuario.create({ data: { email: "maria@email.com", nombre: "María Gómez", passwordHash: hash } });
  const ana = await prisma.usuario.create({ data: { email: "ana@email.com", nombre: "Ana Torres", passwordHash: hash } });

  await prisma.usuarioOperador.createMany({
    data: [
      { usuarioId: ramiro.id, operadorId: operador.id, rol: Rol.owner },
      { usuarioId: gomez.id, operadorId: operador.id, rol: Rol.inquilino_titular, inquilinoId: maria.id },
      { usuarioId: ana.id, operadorId: operador.id, rol: Rol.recepcion },
    ],
  });

  // ── Precios (§8.8) ────────────────────────────────────────────────────────
  // La general del centro y dos excepciones, que es como funciona de verdad: un profesional con
  // precio acordado y una sala más cara. Todas empiezan hace un año: las reservas históricas del
  // seed también tienen que caer adentro de una tarifa vigente.
  const desdeTarifas = new Date(Date.now() - 365 * 86_400_000);
  const tarifas = await Promise.all(
    [
      { nombre: "General", salaId: null, inquilinoId: null, precioHoraCent: TARIFA_HORA_CENT },
      { nombre: salas[2]!.nombre, salaId: salas[2]!.id, inquilinoId: null, precioHoraCent: 950_000n },
      { nombre: "María Gómez", salaId: null, inquilinoId: maria.id, precioHoraCent: 700_000n },
    ].map((t) =>
      prisma.tarifa.create({
        data: { operadorId: operador.id, vigenteDesde: desdeTarifas, ...t },
        select: { id: true, salaId: true, inquilinoId: true, precioHoraCent: true, vigenteDesde: true, vigenteHasta: true },
      }),
    ),
  );

  // ── Reservas de HOY y de la semana ────────────────────────────────────────
  const hoy = fechaEnZona(new Date(), TZ);
  const filas: Parameters<typeof prisma.ocupacion.createMany>[0]["data"] = [];

  const reserva = (salaId: string, inquilinoId: string | null, fecha: string, desde: string, hasta: string, estado = EstadoOcupacion.confirmada, tipo = TipoOcupacion.reserva) => {
    const inicio = T(fecha, desde);
    const fin = T(fecha, hasta);
    // El precio se ESTAMPA acá, igual que en el alta real: la misma resolverTarifa/cotizar, no
    // una cuenta aparte del seed (§5.1).
    const cot =
      tipo === TipoOcupacion.reserva && inquilinoId
        ? cotizar(resolverTarifa(tarifas, { salaId, inquilinoId, ahora: inicio }), Math.round((fin.getTime() - inicio.getTime()) / 60_000))
        : null;
    return {
      id: randomUUID(),
      operadorId: operador.id, sedeId: sede.id, salaId, inquilinoId, tipo, estado,
      inicio, fin, bufferMin: 0, tzSede: TZ,
      bloqueaProfesional: tipo === TipoOcupacion.reserva,
      tarifaId: cot?.tarifaId ?? null,
      precioHoraCent: cot?.tarifaId ? cot.precioHoraCent : null,
      importeCent: cot?.tarifaId ? cot.importeCent : null,
    };
  };

  // HOY: día realista en las 3 salas, incluidos los casos de borde.
  const s1 = salas[0]!.id, s2 = salas[1]!.id, s3 = salas[2]!.id;
  filas.push(
    // bordes exactos: 09-10 y 10-11 conviven (NO chocan)
    reserva(s1, inquilinos[1]!.id, hoy, "09:00", "10:00"),
    reserva(s1, inquilinos[2]!.id, hoy, "10:00", "11:00"),
    reserva(s1, inquilinos[3]!.id, hoy, "14:00", "16:00"),
    reserva(s1, maria.id, hoy, "18:00", "19:00"),
    // bloque de 15' (altura mínima del bloque en la grilla)
    reserva(s2, inquilinos[4]!.id, hoy, "08:30", "08:45"),
    reserva(s2, inquilinos[5]!.id, hoy, "11:00", "12:30"),
    reserva(s2, inquilinos[6]!.id, hoy, "16:00", "17:00", EstadoOcupacion.usada),
    reserva(s3, inquilinos[8]!.id, hoy, "09:30", "11:00"),
    reserva(s3, inquilinos[9]!.id, hoy, "13:00", "14:00", EstadoOcupacion.no_show),
    reserva(s3, inquilinos[10]!.id, hoy, "19:00", "21:00"),
    // mantenimiento (se pinta distinto y bloquea la sala)
    { ...reserva(s3, null, hoy, "12:00", "13:00", EstadoOcupacion.confirmada, TipoOcupacion.mantenimiento), motivo: "Mantenimiento técnico" },
  );

  // Resto de la semana (que la agenda no se vea vacía al navegar). Se saltean sábado y domingo:
  // el centro abre L-V, y un turno cargado con el centro cerrado es un dato que la app jamás
  // habría aceptado por el camino real — un seed que miente confunde más que un seed vacío.
  for (let d = 1; d <= 9; d++) {
    const f = sumarDiasLocal(hoy, d)!;
    const dow = diaSemanaDeFecha(f);
    if (dow === 0 || dow === 6) continue;
    filas.push(
      reserva(s1, inquilinos[(d * 3) % 50]!.id, f, "09:00", "10:00"),
      reserva(s2, inquilinos[(d * 5) % 50]!.id, f, "15:00", "16:30"),
      reserva(s3, maria.id, f, "17:00", "18:00"),
    );
  }

  // Historia del mes pasado, incluida la SALA ARCHIVADA y el INQUILINO DE BAJA.
  const mesPasado = sumarDiasLocal(hoy, -35)!;
  filas.push(
    reserva(salaArchivada.id, inquilinos[11]!.id, mesPasado, "10:00", "11:00", EstadoOcupacion.usada),
    reserva(s1, inquilinos[7]!.id, mesPasado, "16:00", "17:00", EstadoOcupacion.usada), // el de baja
  );

  await prisma.ocupacion.createMany({ data: filas });

  // Plata: cada reserva con precio deja su cargo en la cuenta corriente, con la MISMA clave
  // idempotente que usa el alta real (`cargo_uso:<ocupacionId>`). El de baja conserva los suyos:
  // la historia no desaparece porque el profesional se haya ido (§3.6).
  await prisma.asiento.createMany({
    data: filas
      .filter((f) => f.inquilinoId && f.importeCent && f.importeCent > 0n)
      .map((f) => ({
        operadorId: operador.id,
        inquilinoId: f.inquilinoId!,
        concepto: "cargo_uso" as const,
        montoCent: f.importeCent!,
        moneda: operador.moneda,
        periodo: periodoDeInstante(f.inicio as Date, TZ),
        fechaHecho: f.inicio as Date,
        clave: `cargo_uso:${f.id}`,
        reservaId: f.id,
      })),
  });

  // Y algunos pagos, para que los saldos no sean todos deuda: quien pagó, pagó.
  await prisma.asiento.createMany({
    data: [
      { operadorId: operador.id, inquilinoId: maria.id, concepto: "pago" as const, montoCent: -1_400_000n, moneda: operador.moneda, periodo: periodoDeInstante(T(hoy, "10:00"), TZ), fechaHecho: T(hoy, "10:00"), clave: "pago:seed-maria" },
      { operadorId: operador.id, inquilinoId: inquilinos[7]!.id, concepto: "pago" as const, montoCent: -800_000n, moneda: operador.moneda, periodo: periodoDeInstante(T(mesPasado, "18:00"), TZ), fechaHecho: T(mesPasado, "18:00"), clave: "pago:seed-baja" },
    ],
  });

  console.log(`  operador  : ${operador.nombre} (${SLUG})`);
  console.log(`  salas     : 3 activas + 1 archivada con historia`);
  console.log(`  inquilinos: 50 (uno de baja, con historia)`);
  console.log(`  ocupaciones: ${filas.length}`);
  console.log("");
  console.log(`  Entrá en /panel/${SLUG} con:`);
  console.log(`    owner      ramirojrano@gmail.com / ${PASSWORD_DEMO}`);
  console.log(`    inquilino  maria@email.com       / ${PASSWORD_DEMO}`);
  console.log(`    recepción  ana@email.com         / ${PASSWORD_DEMO}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
