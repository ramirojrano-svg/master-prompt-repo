# `src/dominio/motor/` — el motor puro

Núcleo del producto (§4 del master). **Módulo puro**: no importa Prisma, no llama a
`new Date()` sin argumento, no lee `process.env`, no hace fetch. Recibe una foto del estado
y devuelve decisiones. El "ahora" siempre entra por parámetro.

## Decisión de nombres (leer antes de "unificar")

El master usa `src/lib/motor/` en §4 y `src/dominio/` en §11.2 para lo mismo: la capa pura.
Regla §3.2: donde algo aparece con dos nombres, se unifica y no se dejan sinónimos.

**Unificado en `src/dominio/motor/`**: la capa pura es `src/dominio/` (§11.2, con su regla de
lint de pureza), y el motor es un subgrupo `motor/` dentro de ella. No crear `src/lib/motor/`.

## Estado (F1 · pasos 1 y 3 de §16, motor puro)

Construido y en verde:
- **Paso 1** — `intervalos.ts` + `zona.ts`, con **T-01…T-15**.
- **Paso 2** — migración de `Ocupacion` con los dos `EXCLUDE` (en `prisma/`, T-29 y compañía).
- **Paso 3** — `horarios.ts` + `disponibilidad.ts` + `limites.ts`, con **T-16…T-27**.
- **Paso 4** — el camino de escritura con locks (T-28…T-38). Piezas:
  - `motor/reserva.ts` (puro) — `evaluarReserva`: el veredicto del re-chequeo (`FUERA_DE_HORARIO`/`SLOT_OCUPADO`/`SOLAPA_INQUILINO`).
  - `src/dominio/reserva-entrada.ts` (puro) — zod + `validarVentanaReserva` (POST forjado).
  - `src/dominio/locks.ts` (puro) — `clavesDeLock`, única fábrica, ordenadas.
  - `src/db/prisma.ts` + `src/db/errores.ts` — cliente + mapeo de `23P01`.
  - `src/servicios/reservas/crear.ts` — `crearOcupacion`: locks → foto desde el `tx` → motor → escritura.
- **Paso 5** — series, cancelación, no-show, reubicación (T-39…T-50). Piezas:
  - `motor/serie.ts` (puro) — `planificarSerie`: preview materializable, cada ocurrencia desde su fecha local (DST-correcto).
  - `motor/cancelacion.ts` (puro) — `calcularCancelacion` (escalones, operador=100%, reintegro a la misma bolsa), `calcularNoShow`. Plata en BigInt.
  - `src/servicios/reservas/`: `expandir-serie.ts` (locks de todas las ocurrencias, modos parcial/todo_o_nada), `reubicar.ts` (par `reubicada` + fila nueva), `editar.ts` (solo campos no temporales), `no-show.ts` (transición de estado).

- **Paso 6** — lista de espera y cupo (T-51…T-58). Piezas:
  - `motor/zona.ts` → `periodoDeInstante`: el corte contable en la zona de la sede (T-58).
  - `src/servicios/reservas/hold.ts` + `espera.ts`: el hold es una fila REAL que ocupa
    (reusa `crearOcupacion` con `tipo='hold'`); limpieza perezosa de holds vencidos adentro
    del lock; tope de esperas que cuenta solo futuro (T-51, T-52, T-53).
  - `src/servicios/plata/cupo.ts`: el libro de MINUTOS (`BolsaAsiento`). Saldo derivado,
    otorgamiento perezoso por diferencia (idempotente), consumo en `Serializable` con retry
    `P2034`, dos bolsas (mes/pack), reintegro a la misma bolsa (T-54…T-57).

**El motor está completo.** Lo que sigue (§16 paso 7) es la primera pantalla.

Corrección al master (§4.8.3): el CHECK `ocupacion_bloqueo_no_mixto` prohibía una fila con
sala + inquilino salvo `reserva`, pero un **hold** legítimamente tiene ambos. Se amplió a
`tipo NOT IN ('reserva','hold')`: la regla "no mixto" apunta a bloqueo/mantenimiento.

El cargo del excedente, la auditoría (`Evento`) y el asiento de plata (`Asiento`) llegan con
sus módulos (F3/plata); el cupo ya está, y `calcularCancelacion` ya da los números que el
ledger asentará.

> Nombres (§3.2): el camino de escritura vive en `src/servicios/` (§11.2), no en `src/server/`.
> El guard de tenant (`$extends`) llega con la sesión en F2; hoy el `operadorId` explícito en
> cada `where` es lo que sostiene el aislamiento.

| Archivo | Responsabilidad | Invariantes (§14) |
|---|---|---|
| `tipos.ts` | tipos base + `Franja`, `HorarioSemanal`, `Ocupacion`, `PoliticaCentro`, `EntradaDisponibilidad` | 1, 2, 3 |
| `limites.ts` | constantes únicas (`DURACION_MAX_MIN`, `LOOKBACK_MIN`, `PASOS_VALIDOS`), `pasoValido` | 14, 15 |
| `intervalos.ts` | `seSolapan`, `restar`, `restarTodos`, `contiene`, `duracionMin` | 1 (única implementación del solapamiento; `contiene` la única contención con `<=`) |
| `zona.ts` | `instanteDeHoraLocal`, `rangoDiaEnZona`, `formatHora`, `fechaEnZona`, `diaSemanaDeFecha`, `sumarDiasLocal`, `esFechaCalendarioValida`, `formatIcsUtc`, `horaAMinutos`, `minutosAHora`… | 2, 3, 6 |
| `horarios.ts` | `parseHorarios`, `sanitizarHorarios`, `resumenHorarios`, `franjasDelDia`, `solapanHora`, `HORARIO_DEFAULT` | 16, 17, 18 |
| `disponibilidad.ts` | `libresDeSala`, `slotsDe`, `franjasIntervalo`, `intervaloBloqueante`, `evaluarVentana` | 7, 8, 13, 15, 16, 17, 18 |
| `reserva.ts` | `evaluarReserva` (re-chequeo puro dentro del lock) | 7, 8, 9, 10 |
| `serie.ts` | `planificarSerie` (preview de recurrencia, DST-correcto) | 2, 6, 35 |
| `cancelacion.ts` | `calcularCancelacion`, `calcularNoShow` (escalones, reintegro, BigInt) | 27, 28, 29 |
| `zona.ts` (+) | `periodoDeInstante` (corte contable en la zona del centro) | 2, 30 |

## Tests (`npm test`)

- `intervalos.test.ts` — T-01…T-06 (bordes exactos, minuto compartido, contención, resta).
- `zona.test.ts` — T-07…T-14: fecha inexistente, mes inválido, salto de primavera (corre
  hacia adelante), hora ambigua (primera ocurrencia), días de 23 h y 25 h, dos zonas AR/CL,
  ICS de una sede no-AR. Incluye la **Capa B** (comportamiento con dos zonas, §3.3).
- `horarios.test.ts` — T-16…T-19 (blob roto → default, solapes internos, tope tras validar,
  resumen agrupado).
- `disponibilidad.test.ts` — T-20…T-27 (hueco del mediodía, anclaje a la franja, piso por
  antelación, horizonte, paso 0 → default, buffer entre distintos vs mismo inquilino, buffer
  estampado).
- `limites.test.ts` — el acoplamiento invisible `LOOKBACK_MIN >= DURACION_MAX_MIN + BUFFER_MAX_MIN`.
- `guardarrailes.test.ts` — T-15 / **Capa A**: lint de fuente sobre todo `src/` (sin `America/`,
  sin offsets fijos, sin `24 * 3600`, sin `7 * 24`).
- `comparaciones-de-rango.test.ts` — §4.2: ningún `<=`/`>=` de rango fuera de `intervalos.ts`
  (solapamiento/contención) y `horarios.ts` (HH:MM).

Los dos lints de fuente miran **código, no comentarios** (borran los comentarios preservando
la cuenta de líneas): una zona de ejemplo en un docstring es legítima; un offset fijo o un
`<=` de rango en código, no.

Fechas de DST de Chile 2026 verificadas contra la base IANA en runtime, no de memoria:
salto de primavera 2026-09-06 (día de 23 h), vuelta 2026-04-04 (día de 25 h, hora ambigua
23:00-23:59).
