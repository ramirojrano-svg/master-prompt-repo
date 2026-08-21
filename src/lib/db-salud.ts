// src/lib/db-salud.ts — traduce un error de Prisma a algo que un humano pueda accionar.
//
// Por qué existe: los errores de infraestructura entraban a la app disfrazados de otra cosa.
// Con la base sin esquema, Prisma tira P2021 en la PRIMERA consulta, y entonces:
//   · el login lo cazaba en un `catch` mudo y mostraba "email o contraseña incorrectos"
//     (mandando a revisar credenciales que estaban perfectas), y
//   · el panel lo dejaba escapar y el operador veía un stack de Turbopack.
// Ninguna de las dos pantallas decía lo único que importaba: "la base no tiene las tablas,
// corré `npm run db:esquema`".
//
// La detección es por duck-typing sobre `code`/`name` y no importando las clases de error de
// Prisma a propósito: así este módulo es puro, se testea con objetos literales y no arrastra el
// cliente (ni su binario) a un test unitario.

export type Falla =
  | { tipo: "sin-conexion" }
  | { tipo: "sin-esquema"; tabla: string | null }
  | { tipo: "esquema-viejo"; columna: string | null }
  | { tipo: "cliente-viejo"; campo: string | null };

type ErrorPrisma = { name?: unknown; code?: unknown; meta?: { table?: unknown; column?: unknown } };

const texto = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/**
 * ¿Este error es un problema de la BASE (no del pedido)? Devuelve el diagnóstico, o null si es
 * cualquier otra cosa — y ese null importa: el caller re-lanza, así un NEXT_REDIRECT o un bug
 * de verdad no quedan tapados por una pantalla de "revisá la base".
 */
export function diagnosticar(e: unknown): Falla | null {
  if (typeof e !== "object" || e === null) return null;
  const { name, code, meta } = e as ErrorPrisma;

  // Tabla ausente: la base existe y responde, pero nunca se le aplicó el esquema.
  if (code === "P2021") return { tipo: "sin-esquema", tabla: texto(meta?.table) };

  // Columna ausente: el esquema está, pero es de una versión anterior del código (deriva).
  if (code === "P2022") return { tipo: "esquema-viejo", columna: texto(meta?.column) };

  // P1000/P1001/P1002/P1017: credenciales, host inalcanzable, timeout, conexión cerrada.
  // P2024: el pool no consiguió conexión — desde la pantalla es lo mismo, la base no contesta.
  if (code === "P2024" || (typeof code === "string" && /^P100[0-2]$|^P1017$/.test(code))) {
    return { tipo: "sin-conexion" };
  }

  // Cuando Prisma ni siquiera pudo conectar, el error no trae `code`: se reconoce por la clase.
  if (typeof name === "string" && name.includes("Initialization")) return { tipo: "sin-conexion" };

  // El caso al revés del anterior: la BASE está al día y el CLIENTE GENERADO quedó viejo. Pasa
  // después de un `git pull` que cambia el schema — el cliente se regenera en `npm install`
  // (postinstall), no al bajar código. Prisma lo reporta como error de VALIDACIÓN, sin `code`,
  // porque para él el campo directamente no existe.
  if (typeof name === "string" && name.includes("Validation")) {
    const m = /Unknown argument `([^`]+)`/.exec(String((e as { message?: unknown }).message ?? ""));
    if (m) return { tipo: "cliente-viejo", campo: m[1] ?? null };
  }

  return null;
}

/** El texto que ve el operador: qué pasó, por qué, y los comandos exactos que lo resuelven. */
export function explicar(f: Falla): { titulo: string; porque: string; pasos: string[] } {
  switch (f.tipo) {
    case "sin-conexion":
      return {
        titulo: "La base de datos no responde",
        porque:
          "El servidor de Postgres no está aceptando conexiones. Suele ser que no está levantado, " +
          "o que DATABASE_URL apunta a otro puerto.",
        pasos: ["Levantá Postgres (o el contenedor: docker start emoapp-db)", "npm run doctor"],
      };
    case "sin-esquema":
      return {
        titulo: "La base está vacía",
        porque:
          `Postgres responde, pero la tabla ${f.tabla ?? "que hace falta"} no existe: a esta base ` +
          "nunca se le aplicó el esquema.",
        pasos: ["npm run db:esquema", "npm run seed", "npm run doctor"],
      };
    case "cliente-viejo":
      return {
        titulo: "El cliente de Prisma quedó viejo",
        porque:
          `El código usa ${f.campo ?? "un campo"} y el cliente generado no lo conoce. La BASE está bien: ` +
          "lo que falta es regenerar el cliente, que se rehace al instalar y no al bajar código.",
        pasos: ["npx prisma generate", "y volvé a correr lo que estabas haciendo"],
      };
    case "esquema-viejo":
      return {
        titulo: "La base quedó vieja",
        porque:
          `Falta la columna ${f.columna ?? "que el código espera"}: el esquema es de una versión ` +
          "anterior del código. La app se actualizó y la base no.",
        // El aviso va ANTES del comando: `db:reset` borra la base entera, y en una instalación con
        // turnos cargados eso es la agenda y la facturación de verdad. Ofrecerlo a secas —como se
        // hacía— es ofrecer un desastre a alguien que está apurado porque la pantalla no carga.
        pasos: [
          "En producción: volvé a desplegar. El esquema se aplica solo al construir, sin borrar nada.",
          "En desarrollo, si la base es de prueba: npm run db:reset && npm run seed",
        ],
      };
  }
}

/**
 * Corre algo contra la base devolviendo la falla en vez de tirar la pantalla abajo. Lo que NO es
 * un problema de base se re-lanza intacto (un NEXT_REDIRECT tiene que seguir redirigiendo).
 */
export async function intentar<T>(fn: () => Promise<T>): Promise<{ ok: true; valor: T } | { ok: false; falla: Falla }> {
  try {
    return { ok: true, valor: await fn() };
  } catch (e) {
    const falla = diagnosticar(e);
    if (!falla) throw e;
    return { ok: false, falla };
  }
}

/**
 * ¿La URL de la base apunta a una conexión POOLED?
 *
 * En Vercel cada instancia abre su propio grupo de conexiones. Apuntando a la base directa en vez
 * del pooler, un pico de visitas las agota y la app contesta "too many connections" justo cuando
 * más se usa — que es el peor momento para diagnosticar, porque el síntoma no dice nada del motivo.
 *
 * Solo AVISA: no impide arrancar. Una heurística sobre el texto de una URL no puede tener la
 * última palabra sobre si la app corre, y un centro con poco tráfico funciona igual sin pooler.
 */
export function avisoDePooler(url: string | undefined, entorno: string): string | null {
  if (entorno !== "production" || !url) return null;

  // Las tres formas en que se declara un pooler en los proveedores que se usan: Neon lo pone en el
  // host, Supabase en el puerto, y PgBouncer pide el parámetro.
  const pooled =
    /-pooler\./.test(url) || /:6543\b/.test(url) || /[?&]pgbouncer=true\b/.test(url) || /pooler\./.test(url);
  if (pooled) return null;

  return (
    "DATABASE_URL no parece apuntar al pooler. En producción cada instancia abre sus propias " +
    "conexiones, y sin pooler un pico las agota. En Neon es el host que termina en '-pooler'."
  );
}
