// src/lib/freno.ts — frenar la fuerza bruta contra una credencial.
//
// El login y el pedido de recuperación son las dos únicas puertas abiertas a internet sin sesión.
// Sin freno, se pueden probar contraseñas de a miles: las claves de este centro las asigna a mano
// el administrador y viajan por WhatsApp, así que es probable que varias sean cortas o repetidas.
//
// La misma pieza cubre el otro abuso: pedir el reset en bucle manda un mail real por cada intento,
// desde una cuenta de Gmail que tiene tope diario. Llenarlo deja sin correo a TODA la app —
// incluida la liquidación mensual.
//
// Cómo funciona, y por qué así:
//
//  · Se cuenta por CLAVE, no por usuario. La clave es texto libre ("login:ana@x.com",
//    "reset:1.2.3.4"), así una puerta nueva se protege sin agregar otra tabla.
//  · Se cuenta también POR IP, no solo por email. Contar solo por email deja probar una misma
//    contraseña contra treinta y seis direcciones distintas, que es como se entra de verdad
//    cuando las claves son flojas.
//  · La espera CRECE: 1, 2, 4, 8… hasta media hora. Un error de tipeo cuesta un minuto; insistir
//    mil veces cuesta días.
//  · Los fallos VIEJOS se olvidan. Tres errores repartidos en un mes no son un ataque, son
//    alguien que no se acuerda la clave.
//  · Un fallo de la base NO cierra la puerta. Si esto no se puede consultar, se deja pasar y se
//    avisa por el log: dejar sin login a todo el centro porque una tabla auxiliar falló sería un
//    daño mayor que el que se está previniendo.

import { type PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma.ts";

/** Cuántos fallos se toleran antes de empezar a frenar. */
export const FALLOS_LIBRES = 5;
/** Después de cuánto tiempo sin fallar se olvida la cuenta. */
export const OLVIDO_MIN = 60;
/** Techo de la espera. Media hora frena a cualquiera sin dejar a nadie afuera para siempre. */
export const ESPERA_MAX_MIN = 30;

export type Veredicto = { pasa: true } | { pasa: false; segundos: number };

/** La espera que corresponde al fallo número `n`, en minutos: 1, 2, 4, 8, 16, 30, 30… */
export function esperaDe(fallos: number): number {
  const exceso = fallos - FALLOS_LIBRES;
  if (exceso <= 0) return 0;
  return Math.min(ESPERA_MAX_MIN, 2 ** (exceso - 1));
}

/**
 * ¿Puede intentar? No registra nada: solo mira.
 *
 * Se consulta ANTES de tocar la contraseña, para que un bloqueado ni siquiera gaste el bcrypt.
 */
export async function puedeIntentar(clave: string, db: PrismaClient = prisma, ahora = new Date()): Promise<Veredicto> {
  try {
    const fila = await db.intentoFallido.findUnique({ where: { clave } });
    if (!fila?.bloqueadoHasta) return { pasa: true };
    const resta = fila.bloqueadoHasta.getTime() - ahora.getTime();
    if (resta <= 0) return { pasa: true };
    return { pasa: false, segundos: Math.ceil(resta / 1000) };
  } catch (e) {
    console.error("[freno] no se pudo consultar:", (e as Error)?.message ?? e);
    return { pasa: true };
  }
}

/** Registra un fallo y devuelve cuántos van. */
export async function anotarFallo(clave: string, db: PrismaClient = prisma, ahora = new Date()): Promise<void> {
  try {
    const fila = await db.intentoFallido.findUnique({ where: { clave } });
    // Si el último fallo es viejo, se arranca de cero en vez de seguir sumando: si no, alguien que
    // se equivoca una vez por mes termina bloqueado el día que se equivoca por quinta vez en un año.
    const vigente = fila && ahora.getTime() - fila.ultimoEl.getTime() < OLVIDO_MIN * 60_000;
    const fallos = (vigente ? fila.fallos : 0) + 1;
    const espera = esperaDe(fallos);
    const datos = {
      fallos,
      ultimoEl: ahora,
      bloqueadoHasta: espera > 0 ? new Date(ahora.getTime() + espera * 60_000) : null,
    };
    await db.intentoFallido.upsert({ where: { clave }, create: { clave, ...datos }, update: datos });
  } catch (e) {
    console.error("[freno] no se pudo anotar:", (e as Error)?.message ?? e);
  }
}

/**
 * Borra la cuenta de fallos. Se llama cuando el intento sale BIEN.
 *
 * Sin esto, alguien que se equivoca cuatro veces y acierta a la quinta arrastra los cuatro fallos
 * hasta que se olviden solos, y el próximo error lo bloquea sin motivo.
 */
export async function limpiarFallos(clave: string, db: PrismaClient = prisma): Promise<void> {
  try {
    await db.intentoFallido.deleteMany({ where: { clave } });
  } catch (e) {
    console.error("[freno] no se pudo limpiar:", (e as Error)?.message ?? e);
  }
}

/** Borra lo que ya no sirve. La corre la tarea mensual, junto con el resto de la limpieza. */
export async function purgarFrenos(db: PrismaClient = prisma, ahora = new Date()): Promise<number> {
  const r = await db.intentoFallido.deleteMany({
    where: { ultimoEl: { lt: new Date(ahora.getTime() - OLVIDO_MIN * 60_000 * 24) } },
  });
  return r.count;
}
