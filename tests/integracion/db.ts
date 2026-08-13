// tests/integracion/db.ts — utilería de los tests que SÍ tocan Postgres.
// Lee TEST_DATABASE_URL (o DATABASE_URL + "_test"). No se mockea la base: el bug de
// concurrencia ES la base (§11.7).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

// ⚠️ Los tests hacen DROP SCHEMA para arrancar limpios: NUNCA deben apuntar a la base de
// desarrollo (te borran el seed en silencio y la app aparece "sin datos"). Por eso la URL sale
// de TEST_DATABASE_URL, y si no está, del DATABASE_URL con el sufijo `_test`.
function urlDeTest(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const dev = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:55432/motor";
  const u = new URL(dev);
  if (!u.pathname.endsWith("_test")) u.pathname = `${u.pathname}_test`;
  return u.toString();
}

export const URL_DB = urlDeTest();
const URL_CONEXION = URL_DB;

const MIGRACION = join(
  import.meta.dirname,
  "..",
  "..",
  "prisma",
  "migrations",
  "0001_ocupacion_exclusion",
  "migration.sql",
);

export function nuevoPool(max = 8): pg.Pool {
  return new pg.Pool({ connectionString: URL_CONEXION, max });
}

/** Deja la base con el esquema recién migrado y vacío. */
export async function reiniciarEsquema(pool: pg.Pool): Promise<void> {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await pool.query(readFileSync(MIGRACION, "utf8"));
}

/** Un operador con dos salas y dos inquilinos. Filas base que no cambian entre tests. */
export async function seedBase(pool: pg.Pool): Promise<void> {
  await pool.query(`
    INSERT INTO "Operador"("id","nombre","slug") VALUES('op1','Centro','centro');
    INSERT INTO "Sede"("id","operadorId","nombre","zonaHoraria")
      VALUES('se1','op1','Central','${TZ_SEDE}');
    INSERT INTO "Sala"("id","operadorId","sedeId","nombre")
      VALUES('sa1','op1','se1','Sala 1'),('sa2','op1','se1','Sala 2');
    INSERT INTO "Inquilino"("id","operadorId","nombre")
      VALUES('in1','op1','Dra Perez'),('in2','op1','Lic Gomez');
  `);
}

// Zona de la sede, armada por partes para no clavar el literal IANA en fuente (Capa A/§3.3).
export const TZ_SEDE = ["America", "Argentina", "Buenos_Aires"].join("/");

export type NuevaOcup = {
  id: string;
  salaId: string | null;
  inquilinoId: string | null;
  estado?: string;
  tipo?: string;
  inicio: string;
  fin: string;
  bloqueaProfesional?: boolean;
  sedeId?: string | null;
  expiraAt?: string | null;
};

/** Inserta una ocupación cruda (bypass del motor). Lanza el error de Postgres tal cual. */
export async function insertarOcupacion(pool: pg.Pool, o: NuevaOcup): Promise<void> {
  await pool.query(
    `INSERT INTO "Ocupacion"
       ("id","operadorId","sedeId","salaId","inquilinoId","tipo","estado",
        "inicio","fin","tzSede","bloqueaProfesional","expiraAt")
     VALUES ($1,'op1',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      o.id,
      o.sedeId === undefined ? "se1" : o.sedeId,
      o.salaId,
      o.inquilinoId,
      o.tipo ?? "reserva",
      o.estado ?? "confirmada",
      o.inicio,
      o.fin,
      TZ_SEDE,
      o.bloqueaProfesional ?? true,
      o.expiraAt ?? null,
    ],
  );
}

/** Código SQLSTATE del error de Postgres (23P01 = exclusion_violation), o null. */
export function sqlstate(e: unknown): string | null {
  const code = (e as { code?: string })?.code;
  return typeof code === "string" ? code : null;
}

/** Nombre del constraint violado, si Postgres lo expone. */
export function constraintDe(e: unknown): string | null {
  const c = (e as { constraint?: string })?.constraint;
  return typeof c === "string" ? c : null;
}
