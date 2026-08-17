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

## Opcional: entrar con Google

Es **gratis** y la app funciona igual sin esto: si no cargás las credenciales, el botón
"Entrar con Google" no aparece y se entra con email y contraseña, como hasta ahora.

Google **no da de alta a nadie**. Solo confirma que quien entra es dueño de un email que vos ya
habilitaste desde *Profesionales → Acceso a la app*. Una cuenta de Google desconocida no entra —
si entrara, tener un Gmail sería la contraseña del centro.

1. Entrá a [console.cloud.google.com](https://console.cloud.google.com) y creá un proyecto.
2. **APIs & Services → OAuth consent screen**: tipo *External*, poné el nombre de la app y tu mail.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, tipo *Web application*.
4. En **Authorized redirect URIs** cargá una línea por dominio desde el que se vaya a entrar:

   ```
   https://<tu-dominio>.vercel.app/api/auth/callback/google
   http://localhost:3000/api/auth/callback/google
   ```

   Tiene que ser **exacta**. Es el error más común: si no coincide carácter por carácter, Google
   corta con `redirect_uri_mismatch` antes de mostrar la pantalla de cuentas.

5. Copiá el *Client ID* y el *Client secret* a las variables de Vercel:

   | Variable | Valor |
   |---|---|
   | `AUTH_GOOGLE_ID` | el Client ID (termina en `.apps.googleusercontent.com`) |
   | `AUTH_GOOGLE_SECRET` | el Client secret |

6. Volvé a desplegar. El botón aparece solo cuando las dos variables están cargadas.

> Mientras la pantalla de consentimiento esté en modo *Testing*, Google solo deja entrar a los
> emails que agregues en **Test users**. Para que entre cualquier profesional del centro hay que
> pasarla a *In production* (el botón está en esa misma pantalla; para este uso no pide revisión
> porque no se piden permisos sensibles).

## Después de subir

- Entrá a `https://<tu-dominio>.vercel.app/login`.
- Cambiá la contraseña del administrador. La del seed (`emoapp-2026`) está escrita en este
  repositorio: sirve para probar, no para producción.
- Dale acceso a cada profesional desde **Profesionales → tocá su nombre → Acceso a la app**, y
  pasale el email y la contraseña que cargaste. Si la pierde, desde ahí mismo se la restablecés.

## Si algo falla

| Síntoma | Qué pasó |
|---|---|
| El deploy falla en `esquema.mjs` | La base no responde, o `DIRECT_URL` apunta al pooler |
| Entra al login y rebota | Falta `AUTH_SECRET` o `AUTH_TRUST_HOST` |
| "Email o contraseña incorrectos" | Falta el paso 5: la base tiene tablas pero no datos |
| `Cannot find module` al compilar | Hay un lockfile suelto arriba del proyecto (lo avisa el arranque) |
| No aparece "Entrar con Google" | Faltan `AUTH_GOOGLE_ID` o `AUTH_GOOGLE_SECRET` (el botón se esconde a propósito) |
| Google dice `redirect_uri_mismatch` | La URI autorizada no coincide exacto con `https://<dominio>/api/auth/callback/google` |

Cualquiera de los cuatro lo diagnostica `npm run doctor` apuntando a la base de producción.
