#!/usr/bin/env bash
# scripts/setup.sh — deja EMOAPP listo para `npm run dev` desde un clon limpio.
# Es idempotente: se puede correr de nuevo sin romper nada.
#
#   bash scripts/setup.sh
#
# Qué hace: verifica Node, levanta un Postgres 16 en Docker si no le pasás uno, crea .env.local
# con un AUTH_SECRET generado, instala dependencias, aplica la migración y carga el piloto.
set -euo pipefail
cd "$(dirname "$0")/.."

CONTENEDOR="emoapp-db"
PUERTO="${PGPUERTO:-55432}"
URL_DEFECTO="postgresql://postgres:emoapp@127.0.0.1:${PUERTO}/motor"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
info() { printf '  \033[36m·\033[0m %s\n' "$1"; }
err()  { printf '  \033[31m✗\033[0m %s\n' "$1" >&2; }

echo
echo "EMOAPP — preparando el entorno"
echo

# ── 1. Node ─────────────────────────────────────────────────────────────────
MAJOR=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || echo 0)
if [ "$MAJOR" -lt 22 ]; then
  err "Hace falta Node 22 o superior (tenés: $(node -v 2>/dev/null || echo 'ninguno'))."
  err "Instalalo desde https://nodejs.org y volvé a correr este script."
  exit 1
fi
ok "Node $(node -v)"

# ── 2. Base de datos ────────────────────────────────────────────────────────
# Si ya trajiste una DATABASE_URL (Supabase, Neon, tu propio Postgres), se respeta.
if [ -n "${DATABASE_URL:-}" ]; then
  info "Uso la DATABASE_URL que ya tenías en el entorno."
  URL="$DATABASE_URL"
elif [ -f .env.local ] && grep -q '^DATABASE_URL=' .env.local; then
  URL=$(grep '^DATABASE_URL=' .env.local | head -1 | cut -d= -f2- | tr -d '"')
  info "Uso la DATABASE_URL de .env.local"
else
  if ! command -v docker >/dev/null 2>&1; then
    err "No encontré Docker ni una DATABASE_URL."
    err "Opciones: instalá Docker Desktop, o exportá DATABASE_URL apuntando a un Postgres 16."
    exit 1
  fi
  if docker ps -a --format '{{.Names}}' | grep -qx "$CONTENEDOR"; then
    docker start "$CONTENEDOR" >/dev/null 2>&1 || true
    info "Contenedor '$CONTENEDOR' ya existía: lo arranqué."
  else
    docker run -d --name "$CONTENEDOR" \
      -e POSTGRES_PASSWORD=emoapp -e POSTGRES_DB=motor \
      -p "${PUERTO}:5432" postgres:16 >/dev/null
    ok "Postgres 16 levantado en el puerto ${PUERTO} (contenedor '$CONTENEDOR')"
  fi
  URL="$URL_DEFECTO"
fi

# Esperar a que acepte conexiones (un contenedor recién creado tarda unos segundos).
info "Esperando a que la base responda…"
for i in $(seq 1 40); do
  if node -e "
    const {Client}=require('pg');
    new Client({connectionString:process.argv[1]}).connect()
      .then(c=>c.end()).then(()=>process.exit(0)).catch(()=>process.exit(1));
  " "$URL" 2>/dev/null; then ok "La base responde"; break; fi
  [ "$i" = 40 ] && { err "La base no respondió. Revisá que el Postgres esté corriendo."; exit 1; }
  sleep 1
done

# ── 3. .env.local ───────────────────────────────────────────────────────────
if [ ! -f .env.local ]; then
  SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
  cat > .env.local <<ENV
DATABASE_URL="${URL}"
DIRECT_URL="${URL}"
AUTH_SECRET="${SECRET}"
AUTH_URL="http://localhost:3000"
ENV
  ok ".env.local creado (con un AUTH_SECRET generado)"
else
  info ".env.local ya existía: no lo toco"
fi

# ── 4. Dependencias ─────────────────────────────────────────────────────────
if [ ! -d node_modules ]; then
  info "Instalando dependencias (tarda un minuto)…"
  npm install --no-audit --no-fund >/dev/null
  ok "Dependencias instaladas"
else
  info "node_modules ya existía: salteo npm install"
fi

# ── 5. Esquema ──────────────────────────────────────────────────────────────
# La migración crea todo desde cero; si ya está aplicada, no se vuelve a correr.
YA=$(node -e "
  const {Client}=require('pg'); const c=new Client({connectionString:process.argv[1]});
  c.connect().then(()=>c.query(\"SELECT to_regclass('public.\\\"Ocupacion\\\"') IS NOT NULL AS existe\"))
   .then(r=>{console.log(r.rows[0].existe?'si':'no');return c.end()}).catch(()=>{console.log('no')});
" "$URL")
if [ "$YA" = "si" ]; then
  info "El esquema ya estaba aplicado"
else
  node -e "
    const {Client}=require('pg'); const fs=require('fs');
    const c=new Client({connectionString:process.argv[1]});
    c.connect()
     .then(()=>c.query(fs.readFileSync('prisma/migrations/0001_ocupacion_exclusion/migration.sql','utf8')))
     .then(()=>c.end())
     .catch(e=>{console.error(e.message);process.exit(1)});
  " "$URL"
  ok "Esquema aplicado (tablas, constraints de exclusión y btree_gist)"
fi

# ── 6. Datos del piloto ─────────────────────────────────────────────────────
DATABASE_URL="$URL" npm run seed 2>&1 | grep -E "operador|salas|inquilinos|ocupaciones" | sed 's/^/  /'
ok "Datos del piloto cargados"

cat <<FIN

Listo. Arrancá con:

    npm run dev

y entrá a  http://localhost:3000/panel/espacio-moca

    Dueño        ramirojrano@gmail.com   emoapp-2026
    Profesional  maria@email.com         emoapp-2026
    Recepción    ana@email.com           emoapp-2026

FIN
