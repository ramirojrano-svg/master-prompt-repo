// src/dominio/conflictos.ts — cómo se le cuenta a una persona qué fechas de su serie no entraron.
//
// El motor ya devolvía la lista exacta —fecha y motivo de cada ocurrencia rechazada— y la pantalla
// mostraba solo el número: "3 fechas quedaron afuera porque el consultorio ya estaba ocupado o
// cerrado". Con eso, el que agenda no sabe QUÉ lunes se perdió ni por qué, y la única forma de
// enterarse es recorrer la agenda a mano buscando el hueco. La información existía y se tiraba.
//
// Los tres motivos no son el mismo problema y no se arreglan igual:
//   · SLOT_OCUPADO     → ese consultorio ya está tomado. Se resuelve eligiendo OTRO consultorio.
//   · SOLAPA_INQUILINO → el profesional ya tiene un turno a esa hora en otro consultorio. Se
//                        resuelve cambiando la HORA (o no era un choque, era un duplicado).
//   · FUERA_DE_HORARIO → el consultorio está cerrado ese día. Se resuelve cambiando el día u
//                        horario de apertura.
// Juntarlos en "ocupado o cerrado" borra justamente la parte accionable.
//
// El RESUMEN se arma donde están TODOS los conflictos (en el servidor, apenas escribe la serie) y
// viaja ya contado. La primera versión mandaba las fechas crudas recortadas y dejaba que la
// pantalla contara: con 57 choques la URL llevaba 18 y el cartel decía "57 fechas quedaron afuera"
// y abajo "y 12 más" — dos números que no cerraban entre sí. Contar en un lado y mostrar en otro
// sobre datos ya recortados no puede dar bien.

export type CodigoConflicto = "SLOT_OCUPADO" | "SOLAPA_INQUILINO" | "FUERA_DE_HORARIO";
export type ConflictoFecha = { fecha: string; codigo: string };

/** Un motivo, con TODAS las que cayeron por él y una muestra de fechas. */
export type GrupoCrudo = { codigo: string; total: number; fechas: string[] };

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Cuántas fechas se nombran por motivo antes de cortar. Una lista de cincuenta no se lee. */
export const FECHAS_A_MOSTRAR = 6;

/**
 * 'YYYY-MM-DD' → 'lunes 17/8'. Sin Date ni zonas: es una fecha de CALENDARIO, y construir un Date
 * para nombrarla es la vía más corta a que en Buenos Aires diga el día anterior.
 */
export function nombrarFecha(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Zeller: el día de la semana de una fecha del calendario gregoriano, con aritmética entera.
  const mm = mes < 3 ? mes + 12 : mes;
  const aa = mes < 3 ? a - 1 : a;
  const h = (d + Math.floor((13 * (mm + 1)) / 5) + aa + Math.floor(aa / 4) - Math.floor(aa / 100) + Math.floor(aa / 400)) % 7;
  const dow = (h + 6) % 7; // Zeller: 0 = sábado ⇒ se corre a 0 = domingo
  return `${DIAS[dow]} ${d}/${mes}`;
}

const TEXTO: Record<CodigoConflicto, string> = {
  SLOT_OCUPADO: "el consultorio ya estaba ocupado por otro profesional",
  SOLAPA_INQUILINO: "el profesional ya tenía un turno a esa hora en otro consultorio",
  FUERA_DE_HORARIO: "el consultorio estaba cerrado",
};

/**
 * Agrupa por motivo contando el TOTAL de cada uno y quedándose con una muestra de fechas. Se corre
 * con la lista completa, antes de recortar nada: el total sale de acá y por eso siempre es real.
 *
 * Los grupos salen de más a menos: si de cincuenta ocurrencias cuarenta cayeron fuera de horario y
 * dos chocaron con otro profesional, lo primero que hay que leer es lo de las cuarenta.
 */
export function resumirConflictos(conflictos: ConflictoFecha[]): GrupoCrudo[] {
  const porCodigo = new Map<string, string[]>();
  for (const c of conflictos) {
    const lista = porCodigo.get(c.codigo) ?? [];
    lista.push(c.fecha);
    porCodigo.set(c.codigo, lista);
  }
  return [...porCodigo]
    .map(([codigo, fechas]) => ({ codigo, total: fechas.length, fechas: [...fechas].sort().slice(0, FECHAS_A_MOSTRAR) }))
    .sort((x, y) => y.total - x.total);
}

export type GrupoConflicto = { motivo: string; fechas: string[]; ocultas: number };

/** El resumen, ya en castellano y listo para pintar. */
export function describirConflictos(grupos: GrupoCrudo[]): GrupoConflicto[] {
  return grupos.map((g) => ({
    motivo: TEXTO[g.codigo as CodigoConflicto] ?? "no se pudo agendar",
    fechas: g.fechas.map(nombrarFecha),
    ocultas: Math.max(0, g.total - g.fechas.length),
  }));
}

// ── Ida y vuelta por la URL ────────────────────────────────────────────────
// El alta redirige después de escribir (POST-redirect-GET, para que recargar no vuelva a crear la
// serie), así que el resumen tiene que viajar en la query. Va ya contado: `<codigo>:<total>:<f.f.f>`.

export function serializarConflictos(grupos: GrupoCrudo[]): string {
  return grupos.map((g) => `${g.codigo}:${g.total}:${g.fechas.join(".")}`).join("~");
}

export function parsearConflictos(s: string | undefined): GrupoCrudo[] {
  if (!s) return [];
  return s
    .split("~")
    .map((parte) => {
      const [codigo, total, fechas] = parte.split(":");
      const n = Number(total);
      if (!codigo || !Number.isInteger(n) || n < 1) return null;
      const lista = (fechas ?? "").split(".").filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f));
      // El total nunca puede ser menor que las fechas que efectivamente llegaron: si la query
      // viene manoseada, gana lo que se puede probar.
      return { codigo, total: Math.max(n, lista.length), fechas: lista };
    })
    .filter((g): g is GrupoCrudo => g !== null);
}
