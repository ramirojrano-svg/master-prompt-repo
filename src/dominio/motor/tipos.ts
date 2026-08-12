// src/dominio/motor/tipos.ts
// Tipos base del motor. Tres representaciones del tiempo, sin superposición.
// Regla dura §14.2: todo instante se persiste en UTC; ninguna hora de pared vive sin su tz.

export type Instante = Date; // SIEMPRE UTC. Es lo único que se persiste.
export type FechaLocal = string; // 'YYYY-MM-DD' — día calendario EN LA ZONA DE LA SEDE.
export type HoraPared = string; // 'HH:MM' — 24h, sin zona, sin sentido por sí sola.
export type Tz = string; // Zona IANA (formato 'Continente/Ciudad'), obligatoria en cada firma.

/** Intervalo SEMIABIERTO [inicio, fin). fin > inicio SIEMPRE (invariante §14.1). */
export type Intervalo = { inicio: Instante; fin: Instante };
