# EMOAPP — gestión de alquiler de consultorios

SaaS para que un centro alquile sus consultorios a profesionales independientes: agenda que no
vende la misma sala dos veces, cuenta corriente por inquilino y liquidación mensual.

Piloto: **Espacio Montes de Oca** (1 sede, 3 salas, 50 profesionales, L-V 08–22).

---

## Levantarlo en tu máquina

Necesitás **Node 22+** y un **Postgres 16**. El Postgres no es opcional ni reemplazable por otra
base: el motor de reservas usa `EXCLUDE USING gist` con `btree_gist` y advisory locks, que son
los que impiden que dos profesionales reserven la misma sala a la misma hora.

### 1. Postgres

La forma más simple, con Docker:

```bash
docker run -d --name emoapp-db \
  -e POSTGRES_PASSWORD=emoapp -e POSTGRES_DB=motor \
  -p 55432:5432 postgres:16
```

Si ya tenés un Postgres 16 andando, alcanza con crear dos bases: `motor` (desarrollo) y
`motor_test` (los tests, que borran el esquema en cada corrida).

### 2. Variables de entorno

```bash
cp .env.example .env.local
```

y completá:

```bash
DATABASE_URL="postgresql://postgres:emoapp@127.0.0.1:55432/motor"
DIRECT_URL="postgresql://postgres:emoapp@127.0.0.1:55432/motor"
AUTH_SECRET="<generá uno: openssl rand -base64 32>"
```

### 3. Instalar, migrar y cargar datos

```bash
npm install
psql "$DATABASE_URL" -f prisma/migrations/0001_ocupacion_exclusion/migration.sql
npm run seed
```

El seed carga el piloto real: 3 salas con su horario, 50 profesionales, la agenda de la semana,
y a propósito los **casos feos** (una sala archivada con historia, un profesional de baja con
horas facturadas, un bloque de 15', dos reservas pegadas 09-10 y 10-11).

### 4. Arrancar

```bash
npm run dev     # http://localhost:3000
```

Entrá a **`/panel/espacio-moca`** con cualquiera de los tres usuarios del seed:

| Rol | Email | Contraseña |
|---|---|---|
| Dueño (owner) | `ramirojrano@gmail.com` | `emoapp-2026` |
| Profesional (inquilino) | `maria@email.com` | `emoapp-2026` |
| Recepción | `ana@email.com` | `emoapp-2026` |

> Probá entrar como **María**: tiene que ver su propia reserva con nombre y todas las demás como
> "Ocupado", indistinguibles de un mantenimiento. Eso no es cosmético, es la regla de privacidad
> (§6.3): la agenda de un psicólogo es información de salud por contexto.

---

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | servidor de desarrollo |
| `npm run seed` | carga (o recarga) los datos del piloto |
| `npm test` | tests puros del dominio, sin base (~125, corren en segundos) |
| `npm run test:db` | tests de integración contra Postgres real (~91), incluida la concurrencia |
| `npm run typecheck` | TypeScript en modo estricto |
| `npm run verify` | typecheck + tests puros |
| `npm run humo` | prueba de humo en un browser real; deja capturas en `capturas/` |

`npm run test:db` usa **su propia base** (`TEST_DATABASE_URL`, o `DATABASE_URL` + `_test`):
borra el esquema en cada corrida, así que nunca toca tus datos de desarrollo.

---

## Cómo está organizado

```
src/dominio/     lógica PURA: no importa Prisma, no llama a new Date() sin argumento, no hace I/O.
                 Todo lo que decide algo vive acá y tiene su test al lado.
src/db/          cliente Prisma + guard de tenant + traducción de errores de Postgres.
src/servicios/   casos de uso: orquestan dominio + base. Reciben el operadorId, nunca lo adivinan.
src/lib/         sesión, permisos, plata (predicados compartidos).
app/             Next 16: páginas y server actions. Dueñas de la sesión; sin lógica de negocio.
prisma/          schema + la migración (baseline generado + invariantes escritas a mano).
```

### Tres reglas que explican casi todo el código

1. **El motor de reservas es puro y el "ahora" entra por parámetro.** Por eso se puede testear el
   cambio de horario de verano de Chile sin levantar nada.
2. **La base es la última red, no el código.** Dos `EXCLUDE USING gist` impiden que una sala tenga
   dos ocupaciones solapadas, aunque un bug futuro, una importación o un `psql` a mano lo intenten.
   Hay un test que mete un `INSERT` crudo y verifica que la base lo rechace.
3. **Lo que se muestra y lo que decide salen de la misma función.** Si la pantalla ofreciera un
   horario que el servidor después rechaza, el usuario lee eso como "está lleno".

`prisma/manual.sql` tiene las invariantes que Prisma no sabe expresar. **Nunca uses
`prisma db push`**: las borra en silencio. Para regenerar la migración tras cambiar el schema:
`bash scripts/regen-migracion.sh`.

---

## Estado

Construido y probado: motor de reservas (con tests de concurrencia reales), multi-tenant,
permisos por rol, agenda del día, alta de reservas, ABM de salas y profesionales, ledger de
plata, cupo de horas, membresías y el core del webhook de Mercado Pago.

Pendiente antes de cobrarle a un cliente: revisión de un abogado y un contador (ver
`docs/F0-modelo-de-negocio.md` §5 y la sección legal del master prompt), y las credenciales de
Mercado Pago para el cobro online.
