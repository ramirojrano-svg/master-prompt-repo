# F0 — Modelo de negocio (documento fuente de verdad)

> Fase F0 del §11. **Cero líneas de código.** Este documento cierra las decisiones de
> negocio que definen el esquema de la base y el orden del roadmap. Lo que está acá gana
> sobre cualquier costumbre o tutorial. Cambiar algo de acá después de F1 cuesta una
> migración con plata adentro.
>
> **Estado:** decisiones cerradas. Pendiente: completar los hechos de identidad/piloto
> (§4) y la validación con 3 operadores reales (§5), que son pasos humanos del dueño.

---

## 1. Decisión 0 — el fork del modelo de negocio

**ELEGIDO: A — Software para operadores (B2B multi-tenant).**

- El cliente es el dueño del centro; paga una suscripción.
- La demanda la trae el operador (ya tiene sus inquilinos el día que instala).
- La superficie pública es opcional y está apagada por default.
- En v1 el SaaS **no toca la plata**: el operador cobra, el sistema liquida.
- Riesgo regulatorio bajo: sos software, no agregador de pagos.
- Métrica que decide: horas-sala reservadas por semana.

`[x] A — software para operadores`  ·  `[ ] B — marketplace`

El directorio/marketplace se enciende después como módulo sobre datos que ya existen. El
motor de reservas (§4 del master) no cambia una línea si algún día se va a B.

---

## 2. Las 8 respuestas de negocio cerradas (el corazón de F0)

| # | Decisión | Respuesta cerrada | Impacto en el esquema |
|---|----------|-------------------|-----------------------|
| 1 | ¿Qué se vende? | **Pago por uso (hora/bloque) + membresía mensual con cupo.** Los dos cubren el 80% de los centros. Bono prepago, alquiler exclusivo y depósito en garantía → v1.5. | `Tarifa` (unidad hora/turno/día/mes) + `Membresia` con cupo. |
| 2 | ¿El SaaS procesa el pago o solo liquida? | **Solo liquida en F1-F4.** El operador cobra por fuera (efectivo/transferencia) y registra el pago a mano. Mercado Pago entra en F5. | Sin MP en F1-F4. Ledger append-only desde F1. |
| 3 | ¿Quién cobra a quién? | **El operador le factura al inquilino por el uso del espacio.** El paciente NO es cliente del centro. Cero camino de plata paciente→operador. | No hay tabla `Paciente`, no hay cobro al paciente. |
| 4 | ¿El inquilino reserva solo o el operador aprueba? | **Auto-confirmada** para todo inquilino con contrato vigente y sala habilitada. La aprobación manual queda solo para el ALTA de un profesional nuevo que llega por la superficie pública. Configurable por centro, default auto-confirmar. | Estado `solicitada` solo para altas públicas. |
| 5 | Política de cancelación | Escalones **>48h=100% · 24-48h=50% · <24h=0% · no-show=100% del cargo.** El reembolso vuelve como **crédito en cuenta corriente** (cero costo financiero, cero contracargos). Si la sala se re-alquila en el mismo bloque, la penalidad se revierte automática (default ON). | Reglas de reintegro al ledger, a la misma bolsa/período. |
| 6 | ¿Un inquilino puede tener 2 salas a la misma hora? | **Por default NO** (`bloqueaProfesional=true`, constraint duro). Excepción real (odontólogo con asistente): **flag por inquilino**, que es quien sabe si trabaja con equipo. | Columna `bloqueaProfesional` en `Ocupacion`, estampada al crear. |
| 7 | Precio del SaaS al operador | **Por sala habilitada / mes**, lista anclada en USD y cobrada en ARS. Escalones del §9.3: Solo (gratis, 1 sala/3 inq.), Centro (≤4 salas, USD 29), Centro+ (≤10, USD 59), Red (11+, USD 5/sala). | No requiere procesar plata del operador→inquilino. |
| 8 | ¿1 sede o N sedes desde el día 1? | **Infraestructura multi-sede desde F1**, aunque se venda a centros de una sola sede. `Sede.zonaHoraria` y `sedeId` presentes desde la primera migración. Con una sola sede, la palabra "sede" no aparece en ninguna pantalla. | `sedeId` en todo; agregarlo después es caro e irreversible sin migración. |

---

## 3. Decisiones abiertas de §12 — todas ACEPTADAS (recomendación del master)

| # | Decisión | Resolución (ACEPTO) |
|---|----------|---------------------|
| 1 | ¿SaaS procesa o solo liquida? | Solo liquida F1-F4. MP en F5. |
| 2 | Pricing al operador | Por sala/mes (escalones §9.3). |
| 3 | ¿Login de inquilino en F1? | No. El operador carga todo. Portal = F2. |
| 4 | Postgres | **Supabase**, Data API DESACTIVADA, acceso por Prisma con tenant guard. Postgres 16 en Docker para tests de concurrencia. |
| 5 | ¿Sobre-reservar sala? | **Prohibido, sin excepción.** Si aparece "box compartido", se modela como capacidad explícita de la sala, no como bypass del lock. |
| 6 | Zona horaria multi-país | **Infraestructura de zona desde F1** (`formatHora(instante, tz)` con `tz` requerido, seed LATAM), aunque se venda solo en AR. |
| 7 | ¿Reserva auto-confirma? | Auto-confirmada con contrato vigente + sala habilitada; aprobación solo para alta pública. Configurable, default auto. |
| 8 | ¿Corte por deuda automático? | **No cortar automático en v1.** Avisar + bloquear reservas NUEVAS desde N días de mora (default 10, configurable). Las agendadas se respetan siempre. |
| 9 | Superficie pública `/c/[slug]` | **v2, apagada por default.** Igual se construye el slug con historial + 308 desde el día 1 (cambiarlo después es migración con impersonation). |
| 10 | Cerradura inteligente | **No en v1.** Instrucciones de acceso + código por sala con rotación asistida + check-in manual, con interfaz `AccesoProvider` ya definida para v2. |
| 11 | WhatsApp | v1 = email + buzón in-app + botón `wa.me` manual con texto armado. Arrancar trámite de Cloud API el día 1 (es camino crítico y tarda). |
| 12 | ¿Inquilinos ven quién ocupa otras salas? | **No, ni como opción.** Es dato de salud por contexto. Se responde "ocupado" y listo. |
| 13 | ¿Quién cobra la plata del inquilino? | **La cuenta de Mercado Pago del OPERADOR** (OAuth/Connect), sin excepción. Cobrar vos = agregador de pagos. |
| 14 | Free tier | **Permanente**, 1 sala + 3 inquilinos, sin cobros online ni WhatsApp. El momento de pago es la segunda sala. |
| 15 | Precio en pesos | Lista en USD, cobro en ARS congelado 90 días desde el alta, recálculo mensual con redondeo a $500, aviso de 30 días. **Sin plan anual en pesos.** |
| 16 | ¿Los 4 modelos en v1? | No. v1 = pago por uso + membresía con cupo. Bono/exclusividad/depósito → v1.5. |
| 17 | ¿Penalidad devuelta si se re-alquila? | **Sí, automático, default ON.** |
| 18 | Factura electrónica ARCA | **Nunca en v1.** Comprobante interno no fiscal + export libro de ventas + campo para pegar el CAE externo. Proveedor externo (TusFacturas/Facturante) en v2, opt-in por operador. |
| 19 | ¿El centro cobra al paciente? | **Solo al inquilino en v1.** Si se abre, detrás de flag con advertencia + anexo contractual. |
| 20 | ¿El operador ve el nombre del paciente? | **No.** Regla de arquitectura (cifrado + gate server-side + test), no preferencia configurable. |
| 21 | ¿Dónde se aloja la base? | **São Paulo (`sa-east-1`).** Decidido antes de la primera migración. |
| 22 | ¿Matrícula/seguro vencidos bloquean? | Default **avisar**, bloqueo activable por el operador. La opción "ignorar" está **prohibida**. |
| 23 | ¿Generador de contratos? | **Sí**, una plantilla por país revisada por abogado local (país sin revisión = sin plantilla). Texto congelado con hash al aceptar. "Subí tu propio contrato" destacado en el onboarding. |
| 24 | ¿Verificar matrículas contra registros? | **No en v1.** Solo carga de número, entidad, vencimiento y adjunto. Dicho con todas las letras en los Términos. |
| 25 | Buffer de limpieza | **15' default, configurable por sala**, 0 entre bloques consecutivos del mismo inquilino, **no se le cobra** al inquilino (costo operativo del centro). |
| 26 | Feriados | **Por default NO cierran.** El sistema sugiere el bloqueo con un cartel que el operador confirma. *Sub-decisión diferida a su fase:* si además existe una "tarifa feriado" (recargo %). |
| 27 | Eje profesional | Default **no** dos salas a la misma hora (`bloqueaProfesional=true`); excepción por **flag por inquilino**. |
| 28 | Ventana de anticipación máxima | **60 días** portal del inquilino, **400 días** operador y membresías. |
| 29 | Escalones de reembolso | >48h 100% · 24-48h 50% · <24h 0% · no-show 100%. Reembolso como **crédito en cuenta corriente**. |
| 30 | Hold de lista de espera | TTL **15'**, el hold **no consume cupo** de la membresía hasta confirmar. *Sub-decisión diferida a su fase (F6+):* canal de notificación (condiciona si el TTL de 15' es realista o sube a 60'). |

---

## 4. Variables de §1

### Cerradas (defaults del master aceptados)
```yaml
IDIOMA:              es-AR (voseo)
PAIS_INICIAL:        AR            # asumido (AR-first). Cambialo si el piloto es en otro país.
MONEDA_V1:           ARS
TZ_DEFAULT_ALTA:     America/Argentina/Buenos_Aires   # derivada del país, NUNCA default de esquema
MODELOS_V1:          PAGO_POR_USO + MEMBRESIA_CON_CUPO
PASO_GRILLA_MIN:     30
BUFFER_LIMPIEZA_MIN: 15
ANTELACION_MIN_MIN:  120
HORIZONTE_PORTAL_D:  60
ESCALONES_CANCEL:    ">48h=100% | 24-48h=50% | <24h=0% | no_show=100%"
UNIDAD_PRECIO:       POR_SALA_HABILITADA
PLAN_FREE:           1 sala / 3 inquilinos, permanente
PRECIO_USD_SALA:     5 a 15 según escalón (Solo 0 · Centro 29 · Centro+ 59 · Red 5/sala)
PASARELA:            MERCADO_PAGO (recién en F5)
REGION_DB:           sa-east-1 (São Paulo)
REGION_FUNCIONES:    gru1
PROVEEDOR_DB:        SUPABASE (Data API desactivada)
PROVEEDOR_MAIL:      RESEND
REPO:                ramirojrano-svg/master-prompt-repo
```

### Completado por el dueño (2026-08-13)
```yaml
PRODUCTO:            EMOAPP
DOMINIO:             app.espaciomoca.com
EMAIL_SOPORTE:       espaciomontesdeoca@gmail.com
RAZON_SOCIAL:        Espacio Montes de Oca S.R.L.
TIPO_CENTRO:         MIXTO
ESPECIALIDADES:      Odontología general, Psicología, Kinesiología, Médico PAMI, Pediatría,
                     Cosmiatría, Estética, Urología, Dermatología, Psiquiatría, Neumonología,
                     Alergia, Perito, otros
SEDES_PILOTO:        1
SALAS_PILOTO:        3
INQUILINOS_PILOTO:   50
HORARIO_TIPICO:      Lun a Vie 08:00–22:00
TARIFA_HORA_REF:     8000 ARS
MERCADOS_SIGUIENTES: (sin definir aún — AR primero)
CLIENTE_CERO_PAGA:   SÍ — Espacio MOCA S.R.L. (paga desde el mes 1)
```

**Piloto = un solo centro (Espacio MOCA), con estos usuarios en distintos roles:**
```yaml
# El "operador" (tenant) es Espacio Montes de Oca S.R.L. Los tres son USUARIOS de ese centro:
USUARIO_1 (owner):            Ramiro Raño — ramirojrano@gmail.com   # admin del centro
USUARIO_2 (inquilino_titular): Dra. María Gómez — maria@email.com   # profesional que alquila
USUARIO_3 (recepcion):        Ana Torres — ana@email.com           # mostrador
```

> **Nota sobre el criterio de aceptación (§5):** el piloto ya tiene **un centro real
> comprometido y pagando** (Espacio MOCA), lo que cubre el filtro "intención con costo". El
> filtro de "3 operadores reales que validen las 8 decisiones" (para solapamiento de requisitos
> entre centros distintos) sigue siendo recomendación abierta: se valida con Espacio MOCA en
> producción y, si querés medir generalidad, con 2 centros más antes de escalar.

---

## 5. Criterio de aceptación de F0 (§10) — paso humano del dueño

F0 no está terminado hasta que **3 operadores reales** (que hoy alquilen consultorios y hoy
cobren por eso) validen las 8 respuestas de §2 en una llamada de 45 min con pantalla
compartida. Uno chico (2-3 salas), uno mediano (6-10), uno con más de una sede.

Los tres filtros de "no escribas código todavía":
1. **Dolor medible:** los 3 nombran una pérdida cuantificable (horas de administración/mes o
   plata no cobrada por olvido).
2. **Solapamiento de requisitos:** las 8 decisiones tienen la misma respuesta en al menos 2
   de los 3.
3. **Intención con costo:** al menos 1 acepta ser cliente cero pagando desde el mes 1 y firma
   un compromiso por escrito.

Prototipo antes de F1 (2 días): un HTML estático con la grilla de un día y su semana real
cargada a mano. Pregunta única: "¿esto reemplaza tu Excel?".

---

## 6. Qué viene después (no se toca hasta aprobar F0)

Orden de construcción del §11, sin adelantar fases:
`F1` grilla que no vende dos veces la misma sala → `F2` portal del inquilino →
`F3` liquidación mensual → `F4` membresías con horas → `F5` cobro con Mercado Pago →
`F6` superficie pública → `F7` multi-sede + LATAM + ICS → `F8` ocupación y margen.

Antes de F1, el orden interno del motor (§4.16 del master) es innegociable:
`motor/intervalos.ts` + `motor/zona.ts` con sus tests **primero**, antes de la primera pantalla.
