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
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('owner', 'inquilino_titular', 'soporte_plataforma');

-- CreateEnum
CREATE TYPE "EstadoInquilino" AS ENUM ('activo', 'suspendido', 'baja');

-- CreateEnum
CREATE TYPE "tipo_ocupacion" AS ENUM ('reserva', 'hold', 'bloqueo');

-- CreateEnum
CREATE TYPE "estado_ocupacion" AS ENUM ('solicitada', 'confirmada', 'en_curso', 'usada', 'no_show', 'cancelada', 'rechazada', 'reubicada', 'expirada');

-- CreateEnum
CREATE TYPE "CuentaTipo" AS ENUM ('corriente', 'garantia');

-- CreateEnum
CREATE TYPE "Concepto" AS ENUM ('cargo_uso', 'cargo_excedente', 'cargo_membresia', 'cargo_exclusividad', 'cargo_bono', 'penalidad_tardia', 'penalidad_noshow', 'ajuste_debito', 'deposito_alta', 'interes_mora', 'pago', 'pago_con_deposito', 'nota_credito', 'penalidad_revertida', 'reintegro', 'ajuste_credito', 'deposito_devolucion', 'deposito_ejecucion');

-- CreateEnum
CREATE TYPE "MedioPago" AS ENUM ('mercado_pago', 'transferencia');

-- CreateEnum
CREATE TYPE "RubroGasto" AS ENUM ('alquiler', 'expensas', 'servicios', 'limpieza', 'mantenimiento', 'insumos', 'sueldos', 'impuestos', 'seguros', 'marketing', 'otros');

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
CREATE TABLE "Tarifa" (
    "id" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "salaId" TEXT,
    "inquilinoId" TEXT,
    "nombre" TEXT NOT NULL,
    "precioHoraCent" BIGINT NOT NULL,
    "vigenteDesde" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigenteHasta" TIMESTAMPTZ(6),
    "creadoEl" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tarifa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT,
    "passwordHash" TEXT,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "creadoEl" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsuarioOperador" (
    "usuarioId" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "rol" "Rol" NOT NULL,
    "inquilinoId" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "UsuarioOperador_pkey" PRIMARY KEY ("usuarioId","operadorId")
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
    "color" TEXT NOT NULL DEFAULT '#2f6fe0',
    "orden" INTEGER NOT NULL DEFAULT 0,
    "equipamiento" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "horarioJson" JSONB,
    "bufferMin" SMALLINT NOT NULL DEFAULT 15,
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
    "pagador" TEXT,
    -- Perfil que edita el propio profesional. El titulo es el prefijo con el que quiere que lo
    -- nombren ("Dra."), y la foto va como data URL: no hay almacenamiento de archivos y una
    -- miniatura recortada a 200px pesa menos que muchas filas de esta misma base.
    "titulo" TEXT,
    "foto" TEXT,

    "facturable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Inquilino_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auditoria" (
    "id" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    -- El id y no una relación: si el usuario se borra, el registro tiene que quedar.
    "usuarioId" TEXT NOT NULL,
    "rol" "Rol" NOT NULL,
    "permiso" TEXT NOT NULL,
    "resultado" TEXT NOT NULL,
    -- Corto y SIN secretos: varias acciones reciben contraseñas y acá no entran nunca.
    "resumen" TEXT,
    "creadoEl" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Auditoria_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Auditoria_operadorId_creadoEl_idx" ON "Auditoria"("operadorId", "creadoEl");
CREATE INDEX "Auditoria_operadorId_usuarioId_creadoEl_idx" ON "Auditoria"("operadorId", "usuarioId", "creadoEl");
ALTER TABLE "Auditoria" ADD CONSTRAINT "Auditoria_operadorId_fkey"
  FOREIGN KEY ("operadorId") REFERENCES "Operador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "TokenClave" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    -- El HASH del token, nunca el token: quien lee esta tabla no debe poder entrar a ninguna cuenta.
    "tokenHash" TEXT NOT NULL,
    "expiraEl" TIMESTAMPTZ(6) NOT NULL,
    "usadoEl" TIMESTAMPTZ(6),
    "creadoEl" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenClave_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TokenClave_tokenHash_key" ON "TokenClave"("tokenHash");
CREATE INDEX "TokenClave_usuarioId_expiraEl_idx" ON "TokenClave"("usuarioId", "expiraEl");
ALTER TABLE "TokenClave" ADD CONSTRAINT "TokenClave_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "Membresia" (
    "id" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "inquilinoId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "precioMensualCent" BIGINT NOT NULL,
    "minutosIncluidos" INTEGER NOT NULL DEFAULT 0,
    "precioExcedenteCent" BIGINT,
    "salaExclusivaId" TEXT,
    "diaDeCobro" INTEGER NOT NULL DEFAULT 1,
    "estado" TEXT NOT NULL DEFAULT 'activa',
    "vigenteDesde" TIMESTAMPTZ(6) NOT NULL,
    "vigenteHasta" TIMESTAMPTZ(6),
    "cancelaAlFin" BOOLEAN NOT NULL DEFAULT false,
    "creadoEl" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membresia_pkey" PRIMARY KEY ("id")
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
    "tarifaId" TEXT,
    "precioHoraCent" BIGINT,
    "importeCent" BIGINT,
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

-- CreateTable
CREATE TABLE "Gasto" (
    "id" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "rubro" "RubroGasto" NOT NULL,
    "detalle" VARCHAR(200) NOT NULL,
    "montoCent" BIGINT NOT NULL,
    "moneda" VARCHAR(3) NOT NULL,
    "periodo" VARCHAR(7) NOT NULL,
    "fecha" TIMESTAMPTZ(6) NOT NULL,
    "proveedor" VARCHAR(120),
    "anuladoEl" TIMESTAMPTZ(6),
    "anuladoPor" TEXT,
    "motivoAnulado" VARCHAR(200),
    "creadoPorUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Gasto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asiento" (
    "id" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "inquilinoId" TEXT NOT NULL,
    "cuenta" "CuentaTipo" NOT NULL DEFAULT 'corriente',
    "concepto" "Concepto" NOT NULL,
    "montoCent" BIGINT NOT NULL,
    "moneda" VARCHAR(3) NOT NULL,
    "periodo" VARCHAR(7) NOT NULL,
    "fechaHecho" TIMESTAMPTZ(6) NOT NULL,
    "clave" TEXT NOT NULL,
    "reservaId" TEXT,
    "liquidacionId" TEXT,
    "pagoId" TEXT,
    "medio" "MedioPago",
    "referencia" TEXT,
    "revierteAId" TEXT,
    "motivo" TEXT,
    "creadoPorUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Liquidacion" (
    "id" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "inquilinoId" TEXT NOT NULL,
    "periodo" VARCHAR(7) NOT NULL,
    "numero" INTEGER NOT NULL,
    "estado" TEXT NOT NULL,
    "subtotalCent" BIGINT NOT NULL,
    "netoCent" BIGINT NOT NULL,
    "ivaCent" BIGINT NOT NULL,
    "alicuota" INTEGER NOT NULL,
    "totalCent" BIGINT NOT NULL,
    "venceEl" TIMESTAMPTZ(6) NOT NULL,
    "emitidaAt" TIMESTAMPTZ(6),
    "receptorRazonSocial" TEXT NOT NULL,
    "receptorCuit" TEXT,
    "receptorCondIva" TEXT NOT NULL,
    "facturaExternaTipo" TEXT,
    "facturaExternaNro" TEXT,
    "facturaExternaCae" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Liquidacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Operador_slug_key" ON "Operador"("slug");

-- CreateIndex
CREATE INDEX "Tarifa_operadorId_vigenteHasta_idx" ON "Tarifa"("operadorId", "vigenteHasta");

-- CreateIndex
CREATE INDEX "Tarifa_operadorId_inquilinoId_idx" ON "Tarifa"("operadorId", "inquilinoId");

-- CreateIndex
CREATE INDEX "Tarifa_operadorId_salaId_idx" ON "Tarifa"("operadorId", "salaId");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE INDEX "UsuarioOperador_operadorId_rol_idx" ON "UsuarioOperador"("operadorId", "rol");

-- CreateIndex
CREATE UNIQUE INDEX "UsuarioOperador_operadorId_inquilinoId_key" ON "UsuarioOperador"("operadorId", "inquilinoId");

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
CREATE INDEX "Membresia_operadorId_inquilinoId_vigenteHasta_idx" ON "Membresia"("operadorId", "inquilinoId", "vigenteHasta");

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

-- CreateIndex
CREATE INDEX "Gasto_operadorId_periodo_idx" ON "Gasto"("operadorId", "periodo");

-- CreateIndex
CREATE INDEX "Gasto_operadorId_rubro_periodo_idx" ON "Gasto"("operadorId", "rubro", "periodo");

-- CreateIndex
CREATE INDEX "Asiento_operadorId_inquilinoId_cuenta_fechaHecho_idx" ON "Asiento"("operadorId", "inquilinoId", "cuenta", "fechaHecho");

-- CreateIndex
CREATE INDEX "Asiento_operadorId_periodo_idx" ON "Asiento"("operadorId", "periodo");

-- CreateIndex
CREATE INDEX "Asiento_operadorId_liquidacionId_idx" ON "Asiento"("operadorId", "liquidacionId");

-- CreateIndex
CREATE UNIQUE INDEX "Asiento_operadorId_clave_key" ON "Asiento"("operadorId", "clave");

-- CreateIndex
CREATE UNIQUE INDEX "Liquidacion_operadorId_inquilinoId_periodo_key" ON "Liquidacion"("operadorId", "inquilinoId", "periodo");

-- CreateIndex
CREATE UNIQUE INDEX "Liquidacion_operadorId_numero_key" ON "Liquidacion"("operadorId", "numero");

-- AddForeignKey
ALTER TABLE "Tarifa" ADD CONSTRAINT "Tarifa_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "Operador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioOperador" ADD CONSTRAINT "UsuarioOperador_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioOperador" ADD CONSTRAINT "UsuarioOperador_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "Operador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioOperador" ADD CONSTRAINT "UsuarioOperador_operadorId_inquilinoId_fkey" FOREIGN KEY ("operadorId", "inquilinoId") REFERENCES "Inquilino"("operadorId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sede" ADD CONSTRAINT "Sede_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "Operador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sala" ADD CONSTRAINT "Sala_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "Operador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sala" ADD CONSTRAINT "Sala_operadorId_sedeId_fkey" FOREIGN KEY ("operadorId", "sedeId") REFERENCES "Sede"("operadorId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquilino" ADD CONSTRAINT "Inquilino_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "Operador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membresia" ADD CONSTRAINT "Membresia_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "Operador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membresia" ADD CONSTRAINT "Membresia_operadorId_inquilinoId_fkey" FOREIGN KEY ("operadorId", "inquilinoId") REFERENCES "Inquilino"("operadorId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "Gasto" ADD CONSTRAINT "Gasto_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "Operador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asiento" ADD CONSTRAINT "Asiento_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "Operador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Liquidacion" ADD CONSTRAINT "Liquidacion_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "Operador"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- [2] INVARIANTES A MANO (prisma/manual.sql)
-- ═══════════════════════════════════════════════════════════════════════════

-- prisma/manual.sql — [2] INVARIANTES A MANO (lo que Prisma no expresa, §4.8.3 / §9).
-- Este archivo se APENDEA al baseline generado por Prisma para formar la migración
-- 0001_ocupacion_exclusion (ver scripts/regen-migracion.sh). `prisma db push` borra esto en
-- silencio: usar SIEMPRE `prisma migrate`.

CREATE EXTENSION IF NOT EXISTS btree_gist;  -- para mezclar `text WITH =` y `range WITH &&`

-- CHECKs de Ocupacion (§4.8.3).
ALTER TABLE "Ocupacion"
  ADD CONSTRAINT "ocupacion_rango_valido"   CHECK ("fin" > "inicio"),
  ADD CONSTRAINT "ocupacion_dur_max"        CHECK ("fin" <= "inicio" + interval '12 hours'),
  -- Una RESERVA puede no tener sala: son horas que se consumen y se facturan sin usar el espacio
  -- fisico (el profesional que ese dia atiende afuera). No ocupan consultorio, asi que el
  -- consultorio queda libre para alquilarlo. El hold y el mantenimiento SI la exigen: los dos son
  -- sobre una sala concreta.
  ADD CONSTRAINT "ocupacion_sala_requerida" CHECK ("tipo" IN ('bloqueo', 'reserva') OR "salaId" IS NOT NULL),
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
