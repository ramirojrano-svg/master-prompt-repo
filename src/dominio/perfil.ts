// src/dominio/perfil.ts — el borde de entrada del perfil, PURO y testeable (§11.2 regla 3).
//
// Vive separado del servicio por una razón concreta: el selector de foto es un componente de
// CLIENTE y necesita el tope de tamaño. Si lo importara del servicio, se llevaría al navegador
// todo lo que ese archivo arrastra —Prisma incluido— y el build revienta. Acá no hay nada que no
// pueda correr en los dos lados.

import { z } from "zod";

// Los prefijos que se ofrecen. Cerrado a propósito: es una lista para elegir, no un campo libre.
//
// "Lica." salió: no es una abreviatura que se use — a una licenciada se la escribe "Lic." igual
// que a un licenciado. "Sr." y "Sra." entraron para quien no ejerce con título profesional.
export const TITULOS = ["Dr.", "Dra.", "Lic.", "Prof.", "Sr.", "Sra."] as const;
export type Titulo = (typeof TITULOS)[number];

/**
 * Techo de la foto guardada, en caracteres de la data URL. 200×200 en JPEG de calidad media ronda
 * los 15 KB; 120 KB deja aire de sobra para una foto rara sin que una fila de esta tabla pase a
 * pesar más que el resto de la base junta.
 */
export const FOTO_MAX_CHARS = 120_000;

/** Solo imágenes y solo como data URL: una URL http acá sería pedirle al navegador que salga a buscarla. */
export const FOTO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export const PerfilInput = z.object({
  nombre: z.string().trim().min(1).max(120),
  // "" (el option vacío del select) significa "sin título", y se guarda NULL.
  titulo: z.enum(TITULOS).or(z.literal("")).optional(),
  // Ausente = dejar la foto como está. Distinguirlo de "borrala" importa: un formulario que no
  // reenvía la foto no puede querer decir que la saquen.
  foto: z.string().max(FOTO_MAX_CHARS).optional(),
  borrarFoto: z.coerce.boolean().optional(),
});

export type PerfilEntrada = z.infer<typeof PerfilInput>;

/** Cómo se nombra a alguien con su título adelante. "Dra." + "María Gómez" => "Dra. María Gómez". */
export function nombreConTitulo(p: { nombre: string; titulo?: string | null }): string {
  return p.titulo ? `${p.titulo} ${p.nombre}` : p.nombre;
}

/**
 * Las iniciales con las que se dibuja a alguien que no cargó foto. Toma la primera letra de las
 * dos primeras palabras REALES del nombre.
 *
 * Se saltean los títulos ("Dra. María Gómez" da MG, no DM) y lo que viene entre paréntesis, que en
 * este centro es la especialidad: "Marta Terrón (Alergista)" tiene que dar MT.
 */
export function inicialesDe(nombre: string): string {
  const limpio = nombre
    .replace(/\([^)]*\)/g, " ") // la especialidad no es parte del nombre
    .split(/\s+/)
    .filter((p) => p && !(TITULOS as readonly string[]).includes(p));

  const letras = limpio.slice(0, 2).map((p) => p[0] ?? "");
  return letras.join("").toUpperCase() || "?";
}

/**
 * El nombre a secas, sin la especialidad entre paréntesis ni el guion de quién factura.
 *
 * En la lista de profesionales "Marta Terrón (Alergista)" ayuda: hay veintinueve y la especialidad
 * es lo que distingue a dos Martas. En la liquidación no: es un documento dirigido A esa persona,
 * y ahí el paréntesis se lee como una anotación interna del centro que se coló en el papel.
 *
 * No toca el nombre guardado. Es cómo se ESCRIBE, no qué se guarda.
 */
export function nombreSinEspecialidad(nombre: string): string {
  return nombre
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    // Un nombre que quedó terminando en guion o coma después de sacar el paréntesis: pasa con
    // "Verónica Sorasio - Guillermina Ortega (Dermatología)", que sin esto queda con el guion
    // colgando si el paréntesis estaba al final.
    .replace(/[\s,–—-]+$/, "")
    .trim();
}

/**
 * El celular como lo quiere wa.me: solo dígitos, con código de país y sin el 15.
 *
 * Se normaliza al guardar y no al usar, porque cada uno lo escribe distinto —"11 2233-4455",
 * "+54 9 11 2233 4455", "011 15 2233 4455"— y un link armado con cualquiera de esos no abre nada.
 * Devuelve null si no queda un número plausible: mejor no ofrecer el botón que ofrecer uno roto.
 */
export function telefonoAWa(bruto: string | null | undefined): string | null {
  if (!bruto) return null;
  let n = bruto.replace(/\D/g, "");
  if (!n) return null;

  // Argentina: 0 de larga distancia y 15 de celular son prefijos de discado interno que el
  // formato internacional no lleva. Se sacan antes de anteponer el país.
  if (n.startsWith("54")) {
    n = n.slice(2).replace(/^0/, "");
    // El 9 va después del 54 y antes del área: si ya venía, no se duplica.
    n = n.replace(/^9/, "");
    n = n.replace(/^(\d{2,4})15/, "$1");
    n = `549${n}`;
  } else {
    n = n.replace(/^0/, "");
    n = n.replace(/^(\d{2,4})15/, "$1");
    n = `549${n}`;
  }
  // Un número argentino con código de país queda entre 12 y 13 dígitos. Fuera de ahí no se
  // adivina: se devuelve null y el botón no se dibuja.
  return n.length >= 12 && n.length <= 14 ? n : null;
}
