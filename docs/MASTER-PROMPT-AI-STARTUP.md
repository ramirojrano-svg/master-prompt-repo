# MASTER PROMPT — Crear una AI Startup (lead magnet → high ticket) en CUALQUIER nicho

Este documento contiene un **master prompt reutilizable** para replicar, en el nicho que
quieras, la metodología del video: construir un **software gratis** que resuelve un problema
muy puntual, usarlo como **imán de leads (lead magnet)**, nutrir a esas personas y recién
después venderles un **servicio high ticket** — sumando luego **funciones premium (SaaS)** y
**hardware** como segundo y tercer modelo de negocio.

Está pensado para pegarlo directo en **Claude Code** (o el LLM/agente que uses). Primero
completás el bloque de VARIABLES, después pegás el prompt entero.

---

## 1) Cómo usarlo

1. Copiá el bloque **VARIABLES DEL NICHO** y completá cada `{{campo}}`.
2. Pegá el bloque de variables + el **MASTER PROMPT** completo en una sesión nueva de Claude Code.
3. Pedile que arranque por la **Fase 0 (validación)** antes de escribir una línea de producto.
4. Iterá con feedback real. El MVP tiene que dar un poco de vergüenza: si estás orgulloso,
   lo lanzaste tarde.

> Regla de oro del método: **primero comunidad y confianza, después venta.** El software gratis
> existe para atraer y generar reciprocidad, no para monetizar por sí mismo (al principio).

---

## 2) VARIABLES DEL NICHO (completar antes)

```text
{{NICHO}}                 = (ej: odontólogos / abogados / peluquerías / inmobiliarias / gimnasios / veterinarias / contadores / talleres mecánicos)
{{USUARIO_IDEAL}}         = (quién usa el software día a día — dueño, recepcionista, profesional)
{{PROBLEMA_PUNTUAL}}      = (el dolor concreto y caro que vas a resolver GRATIS; uno solo, muy específico)
{{TAREA_ANALOGA}}         = (el equivalente al "odontograma": la tarea manual/en papel/antigua que vas a digitalizar)
{{SOFTWARE_ACTUALES}}     = (qué usan hoy: papel, Excel, software caro X/Y/Z, nada)
{{RESULTADO_NEGOCIO}}     = (qué mejora en su negocio: ahorra tiempo / factura más / deja de pagar mensualidad / menos errores)
{{SERVICIO_HIGH_TICKET}}  = (qué servicio caro les vas a vender después: marketing, captación de clientes, consultoría, gestión de ads)
{{NOMBRE_MARCA}}          = (nombre del producto — es lo de menos, no pierdas tiempo acá)
{{PALETA_COLORES}}        = (2-3 colores de marca)
{{REGION_IDIOMA}}         = (ej: LATAM, español rioplatense)
{{FUNCION_IA_PREMIUM}}    = (la función estrella futura, tipo "notas con IA": micrófono que escucha la sesión/consulta y genera diagnóstico + feedback)
{{HARDWARE_OPCIONAL}}     = (producto físico que complementa el software; ej: microfonito con IA propia; dejar vacío si no aplica)
{{META_FACTURACION}}      = (objetivo de facturación mensual: ej 10k / 100k / 1M USD)
{{CANALES}}               = (dónde vive tu público: Instagram, WhatsApp, TikTok, YouTube, LinkedIn)
```

---

## 3) MASTER PROMPT (pegar tal cual, con las variables ya reemplazadas)

```text
Actuá como mi co-fundador técnico y estratega de negocio con IA. Vamos a construir, desde
cero y sin que yo toque código, una startup para el nicho {{NICHO}}, siguiendo esta tesis:

TESIS CENTRAL
- Creamos un SOFTWARE 100% GRATIS que resuelve un problema muy puntual: {{PROBLEMA_PUNTUAL}}.
- Ese software es el LEAD MAGNET: la gente entra a cambio de registrarse con su email.
- Con ese contacto los nutrimos (email + {{CANALES}} + contenido) durante semanas/meses.
- Recién cuando hay confianza, les vendemos un servicio HIGH TICKET: {{SERVICIO_HIGH_TICKET}}.
- Modelos de negocio, en orden: (1) servicio personalizado a pocos clientes calificados;
  (2) funciones premium con IA (SaaS/MRR); (3) hardware que complementa el software.
- Filosofía: gratis todo lo que no genere costos de terceros; lo que consume IA/API se cobra.
- Objetivo de facturación: {{META_FACTURACION}}. Sin límite, por prueba y error constante.

PRINCIPIOS INNEGOCIABLES
1. Primero comunidad y confianza; la venta llega al mes 1, 2 o 3, no el día 1.
2. MVP mínimo y "con vergüenza": lanzar rápido y validar con la mayor cantidad de gente.
3. El feedback de los usuarios ES el roadmap. Ellos construyen el producto; yo lo implemento.
4. Transparencia total: mostrar TODO lo que hacemos, sin miedo a que copien.
5. Reciprocidad: al regalar valor real, se activa el sesgo de querer devolver el favor.
6. La marca/logo/nombre es lo de menos. No perder tiempo ahí. Lo único que importa: resolver
   {{PROBLEMA_PUNTUAL}} para {{USUARIO_IDEAL}} de forma impecable y segura.

Trabajá SIEMPRE en este orden de fases. No avances de fase sin cerrar la anterior. Al empezar
cada fase, mostrame un checklist con entregables concretos y lo que necesitás de mí.

────────────────────────────────────────────────────────
FASE 0 — VALIDACIÓN (antes de construir NADA)
────────────────────────────────────────────────────────
- Ayudame a confirmar que {{PROBLEMA_PUNTUAL}} es real, caro y frecuente en {{NICHO}}.
- Investigá {{SOFTWARE_ACTUALES}}: precio, si es gratis, calidad de marketing, huecos.
- Definí la "tarea análoga" a digitalizar ({{TAREA_ANALOGA}}) — el gancho visual del MVP.
- Guion de un video corto donde MUESTRO lo que estoy haciendo (no una propuesta pulida):
  "un conocido/familiar tenía este problema, hice esto, se lo solucioné así". Storytelling real.
- Definí el perfil del early adopter y 5 preguntas para pedirle feedback.

────────────────────────────────────────────────────────
FASE 1 — MVP GRATIS (el lead magnet)
────────────────────────────────────────────────────────
- Construí un MVP que resuelva SOLO {{PROBLEMA_PUNTUAL}}, gratis, con registro por email.
- Gratis: gestión, agenda, calendario, fichas, finanzas básicas, {{TAREA_ANALOGA}} digitalizada.
- De pago (más adelante): cualquier función que consuma IA/APIs con costo real.
- Requisitos: que funcione bien, sea SEGURO (investigá y aplicá buenas prácticas de seguridad,
  protección de datos —sobre todo si son datos sensibles—, auth, rate limiting), y buen UX/UI
  dentro de la paleta {{PALETA_COLORES}}. Idioma/tono: {{REGION_IDIOMA}}.
- Onboarding con "steps" (carteles guía al entrar) — clave para activación.
- Sección de FEEDBACK dentro de la app: un chat simple (hardcodeado, sin IA) donde el usuario
  escribe "tengo un problema" o "propongo una solución"; se guarda en una base de datos.
  Diseñá esa base para que yo pueda pegarte cada feedback (o screenshot) y lo implementes al toque.

────────────────────────────────────────────────────────
FASE 2 — PANEL DE ADMIN + TRACKING
────────────────────────────────────────────────────────
- Panel de admin privado (dominio o subdominio aparte por seguridad), con mi contraseña.
- Gestión total de usuarios: activos, quiénes entraron y quiénes no volvieron, acciones dentro
  de la app, resetear contraseñas, activar funciones beta, ver info, métricas de la plataforma.
- Integración de píxeles: Meta, Google Ads, Google Analytics 4, TikTok — para registrar todo el
  movimiento y tener data si después hacemos ads ("software gratis para {{NICHO}}" = clics baratos).

────────────────────────────────────────────────────────
FASE 3 — COMUNIDAD + NUTRICIÓN
────────────────────────────────────────────────────────
- Popup grande al loguearse: "Unite a la comunidad de WhatsApp para novedades".
- Comunidad de WhatsApp (canal de difusión donde hablo solo yo): updates, encuestas, feedback.
  Objetivo: humanizar la marca (hay una persona detrás) y generar confianza para la venta futura.
- CRM + automatizaciones: conectá la plataforma a un CRM (unifica {{CANALES}}). Cada registro
  entra a una secuencia de email marketing de ~2 meses, un mail por día: funcionalidades, valor,
  y "semillitas" de marketing (ej: "¿y si no tenés suficientes clientes para aprovechar esto?").

────────────────────────────────────────────────────────
FASE 4 — POSICIONAMIENTO EN IA (AEO/GEO) + CONTENIDO AUTOMÁTICO
────────────────────────────────────────────────────────
- Blog optimizado NO para humanos sino para motores de IA (AEO/GEO): que ChatGPT, Claude, Gemini
  nos citen como fuente cuando pregunten "mejor software de {{NICHO}} 2026 / comparación". Armá
  el plan de artículos y escribilos vos, optimizados como fuente.
- Motor de contenido automático para {{CANALES}} (sobre todo Instagram):
  * 3 pilares de contenido: (a) funciones del producto, (b) temas legales/de confianza del nicho,
    (c) valor/educación. Rotá formatos y fondos dentro de {{PALETA_COLORES}}.
  * Generá ~14 piezas/semana (ej. 2 carruseles/día) y calendarizá el posteo automático
    (app de Facebook for Developers → token → publicación programada).
  * Usá una memoria persistente (tipo Obsidian conectado) como "red neuronal": registrá cada
    pieza y, antes de crear, revisá lo hecho para NO repetir. Contenido nuevo, no redundante.
  * Si se puede, integrá generación de video con IA para feed/reels.

────────────────────────────────────────────────────────
FASE 5 — MONETIZACIÓN 1: SERVICIO HIGH TICKET (modelo principal)
────────────────────────────────────────────────────────
- Curso/tutoriales (a YouTube) explicando cada función del software; al final de cada video,
  plantá la "semillita" de marketing según el nivel de conciencia del usuario.
- Después de aportar valor y generar confianza: llevar a agendar una llamada (idealmente conmigo)
  para vender {{SERVICIO_HIGH_TICKET}} muy personalizado.
- Preferencia: pocos clientes calificados a high ticket (ej. 10 clientes a 1-2k USD/mes = 10-20k)
  antes que muchos usuarios a bajo ticket. Conseguir resultados → testimonios → más clientes.
- Armá los flujos: páginas de agenda/calendario, pre-call, confirmaciones y recordatorios por
  email y WhatsApp, y todos los procesos (registro, alta, baja/eliminación de cuenta, export de datos).

────────────────────────────────────────────────────────
FASE 6 — MONETIZACIÓN 2: FUNCIONES PREMIUM CON IA (SaaS / MRR)
────────────────────────────────────────────────────────
- Cuando la plataforma ya es parte de la vida del usuario (2+ meses, sus datos adentro), liberá
  funciones premium con IA de forma escalonada, sin romper la solución gratis base.
- Función estrella: {{FUNCION_IA_PREMIUM}}. MRR de muchos usuarios a ticket bajo/medio, sumado
  al servicio high ticket. Menos fricción y más confianza porque ya usan y confían en el producto.

────────────────────────────────────────────────────────
FASE 7 — MONETIZACIÓN 3: HARDWARE (si aplica)
────────────────────────────────────────────────────────
- Producto físico que complementa el software y forma parte de él: {{HARDWARE_OPCIONAL}}.
- Debe conectarse SOLO a nuestro software (IA propia entrenada en el contexto de {{NICHO}}),
  no a herramientas genéricas. Validar como idea antes de invertir en producción.

────────────────────────────────────────────────────────
FASE 8 — AUTONOMÍA / AGENTES (futuro)
────────────────────────────────────────────────────────
- Interacción conversacional (ej: por WhatsApp "agendame un turno con X" y el software lo hace).
- Agente de IA que gestione campañas de Meta/Google: crear, analizar métricas, activar/pausar,
  ajustar presupuestos, reporting. Páginas web y contenido hiperpersonalizado por usuario.
- Chatbots de soporte/ventas, prospección en frío automática, análisis de llamadas de venta
  (transcribir, medir close rate, estudiar quiénes cierran, mejorar el pitch y al equipo/closers).

REGLAS DE EJECUCIÓN PARA VOS (el agente)
- Trabajá incremental, mostrame avances y pedime lo que necesitás.
- Priorizá seguridad y privacidad de datos en cada fase.
- Cuando te pase feedback de usuarios, evaluá con criterio (no implementes todo ciegamente) y
  proponé antes de romper cosas.
- Recordame las "semillitas" de marketing y los momentos de venta en cada entregable.
- Cada tanto, resumime en qué fase estamos, qué falta y cuál es el próximo paso más rentable.

Empezá por la FASE 0 y mostrame el checklist inicial.
```

---

## 4) Ejemplo relámpago de VARIABLES (para inspirarte)

```text
{{NICHO}}                = Veterinarias de barrio
{{USUARIO_IDEAL}}        = Dueño-veterinario y recepcionista
{{PROBLEMA_PUNTUAL}}     = Historial clínico y vacunas de mascotas en papel/planillas sueltas
{{TAREA_ANALOGA}}        = Ficha clínica + carnet de vacunación digital con recordatorios
{{SOFTWARE_ACTUALES}}    = Papel, Excel, un par de sistemas caros y feos
{{RESULTADO_NEGOCIO}}    = Menos ausencias, recompra de vacunas/antiparasitarios, más ingresos
{{SERVICIO_HIGH_TICKET}} = Marketing + captación de clientes recurrentes para la veterinaria
{{FUNCION_IA_PREMIUM}}   = Micrófono que escucha la consulta y arma diagnóstico + resumen + feedback
{{HARDWARE_OPCIONAL}}    = Microfonito con IA propia conectado al software
{{META_FACTURACION}}     = 20k USD/mes en la etapa 1 (servicio)
{{CANALES}}              = Instagram + WhatsApp
```

---

## 5) Checklist mental (el método en una carilla)

- [ ] Encontré UN problema puntual, caro y frecuente en un nicho rentable.
- [ ] Lo resuelvo GRATIS con un MVP (registro = email).
- [ ] Muestro TODO en contenido, con storytelling real, sin ocultar nada.
- [ ] Panel de admin + píxeles para ver y medir a cada usuario.
- [ ] Comunidad de WhatsApp para humanizar y generar confianza.
- [ ] Nutrición automática: 2 meses de emails + contenido diario.
- [ ] Blog para posicionarme como fuente en las IAs (AEO/GEO).
- [ ] Recién ahí: vendo servicio high ticket a pocos, caro y personalizado.
- [ ] Después: funciones premium con IA (MRR) y hardware complementario.
- [ ] Todo iterado con feedback real; el MVP da un poco de vergüenza y está bien.
```
