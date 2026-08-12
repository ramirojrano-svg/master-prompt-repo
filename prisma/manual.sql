-- prisma/manual.sql — [2] INVARIANTES A MANO (lo que Prisma no expresa, §4.8.3 / §9).
-- Este archivo se APENDEA al baseline generado por Prisma para formar la migración
-- 0001_ocupacion_exclusion (ver scripts/regen-migracion.sh). `prisma db push` borra esto en
-- silencio: usar SIEMPRE `prisma migrate`.

CREATE EXTENSION IF NOT EXISTS btree_gist;  -- para mezclar `text WITH =` y `range WITH &&`

-- CHECKs de Ocupacion (§4.8.3).
ALTER TABLE "Ocupacion"
  ADD CONSTRAINT "ocupacion_rango_valido"   CHECK ("fin" > "inicio"),
  ADD CONSTRAINT "ocupacion_dur_max"        CHECK ("fin" <= "inicio" + interval '12 hours'),
  ADD CONSTRAINT "ocupacion_sala_requerida" CHECK ("tipo" = 'bloqueo' OR "salaId" IS NOT NULL),
  -- sala Y inquilino juntos solo valen para reserva/hold (ambos atan inquilino+sala). Un
  -- bloqueo/mantenimiento con ambos sería "mixto" y no existe (§4.7.3). El hold SÍ tiene los dos.
  ADD CONSTRAINT "ocupacion_bloqueo_no_mixto"
    CHECK (NOT ("salaId" IS NOT NULL AND "inquilinoId" IS NOT NULL AND "tipo" NOT IN ('reserva', 'hold'))),
  ADD CONSTRAINT "ocupacion_hold_expira"    CHECK ("tipo" <> 'hold' OR "expiraAt" IS NOT NULL);

-- Rango SEMIABIERTO '[)': 09:00-10:00 y 10:00-11:00 NO se solapan. MISMA semántica
-- que seSolapan() en TS. Con '[]' la base y el motor discreparían.
ALTER TABLE "Ocupacion"
  ADD COLUMN "rango" tstzrange
  GENERATED ALWAYS AS (tstzrange("inicio", "fin", '[)')) STORED;

-- Qué estados ocupan la sala. DERIVADO, no escrito por la app: que un estado nuevo
-- se olvide de actualizar este flag es el modo de falla más caro posible.
ALTER TABLE "Ocupacion"
  ADD COLUMN "ocupa" boolean
  GENERATED ALWAYS AS ("estado" IN ('confirmada', 'en_curso', 'usada', 'no_show')) STORED;

-- INVARIANTE 9: una sala nunca tiene dos ocupaciones activas solapadas.
ALTER TABLE "Ocupacion"
  ADD CONSTRAINT "ocupacion_sala_sin_solape"
  EXCLUDE USING gist ("salaId" WITH =, "rango" WITH &&)
  WHERE ("ocupa" AND "salaId" IS NOT NULL);

-- Eje PROFESIONAL: nadie está en dos salas a la vez. Se apaga por inquilino (equipo con
-- asistente) con la COLUMNA `bloqueaProfesional`, estampada al crear — no una lectura de
-- config adentro del constraint (que no se puede).
ALTER TABLE "Ocupacion"
  ADD CONSTRAINT "ocupacion_inquilino_sin_solape"
  EXCLUDE USING gist ("inquilinoId" WITH =, "rango" WITH &&)
  WHERE ("ocupa" AND "bloqueaProfesional" AND "tipo" = 'reserva' AND "inquilinoId" IS NOT NULL);

-- Índices de lectura parciales (los generales ya están en el baseline).
CREATE INDEX "ocupacion_sede_inicio_idx" ON "Ocupacion" ("sedeId", "inicio") WHERE "ocupa";
CREATE INDEX "ocupacion_hold_expira_idx" ON "Ocupacion" ("expiraAt") WHERE "tipo" = 'hold' AND "ocupa";
