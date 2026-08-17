// prisma/seed.ts — datos del piloto real: Espacio Montes de Oca (EMOAPP).
//
// Incluye a propósito los CASOS FEOS (§11.8): el dataset lindo no encuentra nada.
//   · una sala ARCHIVADA con reservas históricas (tiene que seguir apareciendo en reportes)
//   · una reserva de 15' (altura mínima del bloque) y una que arranca antes de la apertura
//   · dos reservas pegadas 09-10 / 10-11 (bordes exactos: NO chocan)
//
// Correr:  npm run seed          (toma la conexión de .env.local)
//          DATABASE_URL=... npm run seed   (para apuntar a otra base; lo explícito manda)

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { EstadoInquilino, EstadoOcupacion, PrismaClient, Rol, TipoOcupacion } from "@prisma/client";
import { cargarEnv } from "../src/lib/entorno.ts";
import { diagnosticar, explicar } from "../src/lib/db-salud.ts";
import { hashPassword } from "../src/lib/password.ts";
import { diaSemanaDeFecha, instanteDeHoraLocal, sumarDiasLocal, fechaEnZona, periodoDeInstante } from "../src/dominio/motor/zona.ts";
import { zonaDePais } from "../src/dominio/paises.ts";
import { cotizar, resolverTarifa } from "../src/dominio/tarifa.ts";

// ANTES de instanciar el cliente: Prisma lee DATABASE_URL en el constructor, y .env.local lo
// levanta Next, no un `node` suelto. Sin esta línea `npm run seed` —el comando del README—
// muere con "Environment variable not found: DATABASE_URL" con el archivo ahí al lado.
// fileURLToPath y no .pathname: en Windows .pathname devuelve "/C:/Users/..." y no existe.
cargarEnv(fileURLToPath(new URL("..", import.meta.url)));

const prisma = new PrismaClient();

const SLUG = "espacio-moca";
const PAIS = "AR";
const TZ = zonaDePais(PAIS)!;
const PASSWORD_DEMO = "emoapp-2026";
const TARIFA_HORA_CENT = 800_000n; // $8.000 ARS

// Lunes a domingo, 08:00–22:00: los consultorios abren todos los días.
const FRANJA = [{ desde: "08:00", hasta: "22:00" }];
const HORARIO = { 0: FRANJA, 1: FRANJA, 2: FRANJA, 3: FRANJA, 4: FRANJA, 5: FRANJA, 6: FRANJA };

// Los profesionales REALES del centro. `pagador` es quién abona cuando no es el mismo
// profesional; `abonoMensualCent` marca a los que NO alquilan por hora sino que pagan un fijo.
type Profesional = { nombre: string; pagador?: string; abonoMensualCent?: bigint };

const ABONO_FIJO = 25_000_000n; // $250.000 por mes

const PROFESIONALES: Profesional[] = [
  { nombre: "Laila (PAMI)" },
  { nombre: "Irene Troilo (PAMI)" },
  { nombre: "Mariano Farías (PAMI)" },
  { nombre: "Eliana Cella (Pediatra)" },
  { nombre: "Natalia Huamani (Pediatra)" },
  { nombre: "Patricia Guerrero (PAMI)" },
  { nombre: "Verónica Sorasio - Guillermina Inés Ortega (Dermatología)" },
  { nombre: "Melina Caccia Leotta (Dermatología)" },
  { nombre: "Federico Terrón (Neumonología)" },
  // Marta no abona lo suyo: lo paga Federico Terrón. La deuda sigue siendo de ella (usó la hora);
  // el pagador es un dato para facturar y cobrar, no un cambio de titular de la cuenta.
  { nombre: "Marta Terrón (Alergista)", pagador: "Federico Terrón" },
  { nombre: "Gustavo Bogdanoff (Perito)" },
  { nombre: "Gastón Peso (Estética)", pagador: "Irma Vanesa Olmedo" },
  { nombre: "Inés Galvagno (Pediatra)" },
  { nombre: "Daniel Guerra (Pediatra)" },
  { nombre: "Marcela Bianculli (Psiquiatra)" },
  { nombre: "Marta Gil (PAMI)" },
  { nombre: "Nancy Pint (Cosmiatría)" },

  // Estos tres NO usan consultorio: pagan un abono mensual fijo.
  { nombre: "Macrogroup SRL - Carolina", abonoMensualCent: ABONO_FIJO },
  { nombre: "Megafreigth SRL - Silvana", abonoMensualCent: ABONO_FIJO },
  { nombre: "VGF Meats and Services SRL - Víctor", abonoMensualCent: ABONO_FIJO },

  { nombre: "Carolina Uz Garay (Perito)" },
  { nombre: "Andrea Horikian (Perito)" },
  { nombre: "Jorge Trento (Perito)" },
  { nombre: "Paula Cocha (Perito)" },
  { nombre: "Laura Klein (Perito)" },
  { nombre: "Lorena Skiljan (Perito)" },
  { nombre: "Jorgelina Stepanenko (Perito)" },
  { nombre: "Patricia Loianno (Perito)" },
  { nombre: "Emilce Braverman (Perito)" },
];

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

  const inquilinos = [];
  for (const p of PROFESIONALES) {
    inquilinos.push(
      await prisma.inquilino.create({
        data: { operadorId: operador.id, nombre: p.nombre, pagador: p.pagador ?? null, estado: EstadoInquilino.activo },
      }),
    );
  }

  // Los tres que pagan un fijo mensual llevan una MEMBRESÍA (§4.12) con 0 minutos incluidos:
  // "0 incluidos" es exactamente su caso — no alquilan horas, pagan el abono y listo. El cobro
  // de cada mes se postea desde la pantalla de precios, con clave idempotente por período.
  const desdeAbonos = new Date(Date.now() - 365 * 86_400_000);
  for (const [i, p] of PROFESIONALES.entries()) {
    if (!p.abonoMensualCent) continue;
    await prisma.membresia.create({
      data: {
        operadorId: operador.id,
        inquilinoId: inquilinos[i]!.id,
        nombre: "Abono mensual",
        precioMensualCent: p.abonoMensualCent,
        minutosIncluidos: 0,
        vigenteDesde: desdeAbonos,
        vigenteHasta: new Date(Date.now() + 3650 * 86_400_000),
      },
    });
  }

  // El profesional con usuario propio, para poder probar la vista del inquilino.
  const maria = inquilinos[0]!;

  // Los que SÍ alquilan consultorio. Los del abono mensual quedan afuera de toda la agenda: no
  // usan sala, y cargarles un turno en el seed sería inventar un dato que la app no aceptaría.
  const conSala = inquilinos.filter((_, i) => !PROFESIONALES[i]!.abonoMensualCent);

  // Usuarios del centro: los DOS roles que existen. El de recepción se fue con el rol — este
  // centro no tiene mostrador: los profesionales se agendan solos y la administración la lleva
  // el dueño. El borrado de arriba sigue incluyendo ana@email.com para limpiar las bases que
  // quedaron sembradas antes del cambio.
  const hash = await hashPassword(PASSWORD_DEMO);
  const ramiro = await prisma.usuario.create({ data: { email: "ramirojrano@gmail.com", nombre: "Ramiro Raño", passwordHash: hash } });
  const gomez = await prisma.usuario.create({ data: { email: "maria@email.com", nombre: PROFESIONALES[0]!.nombre, passwordHash: hash } });

  await prisma.usuarioOperador.createMany({
    data: [
      { usuarioId: ramiro.id, operadorId: operador.id, rol: Rol.owner },
      { usuarioId: gomez.id, operadorId: operador.id, rol: Rol.inquilino_titular, inquilinoId: maria.id },
    ],
  });

  // ── Precios (§8.8) ────────────────────────────────────────────────────────
  // La general del centro y dos excepciones por PROFESIONAL, que es como funciona de verdad: el
  // precio no depende del consultorio, depende de con quién se acordó. Todas empiezan hace un año: las reservas históricas del
  // seed también tienen que caer adentro de una tarifa vigente.
  const desdeTarifas = new Date(Date.now() - 365 * 86_400_000);
  const tarifas = await Promise.all(
    [
      { nombre: "General", salaId: null, inquilinoId: null, precioHoraCent: TARIFA_HORA_CENT },
      { nombre: conSala[0]!.nombre, salaId: null, inquilinoId: conSala[0]!.id, precioHoraCent: 700_000n },
      { nombre: conSala[3]!.nombre, salaId: null, inquilinoId: conSala[3]!.id, precioHoraCent: 950_000n },
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
    reserva(s1, conSala[1]!.id, hoy, "09:00", "10:00"),
    reserva(s1, conSala[2]!.id, hoy, "10:00", "11:00"),
    reserva(s1, conSala[3]!.id, hoy, "14:00", "16:00"),
    reserva(s1, maria.id, hoy, "18:00", "19:00"),
    // bloque de 15' (altura mínima del bloque en la grilla)
    reserva(s2, conSala[4]!.id, hoy, "08:30", "08:45"),
    reserva(s2, conSala[5]!.id, hoy, "11:00", "12:30"),
    reserva(s2, conSala[6]!.id, hoy, "16:00", "17:00", EstadoOcupacion.usada),
    reserva(s3, conSala[8]!.id, hoy, "09:30", "11:00"),
    reserva(s3, conSala[9]!.id, hoy, "13:00", "14:00", EstadoOcupacion.no_show),
    reserva(s3, conSala[10]!.id, hoy, "19:00", "21:00"),
    // mantenimiento (se pinta distinto y bloquea la sala)
  );

  // Resto de la semana, para que la agenda no se vea vacía al navegar. Los consultorios abren
  // los siete días, así que no se saltea ninguno.
  for (let d = 1; d <= 9; d++) {
    const f = sumarDiasLocal(hoy, d)!;
    filas.push(
      reserva(s1, conSala[(d * 3) % conSala.length]!.id, f, "09:00", "10:00"),
      reserva(s2, conSala[(d * 5) % conSala.length]!.id, f, "15:00", "16:30"),
      reserva(s3, maria.id, f, "17:00", "18:00"),
    );
  }

  // Historia del mes pasado, incluida la SALA ARCHIVADA: tiene que seguir apareciendo en los
  // reportes aunque ya no se pueda reservar en ella (§11.8).
  const mesPasado = sumarDiasLocal(hoy, -35)!;
  filas.push(
    reserva(salaArchivada.id, conSala[11]!.id, mesPasado, "10:00", "11:00", EstadoOcupacion.usada),
    reserva(s1, conSala[7]!.id, mesPasado, "16:00", "17:00", EstadoOcupacion.usada),
  );

  await prisma.ocupacion.createMany({ data: filas });

  // Plata: cada reserva con precio deja su cargo en la cuenta corriente, con la MISMA clave
  // idempotente que usa el alta real (`cargo_uso:<ocupacionId>`).
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
      { operadorId: operador.id, inquilinoId: conSala[7]!.id, concepto: "pago" as const, montoCent: -800_000n, moneda: operador.moneda, periodo: periodoDeInstante(T(mesPasado, "18:00"), TZ), fechaHecho: T(mesPasado, "18:00"), clave: "pago:seed-viejo" },
    ],
  });

  console.log(`  operador  : ${operador.nombre} (${SLUG})`);
  console.log(`  salas     : 3 activas + 1 archivada con historia`);
  console.log(`  profesionales: ${PROFESIONALES.length} (${PROFESIONALES.filter((p) => p.abonoMensualCent).length} con abono mensual, sin consultorio)`);
  console.log(`  ocupaciones: ${filas.length}`);
  console.log("");
  console.log(`  Entrá en /panel/${SLUG} con:`);
  console.log(`    administrador  ramirojrano@gmail.com / ${PASSWORD_DEMO}`);
  console.log(`    profesional    maria@email.com       / ${PASSWORD_DEMO}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    // Un fallo de ESQUEMA se explica; el resto se muestra crudo. Sin esto, la base vieja hacía
    // que el seed muriera con veinte líneas de stack de Prisma apuntando a la línea que usa una
    // columna nueva — el dato útil ("la base es de otra versión, resetéala") no aparecía por
    // ningún lado, y el que lo corre termina buscando el problema en el seed.
    const falla = diagnosticar(e);
    if (falla) {
      const { titulo, porque, pasos } = explicar(falla);
      console.error(`\n  ✗ ${titulo}`);
      console.error(`    ${porque}`);
      for (const paso of pasos) console.error(`    → ${paso}`);
      console.error("");
    } else {
      console.error(e);
    }
    await prisma.$disconnect();
    process.exit(1);
  });
