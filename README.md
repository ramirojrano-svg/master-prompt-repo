# EMOAPP — gestión de alquiler de consultorios

SaaS para que un centro alquile sus consultorios a profesionales independientes: agenda que no
vende la misma sala dos veces, cuenta corriente por inquilino y liquidación mensual.

Piloto: **Espacio Montes de Oca** (1 sede, 3 consultorios, 29 profesionales, L-D 08–22).

---

## Levantarlo en tu máquina

Necesitás **Node 22+** y un **Postgres 16**. El Postgres no es opcional ni reemplazable por otra
base: el motor de reservas usa `EXCLUDE USING gist` con `btree_gist` y advisory locks, que son
los que impiden que dos profesionales reserven la misma sala a la misma hora.

### Camino rápido (un comando)

En macOS o Linux, `setup.sh` hace todo —incluido levantar el Postgres en Docker—:

```bash
git clone -b claude/saas-alquiler-consultorios-master-1fxts1 \
  https://github.com/ramirojrano-svg/master-prompt-repo.git emoapp
cd emoapp
bash scripts/setup.sh     # Postgres en Docker + .env.local + esquema + datos
npm run dev               # → http://localhost:3000/panel/espacio-moca
```

`setup.sh` es idempotente: si ya tenés un Postgres, exportá `DATABASE_URL` antes de correrlo y
lo usa en vez de levantar uno en Docker.

**En Windows** `setup.sh` no corre (es bash). Levantá el Postgres a mano —el `docker run` del
paso 1— y después, con `.env.local` ya completo (paso 2):

```powershell
npm install
npm run instalar     # esquema + datos + revisión, todo con Node
npm run dev
```

Si preferís hacerlo paso a paso, o algo falla, seguí abajo.

### Si algo no anda: `npm run doctor`

```bash
npm run doctor
```

Revisa la cadena entera —variables de entorno, conexión, esquema, constraints, datos, y que la
contraseña del dueño ABRA de verdad— y se frena en el primer eslabón roto diciendo qué comando lo
arregla. **Corrélo antes que nada si el login rechaza una contraseña que sabés que está bien.**

Si el problema es la puerta y no los datos, la reparación no borra nada:

```bash
npm run acceso
```

Crea los tres usuarios si faltan, les repone la contraseña y les devuelve su rol activo en el
centro. No toca turnos, profesionales, precios ni cuentas — para eso está `seed`, que rehace todo.

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

### 3. Instalar, aplicar el esquema y cargar datos

```bash
npm install
npm run db:esquema    # crea las tablas, los EXCLUDE y btree_gist
npm run seed          # carga el piloto (toma la conexión de .env.local)
```

`db:esquema` aplica `prisma/migrations/0001_ocupacion_exclusion/migration.sql` usando Node, sin
depender de tener `psql` instalado (en Windows no viene). Es idempotente: si el esquema ya está,
avisa y no toca nada.

Si la base quedó de una versión anterior del código, `db:esquema` te lo dice y te frena. Para
rehacerla —**se pierden los datos**, son de prueba—:

```bash
npm run db:reset && npm run seed
```

El seed carga el piloto real: 3 consultorios con su horario, los 29 profesionales del centro, la
agenda de la semana, y a propósito los **casos feos** (una sala archivada con historia, un bloque
de 15', dos reservas pegadas 09-10 y 10-11).

> **`npm run seed` REHACE los datos**: borra el centro y lo vuelve a crear. Sirve para arrancar o
> para volver al punto de partida, pero se lleva puesto lo que hayas cargado a mano.

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

> Probá entrar con el usuario del **profesional**: tiene que ver su propia reserva con nombre y
> todas las demás como "Ocupado", indistinguibles de un mantenimiento. Eso no es cosmético, es la regla de privacidad
> (§6.3): la agenda de un psicólogo es información de salud por contexto.

Las pantallas, desde la agenda:

| Pantalla | Para qué | Quién entra |
|---|---|---|
| `/panel/<slug>` | el calendario: vistas **día, semana y mes**, alta de turno, **arrastrar para mover** y detalle con **cancelar / no vino** | todos (cada uno ve lo suyo) |
| `…/salas` | alta, edición y **archivado** de consultorios | owner y gestor |
| `…/inquilinos` | alta y baja de profesionales | owner y gestor |
| `…/tarifas` | **precio de la hora** (general o por profesional) y **abonos mensuales** | solo el owner |
| `…/reportes` | facturado, cobrado, deuda y ocupación del mes | owner, gestor y soporte |
| `…/reportes/<id>` | el mes de UN profesional: horas, qué días y a qué hora, y cuánto factura | owner, gestor y soporte |

> El estado del calendario (día, vista, consultorios filtrados) vive en la URL: el botón "atrás"
> funciona, y el link de un día concreto se puede mandar por WhatsApp.

> **Los turnos se pueden repetir** (todos los días, hábiles, cada semana, todos los meses "el
> segundo viernes", o anual). No se pregunta cuántas veces: cubre toda la agenda reservable
> (poco más de un año). Al cancelar uno de una serie se elige el alcance — solo ese, ese y los
> siguientes, o todos.

> **Clickear un turno** abre su detalle (`?turno=<id>`) con lo que se le puede hacer: marcar que
> el profesional **no vino** (queda la falta, la hora NO se libera: ya pasó) o **cancelarlo**
> (libera la hora y devuelve lo facturado con una nota de crédito que apunta al cargo original —
> el cargo no se borra nunca). Un turno de un mes ya liquidado no se cancela.

> **Arrastrar un turno** lo mueve de horario y de consultorio (en la vista semana, de día). La
> duración viaja con él y el precio NO se recotiza: mover un turno no es volverlo a vender. El
> cargo de la cuenta corriente se muda con el turno, así que cruzar de mes no lo factura dos veces
> ni lo deja en el mes viejo. Si el destino está ocupado o el consultorio no abre a esa hora, el
> turno vuelve a su lugar y la grilla dice por qué. Necesita mouse: es arrastre de escritorio.

> **Los que no alquilan por hora** pagan un **abono mensual** (una membresía con 0 horas
> incluidas). El cargo de cada mes lo dispara el operador desde Precios y es idempotente: apretar
> dos veces no cobra dos veces. Y cuando por un profesional **abona otra persona**, se guarda
> quién — es un dato para facturar y cobrar: la deuda NO se muda de cuenta, sigue siendo de quien
> usó la hora.

> El precio **no se edita**: ponés uno nuevo y el anterior queda cerrado. Por eso una reserva de
> ayer sigue valiendo lo que valía aunque hoy subas la tarifa, y el resumen del mes pasado no
> cambia solo (§8.8).

---

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | servidor de desarrollo |
| `npm run seed` | carga (o **recarga**) los datos del piloto: rehace el centro entero |
| `npm run doctor` | revisa la instalación y dice qué comando arregla lo que falta |
| `npm run acceso` | repara los usuarios y su acceso al panel, sin tocar los datos |
| `npm test` | tests puros del dominio, sin base (~191, corren en segundos) |
| `npm run test:db` | tests de integración contra Postgres real (~171), incluida la concurrencia |
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
