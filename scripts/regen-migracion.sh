#!/usr/bin/env bash
# scripts/regen-migracion.sh — reensambla prisma/migrations/0001_ocupacion_exclusion/migration.sql
# = header + baseline (Prisma, desde el schema) + prisma/manual.sql (invariantes a mano).
# Correr cada vez que cambia prisma/schema.prisma. Requiere DATABASE_URL/DIRECT_URL en el entorno.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=prisma/migrations/0001_ocupacion_exclusion/migration.sql
TMP=$(mktemp)

npx --yes prisma@6 migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > "$TMP"

{
  cat <<'HEADER'
-- 0001_ocupacion_exclusion — el núcleo de la concurrencia (§4.8.3 del master).
--
-- Estructura (unificada a operadorId, §3.2):
--   [1] Baseline generado por Prisma desde prisma/schema.prisma. NO editar a mano; se regenera
--       con scripts/regen-migracion.sh.
--   [2] Invariantes que Prisma NO expresa (prisma/manual.sql): btree_gist, columnas generadas
--       `rango`/`ocupa`, los dos EXCLUDE y los CHECK. `prisma db push` las BORRA en silencio
--       (lección §9) — usar SIEMPRE `prisma migrate`, nunca push.

-- ═══════════════════════════════════════════════════════════════════════════
-- [1] BASELINE (Prisma, desde el schema)
-- ═══════════════════════════════════════════════════════════════════════════
HEADER
  cat "$TMP"
  echo
  echo "-- ═══════════════════════════════════════════════════════════════════════════"
  echo "-- [2] INVARIANTES A MANO (prisma/manual.sql)"
  echo "-- ═══════════════════════════════════════════════════════════════════════════"
  echo
  cat prisma/manual.sql
} > "$OUT"

rm -f "$TMP"
echo "migration.sql reensamblada: $(wc -l < "$OUT") líneas · $(grep -c 'CREATE TABLE' "$OUT") tablas"
