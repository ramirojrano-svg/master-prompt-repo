# `src/dominio/motor/` — el motor puro

Núcleo del producto (§4 del master). **Módulo puro**: no importa Prisma, no llama a
`new Date()` sin argumento, no lee `process.env`, no hace fetch. Recibe una foto del estado
y devuelve decisiones. El "ahora" siempre entra por parámetro.

## Decisión de nombres (leer antes de "unificar")

El master usa `src/lib/motor/` en §4 y `src/dominio/` en §11.2 para lo mismo: la capa pura.
Regla §3.2: donde algo aparece con dos nombres, se unifica y no se dejan sinónimos.

**Unificado en `src/dominio/motor/`**: la capa pura es `src/dominio/` (§11.2, con su regla de
lint de pureza), y el motor es un subgrupo `motor/` dentro de ella. No crear `src/lib/motor/`.

## Estado (F1 · paso 1 de §16)

Construido y en verde: `intervalos.ts` + `zona.ts`, con **T-01…T-15**. Nada más se escribe
antes de esto. Lo que sigue (paso 2): la migración de `Ocupacion` con los dos `EXCLUDE`.

| Archivo | Responsabilidad | Invariantes (§14) |
|---|---|---|
| `tipos.ts` | `Instante`, `FechaLocal`, `HoraPared`, `Tz`, `Intervalo` | 1, 2, 3 |
| `intervalos.ts` | `seSolapan`, `restar`, `restarTodos`, `duracionMin` | 1 (única implementación del solapamiento) |
| `zona.ts` | `instanteDeHoraLocal`, `rangoDiaEnZona`, `partesEnZona`, `offsetMinutos`, `formatHora`, `fechaEnZona`, `diaSemanaDeFecha`, `esFechaCalendarioValida`, `formatIcsUtc`, `horaAMinutos`, `minutosAHora` | 2, 3, 6 |

## Tests (`npm test`)

- `intervalos.test.ts` — T-01…T-06 (bordes exactos, minuto compartido, contención, resta).
- `zona.test.ts` — T-07…T-14: fecha inexistente, mes inválido, salto de primavera (corre
  hacia adelante), hora ambigua (primera ocurrencia), días de 23 h y 25 h, dos zonas AR/CL,
  ICS de una sede no-AR. Incluye la **Capa B** (comportamiento con dos zonas, §3.3).
- `guardarrailes.test.ts` — T-15 / **Capa A**: lint de fuente sobre todo `src/` (sin `America/`,
  sin offsets fijos, sin `24 * 3600`, sin `7 * 24`). Excluye los `*.test.ts`, que usan zonas
  como dato.

Fechas de DST de Chile 2026 verificadas contra la base IANA en runtime, no de memoria:
salto de primavera 2026-09-06 (día de 23 h), vuelta 2026-04-04 (día de 25 h, hora ambigua
23:00-23:59).

## Pendiente para el paso 3 (`disponibilidad.ts`)

El lint de "comparaciones de rango sueltas" (§4.2) se agrega junto con `disponibilidad.ts`,
con un helper `contiene()` para que `slotsDe` no use `<=` crudo. Se documenta acá para no
olvidarlo: hoy no aplica porque `intervalos.ts` es el único que compara rangos.
