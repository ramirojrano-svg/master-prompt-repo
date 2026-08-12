-- 0001_ocupacion_exclusion — el núcleo de la concurrencia (§4.8.3 del master).
--
-- Estructura (unificada a operadorId, §3.2):
--   [1] Baseline generado por Prisma desde prisma/schema.prisma (tablas, enums, FK
--       compuestas (operadorId,id) NoAction, índices). NO editar a mano: si cambia el
--       schema, se regenera con `prisma migrate diff --from-empty --to-schema-datamodel`.
--   [2] Invariantes que Prisma NO expresa, escritas a mano: btree_gist, columnas
--       generadas `rango`/`ocupa`, los dos EXCLUDE y los CHECK. `prisma db push` las
--       BORRA en silencio (lección §9) — usar SIEMPRE `prisma migrate`, nunca push.
--   El runbook (cómo aplicarla, Docker vs Postgres local) está en prisma/README.md.

-- ═══════════════════════════════════════════════════════════════════════════
-- [1] BASELINE (Prisma, desde el schema)
-- ═══════════════════════════════════════════════════════════════════════════
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EstadoInquilino" AS ENUM ('activo', 'suspendido', 'baja');

-- CreateEnum
CREATE TYPE "tipo_ocupacion" AS ENUM ('reserva', 'hold', 'bloqueo', 'mantenimiento');

-- CreateEnum
CREATE TYPE "estado_ocupacion" AS ENUM ('solicitada', 'confirmada', 'en_curso', 'usada', 'no_show', 'cancelada', 'rechazada', 'reubicada', 'expirada');

-- CreateTable
CREATE TABLE "Operador" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "pais" TEXT NOT NULL DEFAULT 'AR',
    "moneda" TEXT NOT NULL DEFAULT 'ARS',
    "slug" TEXT NOT NULL,
    "creadoEl" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Operador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sede" (
    "id" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT NOT NULL DEFAULT '',
    "zonaHoraria" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Sede_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sala" (
    "id" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "sedeId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "archivadaEl" TIMESTAMPTZ(6),

    CONSTRAINT "Sala_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inquilino" (
    "id" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "estado" "EstadoInquilino" NOT NULL DEFAULT 'activo',

    CONSTRAINT "Inquilino_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ocupacion" (
    "id" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "sedeId" TEXT,
    "salaId" TEXT,
    "inquilinoId" TEXT,
    "tipo" "tipo_ocupacion" NOT NULL,
    "estado" "estado_ocupacion" NOT NULL DEFAULT 'confirmada',
    "inicio" TIMESTAMPTZ(6) NOT NULL,
    "fin" TIMESTAMPTZ(6) NOT NULL,
    "bufferMin" SMALLINT NOT NULL DEFAULT 0,
    "tzSede" TEXT NOT NULL,
    "bloqueaProfesional" BOOLEAN NOT NULL DEFAULT true,
    "serieId" TEXT,
    "reemplazaAId" TEXT,
    "motivo" TEXT,
    "notaInterna" TEXT,
    "expiraAt" TIMESTAMPTZ(6),
    "creadoEl" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ocupacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EsperaSlot" (
    "id" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "inquilinoId" TEXT NOT NULL,
    "salaId" TEXT,
    "fechaDesde" TIMESTAMPTZ(6) NOT NULL,
    "fechaHasta" TIMESTAMPTZ(6) NOT NULL,
    "franjaDesde" TEXT,
    "franjaHasta" TEXT,
    "vigenteHasta" TIMESTAMPTZ(6) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "pases" INTEGER NOT NULL DEFAULT 0,
    "creadoEl" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EsperaSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BolsaAsiento" (
    "id" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "inquilinoId" TEXT NOT NULL,
    "bolsa" VARCHAR(8) NOT NULL,
    "minutos" INTEGER NOT NULL,
    "periodo" VARCHAR(7) NOT NULL,
    "origenId" TEXT,
    "reservaId" TEXT,
    "clave" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BolsaAsiento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Operador_slug_key" ON "Operador"("slug");

-- CreateIndex
CREATE INDEX "Sede_operadorId_idx" ON "Sede"("operadorId");

-- CreateIndex
CREATE UNIQUE INDEX "Sede_operadorId_id_key" ON "Sede"("operadorId", "id");

-- CreateIndex
CREATE INDEX "Sala_operadorId_sedeId_activa_idx" ON "Sala"("operadorId", "sedeId", "activa");

-- CreateIndex
CREATE UNIQUE INDEX "Sala_operadorId_id_key" ON "Sala"("operadorId", "id");

-- CreateIndex
CREATE INDEX "Inquilino_operadorId_estado_idx" ON "Inquilino"("operadorId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "Inquilino_operadorId_id_key" ON "Inquilino"("operadorId", "id");

-- CreateIndex
CREATE INDEX "Ocupacion_operadorId_salaId_inicio_idx" ON "Ocupacion"("operadorId", "salaId", "inicio");

-- CreateIndex
CREATE INDEX "Ocupacion_operadorId_inquilinoId_inicio_idx" ON "Ocupacion"("operadorId", "inquilinoId", "inicio");

-- CreateIndex
CREATE INDEX "Ocupacion_serieId_idx" ON "Ocupacion"("serieId");

-- CreateIndex
CREATE INDEX "EsperaSlot_operadorId_activo_fechaHasta_idx" ON "EsperaSlot"("operadorId", "activo", "fechaHasta");

-- CreateIndex
CREATE INDEX "BolsaAsiento_operadorId_inquilinoId_bolsa_periodo_idx" ON "BolsaAsiento"("operadorId", "inquilinoId", "bolsa", "periodo");

-- CreateIndex
CREATE UNIQUE INDEX "BolsaAsiento_operadorId_clave_key" ON "BolsaAsiento"("operadorId", "clave");

-- AddForeignKey
ALTER TABLE "Sede" ADD CONSTRAINT "Sede_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "Operador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sala" ADD CONSTRAINT "Sala_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "Operador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sala" ADD CONSTRAINT "Sala_operadorId_sedeId_fkey" FOREIGN KEY ("operadorId", "sedeId") REFERENCES "Sede"("operadorId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquilino" ADD CONSTRAINT "Inquilino_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "Operador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ocupacion" ADD CONSTRAINT "Ocupacion_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "Operador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ocupacion" ADD CONSTRAINT "Ocupacion_operadorId_salaId_fkey" FOREIGN KEY ("operadorId", "salaId") REFERENCES "Sala"("operadorId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ocupacion" ADD CONSTRAINT "Ocupacion_operadorId_inquilinoId_fkey" FOREIGN KEY ("operadorId", "inquilinoId") REFERENCES "Inquilino"("operadorId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ocupacion" ADD CONSTRAINT "Ocupacion_reemplazaAId_fkey" FOREIGN KEY ("reemplazaAId") REFERENCES "Ocupacion"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsperaSlot" ADD CONSTRAINT "EsperaSlot_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "Operador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BolsaAsiento" ADD CONSTRAINT "BolsaAsiento_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "Operador"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- [2] INVARIANTES A MANO (lo que Prisma no expresa)
-- ═══════════════════════════════════════════════════════════════════════════

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
