# `prisma/` — esquema, migraciones y runbook

## Los dos artefactos y por qué

- **`schema.prisma`** — fuente de verdad de los MODELOS (§3.5, unificado a `operadorId`).
  Genera el Prisma Client y el baseline de las migraciones.
- **`migrations/0001_ocupacion_exclusion/migration.sql`** — la migración. Tiene dos partes:
  1. **Baseline** generado por Prisma desde `schema.prisma` (tablas, enums, FK compuestas
     `(operadorId, id)` NoAction, índices).
  2. **Invariantes a mano** que Prisma no expresa: `btree_gist`, columnas generadas
     `rango`/`ocupa`, los dos `EXCLUDE USING gist` y los `CHECK`.

> ⚠️ **Nunca `prisma db push`.** Considera las columnas generadas y los `EXCLUDE` como
> "drift" y los borra en silencio — la invariante desaparece sin que nada falle en el momento
> (lección §9). Usar siempre `prisma migrate deploy`.

## Consistencia schema ↔ migración

El baseline se regenera desde el schema; nunca se edita a mano. Si cambiás `schema.prisma`:

```bash
# 1) regenerar el baseline
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > /tmp/baseline.sql
# 2) reemplazar el bloque [1] de migration.sql con /tmp/baseline.sql, dejar el bloque [2] a mano
```

Chequeo de que no hay drift (debe mostrar SOLO las columnas generadas `ocupa`/`rango`, que
Prisma no puede representar):

```bash
npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-url "$DATABASE_URL" --script
```

## Correr los tests de integración (§16 paso 2, T-29)

Los tests necesitan un Postgres 16 real (`btree_gist`). Leen `DATABASE_URL`; sin ella usan
`postgresql://postgres@127.0.0.1:55432/motor`.

### Opción A — Docker (lo recomendado para CI, §12 #4)

```bash
docker run -d --name pg-motor -e POSTGRES_PASSWORD=motor -e POSTGRES_DB=motor -p 55432:5432 postgres:16
export DATABASE_URL="postgresql://postgres:motor@127.0.0.1:55432/motor"
npm run test:db
```

### Opción B — Postgres local (fallback cuando el registry de Docker está bloqueado)

```bash
PGDATA=/var/lib/postgresql/motordata
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $PGDATA -U postgres --auth=trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA -o '-p 55432' -l /tmp/pg.log -w start"
su postgres -c "/usr/lib/postgresql/16/bin/createdb -p 55432 motor"
export DATABASE_URL="postgresql://postgres@127.0.0.1:55432/motor"
npm run test:db
```

`reiniciarEsquema()` (en `tests/integracion/db.ts`) hace `DROP SCHEMA public CASCADE` y aplica
`migration.sql` entera, así cada corrida arranca de cero.

## Aplicar en un entorno real

```bash
export DATABASE_URL=...   # pooler, modo transacción (6543 en Supabase)
export DIRECT_URL=...     # conexión directa (5432), solo para migraciones
npx prisma migrate deploy
```
