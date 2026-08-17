# Subir EMOAPP a Vercel

Cinco pasos. La parte que más se olvida es la **base de datos**: Vercel no trae una, hay que
crearla aparte y pasarle dos URLs distintas.

---

## 1. Una base de datos en la nube

Vercel corre el código, no la base. Cualquier Postgres administrado sirve — Neon, Supabase o el
propio Vercel Postgres. Al crearla te da **dos** cadenas de conexión, y las dos hacen falta:

| Variable | Cuál es | Para qué |
|---|---|---|
| `DATABASE_URL` | la del **pooler** (suele decir `pooler` o `-pooler` en el host) | las consultas de la app |
| `DIRECT_URL` | la **directa** | crear las tablas y los constraints |

No son intercambiables. El pooler trabaja en modo transacción y **rechaza el DDL**: la app anda
igual pero el esquema no se puede crear. Por eso `npm run db:esquema` usa `DIRECT_URL` si existe.

> La app necesita la extensión `btree_gist` (es la que impide dos turnos superpuestos en el mismo
> consultorio). Neon, Supabase y Vercel Postgres la traen. Si tu proveedor no la tiene, la
> instalación va a fallar en ese punto con un mensaje claro.

## 2. Generar el secreto de sesión

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Guardá el resultado: es `AUTH_SECRET`. Sin eso las cookies no se firman y la sesión se cae en el
próximo click.

## 3. Cargar las variables en Vercel

En **Settings → Environment Variables**, para *Production* y *Preview*:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | la del pooler |
| `DIRECT_URL` | la directa |
| `AUTH_SECRET` | el que generaste en el paso 2 |
| `AUTH_TRUST_HOST` | `true` |

`AUTH_TRUST_HOST` es necesario porque el dominio lo pone Vercel: sin eso Auth.js no confía en el
host que recibe y el login rebota.

**No hace falta `AUTH_URL`**: Auth.js la deduce del dominio. Ponerla a mano es la forma más común
de romper los deploys de preview, que viven en otro dominio cada vez.

## 4. Importar el repositorio

En Vercel: **Add New → Project**, elegí este repositorio y la rama. El framework lo detecta solo
(Next.js) y no hay que tocar los comandos de build.

Al desplegar corre `vercel-build`, que:

1. aplica el esquema si falta (`scripts/esquema.mjs`, que **no** pisa nada si ya está), y
2. compila la app.

Si la base no está accesible, el deploy falla ahí con el motivo — mejor que compilar bien y
descubrirlo en la primera pantalla.

## 5. Cargar los datos, una sola vez

El deploy crea las **tablas**, no los **datos**: los profesionales, los consultorios y el usuario
para entrar hay que cargarlos una vez. Desde tu máquina, apuntando a la base de producción:

```bash
DATABASE_URL="<la del pooler>" DIRECT_URL="<la directa>" npm run seed
```

Y verificás que quedó bien:

```bash
DATABASE_URL="<la del pooler>" DIRECT_URL="<la directa>" npm run doctor
```

`doctor` prueba el login con la misma función que corre la app, así que si termina en **Todo en
orden**, esas credenciales entran de verdad.

> ⚠️ `npm run seed` **borra y recrea** los usuarios y las reservas de ejemplo. Se corre UNA vez, al
> principio. Cuando ya haya turnos y cobros reales cargados, no se corre nunca más.

---

## Después de subir

- Entrá a `https://<tu-dominio>.vercel.app/login`.
- Cambiá la contraseña del administrador. La del seed (`emoapp-2026`) está escrita en este
  repositorio: sirve para probar, no para producción.

## Si algo falla

| Síntoma | Qué pasó |
|---|---|
| El deploy falla en `esquema.mjs` | La base no responde, o `DIRECT_URL` apunta al pooler |
| Entra al login y rebota | Falta `AUTH_SECRET` o `AUTH_TRUST_HOST` |
| "Email o contraseña incorrectos" | Falta el paso 5: la base tiene tablas pero no datos |
| `Cannot find module` al compilar | Hay un lockfile suelto arriba del proyecto (lo avisa el arranque) |

Cualquiera de los cuatro lo diagnostica `npm run doctor` apuntando a la base de producción.
