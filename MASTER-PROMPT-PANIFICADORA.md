# MASTER PROMPT — SaaS Panificadora (Gestión de Fábrica y Reparto)

> **Documento único de arranque.** Se le pega entero a la IA (Claude Code / Cursor) en la primera
> sesión de un repositorio vacío. Es la fuente de verdad del proyecto: gana sobre cualquier
> costumbre, tutorial, memoria de otro proyecto o sugerencia de librería.
>
> **Si algo de acá te parece mal, lo discutís antes de escribir la línea.** Una contradicción
> encontrada ahora vale más que una semana de código.

---

## §0 — DIRECTIVAS DE COMPORTAMIENTO (reglas duras)

**0.1 — Leé todo antes de codificar.** No abras el editor hasta procesar el documento entero. La
§3 explica por qué la §6 está escrita así; leerlas en desorden te hace tomar la decisión mala.

**0.2 — Paso a paso estricto.** Ejecutá el roadmap de la **§8** en orden. Al terminar cada fase,
mostrá el entregable y **esperá aprobación explícita**. No te adelantes, no "aprovechás que estás
ahí" para hacer la fase siguiente, no dejás pantallas a medias "para después".

**0.3 — Ahorro de tokens: DRY y diffs.**
- **NUNCA** vuelvas a imprimir un archivo entero si cambiaste tres líneas. Mostrá el bloque que
  cambia y marcá el resto con `// ... código existente ...`.
- Si un pedazo de UI aparece dos veces, extraelo a un componente **la segunda vez, no la tercera**.
- No repitas en la respuesta lo que ya está en el archivo. No expliques lo obvio.
- Al terminar una fase, el resumen son **5 líneas**: qué se hizo, qué archivos, qué falta, qué
  decisión necesito, cómo lo pruebo.
- Nada de preámbulos ("Excelente pregunta", "Voy a proceder a"). Empezá por el resultado.

**0.4 — Español rioplatense.** Voseo en producto, mensajes de error, comentarios y nombres del
código (`calcularConsumido`, `estaVencida`). Nada de lenguaje de consultor ("sinergia",
"robusto", "escalable"). Los mensajes de error le hablan a un panadero o a un repartidor, no a un
ingeniero: *"Ese día ya está cargado para este cliente"*, no *"Unique constraint violation"*.

**0.5 — Cero dependencias innecesarias.** Antes de instalar algo, preguntate si son 40 líneas.
- Fechas: `Intl` y `Temporal`/`Date` nativos. **No** moment, **no** dayjs, **no** date-fns.
- Estado: `useState` + server actions. **No** Redux, **no** Zustand, hasta que duela.
- Tablas: HTML + shadcn/ui. **No** ag-grid.
- Gráficos: **uno solo** (§7.4). shadcn/ui ya trae el wrapper de Recharts: no sumes Tremor encima,
  que es la misma librería envuelta de nuevo.
- Toda dependencia nueva se justifica en una línea antes de instalarla.

**0.6 — Cuándo frenar y cuándo decidir solo.**
- **Frená y preguntá** si la decisión cambia el esquema de la base, toca plata, o está en la lista
  de §11 sin responder.
- **Decidí solo** el resto: nombres, orden de campos, estructura de carpetas, qué componente
  extraer. No preguntes por cosas que podés revertir con un commit.
- Si asumís algo, escribilo arriba del entregable con la palabra **ASUMÍ**.

**0.7 — Cómo entregás cada fase.** Archivos tocados → qué probar a mano → `npm run verify` en
verde → las 5 líneas de resumen. Si algo no anda, decilo con el error pegado. **Nunca reportes
"listo" sobre algo que no corriste.**

---

## §1 — VARIABLES DEL PROYECTO

### 1.1 — Identidad y entorno

```yaml
PRODUCTO:            PanSaaS            # COMPLETAR — nombre definitivo
RAZON_SOCIAL:        # COMPLETAR
DOMINIO:             # COMPLETAR        ej: app.lapanificadora.com
EMAIL_SOPORTE:       # COMPLETAR
MONEDA_DEFAULT:      ARS
TZ_DEFAULT:          America/Argentina/Buenos_Aires
IDIOMA:              es-AR (voseo)
```

### 1.2 — Stack técnico innegociable

```yaml
FRAMEWORK:           Next.js 16 (App Router) + React 19
LENGUAJE:            TypeScript estricto (front, back y tests). Sin `any`, sin `@ts-ignore`.
BASE_DE_DATOS:       PostgreSQL (Neon) + Prisma ORM
AUTENTICACIÓN:       NextAuth v5 (Auth.js) — credenciales propias, sin proveedores externos en v1
VALIDACIÓN:          Zod (borde de TODA server action)
ESTILOS:             Tailwind CSS + shadcn/ui
GRÁFICOS:            Recharts vía el componente `chart` de shadcn/ui  (ver §7.4)
IA (Advisor):        @anthropic-ai/sdk — modelo `claude-opus-5`      (ver §6)
TESTING:             node:test (dominio + integración) + Playwright (E2E)
MAIL:                Resend
HOSTING:             Vercel (funciones en gru1; la base en la región más cercana)
```

> **Postgres es un requisito, no una preferencia.** Las invariantes de §5.6 usan `EXCLUDE USING
> gist` con `btree_gist` y triggers en plpgsql. No es reemplazable por SQLite, Mongo ni Planetscale.

### 1.3 — Datos del negocio (los completa el dueño, bloquean la Fase 5, no la Fase 1)

```yaml
PRODUCTOS:           # COMPLETAR  pan de miga blanco / integral / sin corteza, tamaños, pan rallado
                     # CERRADO: cada producto se vende en PAQUETE o como PAN ENTERO, y de la
                     #          misma masa pueden salir los dos formatos (§4/M2)
UNIDAD_DE_VENTA:     PAQUETE      # CERRADO — "pesa siempre lo mismo, es un paquete y ya"
VIDA_UTIL_DIAS:      # COMPLETAR  por producto
REPARTIDORES:        # COMPLETAR
CLIENTES_REPARTO:    # COMPLETAR
CLIENTES_MAYORISTAS: # COMPLETAR
DIAS_DE_REPARTO:     Lun a Sáb    # CONFIRMAR
TURNOS_FABRICA:      # COMPLETAR  ej: noche 22-06 amasado / mañana 06-14 corte y empaque
MODALIDAD_REPARTO:   CONSIGNACION # ver §3.2
SUELDO_REPARTIDOR:   FIJO         # CERRADO — empleado a sueldo, NO hay comisión (§11 #4)
```

---

## §2 — EL NEGOCIO EN UNA PÁGINA

### 2.1 — Qué hace la empresa

Una panificadora de **pan de miga** con dos brazos que comparten un solo stock y una sola caja:

1. **La fábrica** amasa, hornea, descorteza, rebana y empaqueta. Vende directo a **mayoristas**
   desde el mostrador.
2. **El reparto** sale a la calle todos los días con camionetas cargadas, deja mercadería en
   kioscos, rotiserías y bares, retira lo que no se vendió, cobra, y a fin de mes se le pasa a
   cada cliente la cuenta de lo que consumió.

**El sistema existe para responder tres preguntas que hoy viven en un cuaderno:** cuánto me debe
cada cliente, cuánto me cuesta cada paquete, y cuánta plata quedó.

### 2.2 — Alcance

**Adentro de v1:** login con accesos que da el dueño · planilla mensual de reparto · reparto del
día en el celular · cuenta corriente y cobranza · caja · cierre de mes · producción por tandas con
lote · insumos con stock y compras · servicios como gasto · costeo por paquete · tablero con
AI Advisor · venta mayorista con remito.

**Afuera de v1 — decilo, no lo construyas:**

| Afuera | Por qué |
|---|---|
| Factura electrónica ARCA | v2 vía proveedor externo. En v1: comprobante interno + campo para pegar el CAE + export para el contador (§10). |
| Liquidación de sueldos | Esto no es un sistema de nómina. El repartidor cobra sueldo fijo (§11 #4): entra como `Gasto(SUELDOS, COMERCIALIZACION)` y el prorrateo del §4/M4 lo toma de ahí. Sí registra **adelantos**. |
| Contabilidad por partida doble | Es un libro de cuenta corriente y caja. El contador recibe un CSV. |
| Venta al público / e-commerce | Otro producto. |
| GPS, ruteo óptimo, códigos de barra | v2. El modelo deja el campo `codigo`; la lectora no. |
| Balanza, horno o PLC conectados | Nunca en v1. Los datos los carga una persona. |

### 2.3 — Los tres usuarios y su día

- **Admin (el dueño).** A la mañana mira el tablero. A la tarde revisa las rendiciones. A fin de
  mes cierra y manda los resúmenes. Es el único que ve costos, márgenes y accesos.
- **Empleado_Fabrica.** Carga la tanda del día, dice cuánto salió y cuánta merma hubo, y anota las
  compras de insumos. No ve la deuda de los clientes ni la caja.
- **Repartidor.** Abre el celular en la calle, con una mano, bajo el sol. Ve **su** hoja de ruta y
  nada más. Carga lo que dejó, lo que se llevó y lo que cobró. A la vuelta rinde.

---

## §3 — ARQUITECTURA DE DATOS Y REGLAS DE NEGOCIO

### 3.1 — La entrega es la fila atómica

```
Entrega = (empresaId, fecha, clienteId, productoId) → { entregado, devuelto, precioUnitario, importe }
```

Todo lo demás —la planilla del mes, la deuda, el costo, el margen— **se deriva** de esta fila.
No hay una segunda tabla que "también" tenga la venta.

- **Una sola fila** por esa combinación, garantizado por un `UNIQUE` en la base (§5.6). Si el
  repartidor carga dos veces, es la misma fila actualizada, no dos ventas.
- `fecha` es un `date`, la **fecha de reparto**. El pan se entrega un día, no a una hora.
- Guarda **quién** la cargó y **desde dónde** (celular en la calle / escritorio): la diferencia
  entre lo que anotó el repartidor y lo que corrigió el admin es un dato del negocio.
- Corregir antes del cierre = editar la fila y dejar rastro en auditoría. Después del cierre =
  imposible, va nota de crédito (§3.6).

### 3.2 — Consignación: entregado − devuelto = consumido

```
consumido = entregado − devuelto          ← esto es lo que se cobra
importe   = consumido × precioUnitario    ← estampado el día de la entrega
```

En **consignación** (default del reparto) el repartidor deja 10 y se lleva 2 que no se vendieron:
el cliente debe 8. En **venta en firme** (default de mayorista) `devuelto` es siempre 0 y una
devolución posterior es una nota de crédito, no una edición.

La modalidad es un campo del **cliente**, no una configuración global: el mismo negocio tiene
kioscos en consignación y una cadena que compra en firme.

> **El error clásico:** guardar una sola columna "cantidad" ya neteada. Perdés para siempre cuánto
> volvió — y el **% de devolución** es la métrica que te dice si estás cargando de más la
> camioneta, que es la fuga de plata más grande y menos visible de un reparto de pan.

`devuelto <= entregado`, siempre, por constraint.

### 3.3 — El eje de la plata: ledger inmutable

**La plata no se actualiza: se asienta.**

- Todo cobro del repartidor, venta mayorista, cargo por entrega o ajuste es un **`Asiento`** en un
  ledger **append-only**.
- **NUNCA** un `UPDATE` a un saldo. El saldo de un cliente y la caja del día se **derivan**
  sumando asientos (`aggregate`). Si necesitás velocidad, guardá un saldo **materializado y
  recalculable**, con un test que verifique que recalcularlo desde cero da lo mismo.
- Corregir un asiento = otro asiento (`NOTA_CREDITO` / `NOTA_DEBITO` / `AJUSTE`) que **referencia
  al original**. El original no se borra nunca.
- La base lo hace cumplir con un trigger que rechaza `UPDATE` y `DELETE` sobre `Asiento` (§5.6).

### 3.4 — El precio se estampa, no se recalcula

- Un `Precio` tiene **vigencia** (`daterange`). Cambiarlo es **cerrar el vigente y abrir uno
  nuevo**. No existe el botón "editar precio".
- Al crear una entrega o una venta mayorista, el importe se **estampa**. Si mañana sube la harina y
  subís la lista, la planilla de ayer no cambia y el resumen del mes pasado no se mueve solo.
- Lo mismo con los insumos: el costo de una tanda queda estampado con el costo del insumo **de ese
  día**. El costo de la semana pasada no se altera porque hoy compraste harina más cara.
- Jerarquía al buscar el precio de una entrega, en este orden:
  1. Precio especial de **ese cliente** para ese producto, vigente ese día.
  2. Precio de lista del **canal** del cliente (REPARTO / MAYORISTA / MOSTRADOR), vigente ese día.
  3. Si no hay ninguno: **la entrega se rechaza con un error claro**. Nunca `precio = 0`. Un cero
     silencioso es plata que no se cobra y nadie se entera hasta fin de mes.

### 3.5 — Las tres leyes de conservación

Nada de pan ni de harina se pierde en el aire. Estas tres ecuaciones se verifican en el sistema, y
la interfaz muestra la diferencia **antes** de dejar cerrar.

**Ley 1 — el reparto cuadra**
```
carga_inicial + recarga = (Σ entregado − Σ devuelto_por_cliente) + vuelve_a_fabrica + roto + obsequio
```
`vuelve_a_fabrica` es todo lo que baja de la camioneta a la noche: lo que nunca se entregó más lo
que los clientes devolvieron. Cuadra **por producto**, no por total: 3 de blanco de menos y 3 de
integral de más no es cero, son dos errores.

**Ley 2 — el producto terminado cuadra**
```
stock_inicial + producido + devuelto_de_reparto = vendido + merma + stock_final
```
`producido` sale de una tanda confirmada, no de un número suelto. Cada merma lleva **motivo de una
lista cerrada** (si es texto libre no se puede graficar). El pan devuelto que se convierte en pan
rallado **no es merma**: es una conversión de un producto a otro, con su propio rendimiento.

**Ley 3 — el insumo cuadra**
```
stock_inicial + comprado = consumido_por_recetas + merma + ajustes + stock_final
```
El consumo se descuenta al **confirmar la tanda**, por receta, y se puede corregir a mano con
motivo. El inventario físico genera un ajuste con la diferencia **visible**, nunca pisada en
silencio.

### 3.6 — El mes cerrado es piedra

- **Cerrar un mes** (acción del admin) congela entregas y asientos con fecha adentro. Lo hace
  cumplir un **trigger**, no el código (§5.6).
- El resumen que se le mandó al cliente **no puede cambiar solo**. Si lo reabre en noviembre, dice
  lo mismo que en agosto. Ese es el contrato.
- **Reabrir** existe, es solo del admin, pide motivo escrito y queda en auditoría.
- El cierre es **idempotente**: apretarlo dos veces no genera dos juegos de cargos.

### 3.7 — Roles y accesos: revalidación fresca en la base

Tres roles: **`Admin`** · **`Empleado_Fabrica`** · **`Repartidor`**.

**La regla:** el rol se revalida en **cada server action** buscando fresco en la base, nunca
leyendo el rol de un JWT viejo. Si el dueño le saca el acceso a alguien a las 10:05, a las 10:06
esa persona no escribe más — sin esperar a que le venza la sesión.

```ts
// src/lib/auth/guard.ts  — TODA server action empieza acá
export async function exigir(roles: Rol[]) {
  const sesion = await auth();
  if (!sesion?.user?.id) throw new NoAutorizado("Iniciá sesión de nuevo");
  const acceso = await db.acceso.findFirst({           // lectura FRESCA, sin caché
    where: { usuarioId: sesion.user.id, activo: true },
    select: { rol: true, empresaId: true, usuarioId: true },
  });
  if (!acceso || !roles.includes(acceso.rol)) throw new NoAutorizado("No tenés permiso para esto");
  return acceso;                                        // { rol, empresaId, usuarioId }
}
```

Y tres reglas de privacidad que son de **arquitectura, no preferencia**:

1. **Un repartidor solo ve sus clientes.** El filtro va en la consulta del servidor, no en la
   pantalla. Hay un test que entra como repartidor A, pide por id una entrega del repartidor B, y
   tiene que recibir 404 — no una fila con menos campos.
2. **Los costos y los márgenes no salen del rol Admin.** Si el rol no los puede ver, **no viajan
   por la red**. Nada de mandarlos en el payload "por las dudas".
3. **Desactivar ≠ borrar.** El repartidor que se fue no entra más y sigue siendo el autor de sus
   entregas de marzo.

**Pantalla de entrada:** la home es el **login** y nada más — logo, mail, contraseña, "olvidé mi
contraseña". Sin auto-registro: al empleado lo da de alta el dueño. Hash con bcrypt/argon2, bloqueo
a los 5 intentos fallidos contado en el servidor, recupero por mail con token de un solo uso.
Después de entrar, **cada rol cae en su pantalla**: el repartidor en el reparto de hoy, el de
fábrica en la producción, el admin en el tablero.

---

## §4 — LOS 5 MÓDULOS DEL SISTEMA

### MÓDULO 1 — Reparto diario a la calle

**Planilla de ruta.** El admin arma la hoja del día: qué clientes, en qué orden (arrastrables), y
qué stock inicial sube a la camioneta por producto. La hoja del día siguiente se propone sola con
la del último mismo día de semana.

**Registro en la calle** (`/reparto`, celular, la pantalla más usada del sistema). Por cada cliente:

| Campo | Detalle |
|---|---|
| Entregado | teclado numérico grande, botones +1 / −1 |
| Devuelto | vencidos y rotos que retira. No aparece si el cliente es de venta en firme |
| Cobrado | efectivo / transferencia (con foto del comprobante) / cheque |

Arriba, siempre visible: **el saldo del cliente**, con la deuda vencida en rojo. Y lo que **suele
llevar** (promedio de las últimas 4 visitas del mismo día de semana) ya escrito como sugerencia,
que se confirma con un toque o se corrige.

**Cierre de caja diario (rendición).** Al volver a la fábrica, el sistema ya sabe la carga y las
entregas. Le pide al repartidor lo que trae de vuelta y la plata que rinde, y muestra **las dos
diferencias antes de dejar cerrar**:

- **Mercadería** (Ley 1 de §3.5), por producto.
- **Plata**: cobrado declarado vs. cobros registrados.

Si cuadra, botón verde. Si no cuadra, **el motivo es obligatorio** y queda visible para el admin.
Una rendición no se cierra descuadrada y en silencio, nunca.

**Cuenta corriente.** Lo que el cliente no paga en el momento se acumula como saldo deudor. La
ficha del cliente muestra saldo, **deuda con antigüedad** (0-30 / 31-60 / 61-90 / +90), promedio de
consumo mensual y última visita. Resumen de cuenta en PDF con logo, para mandar por mail o por
WhatsApp (botón `wa.me` con el texto ya armado).

**Bloqueo por mora:** por default **no corta automático**. Avisa en la pantalla del repartidor
("este cliente debe 45 días") y, si el admin lo activa, bloquea entregas nuevas a partir de N días.
Dejar o no dejar el pan es decisión del dueño, no del software.

**La planilla del mes** (`/planilla?mes=2026-08`) es la vista que reemplaza el cuaderno:

```
                      1   2   3   4   5   6  ...  30  31   TOTAL      $
  Kiosco El Sol      12   -  10  12   -  14  ...  12   -     286   $ ...
  Rotisería Doña Tita 8   8   8   -   8   8  ...   8   8     214   $ ...
  ─────────────────────────────────────────────────────────────────────
  TOTAL DEL DÍA      20  14  18  12   8  22  ...                 $ ...
```

- Filas = clientes, columnas = días, celda = **paquetes consumidos**.
- **Se edita en la celda**: click, escribo, Enter, guardado. Tab y flechas se mueven como en Excel.
  El que carga un mes atrasado no puede abrir un modal por celda.
- **Día sin visita ≠ día con 0 paquetes.** Se ven distinto: "no pasé" y "pasé y no llevó" son dos
  hechos distintos.
- Totales vivos por cliente, por día y del mes, en paquetes y en $ (con el precio estampado).
- Un mes cerrado se ve en gris y sin lápiz, con el cartel que explica la nota de crédito.
- **En el celular la planilla no es una grilla de 31 columnas**: es la lista de clientes con su
  total, y adentro el detalle por día.

### MÓDULO 2 — Fábrica: producción y mayoristas

**Recetas.** Por producto, con **porcentaje panadero** (harina = 100%) y el rinde esperado en
paquetes por cada 100 kg de harina. **Versionadas, nunca editadas**: cambiar una receta crea la
versión 2 y la 1 queda cerrada, para que una tanda de marzo siga explicando su costo de marzo.

**Tandas de producción (amasijos).** La unidad de producción.

1. Nueva tanda: receta + kg de harina → el sistema calcula el resto de los insumos y los muestra
   para confirmar o corregir (con motivo si difiere).
2. Al **confirmar**: descuenta insumos (Ley 3), genera el **lote**, suma stock de producto
   terminado y calcula el **rendimiento real vs. esperado**. Si el desvío pasa el 5%, avisa.
3. Estados: `borrador` (se edita) → `confirmada` (movió stock, ya no se edita; se corrige con
   ajuste).

**Merma de producción** con motivo de lista cerrada: descortezado, mal cortado, quemado, mal
fermentado, vencido, muestra. El **descortezado del pan de miga es merma esperada y grande**: se
controla contra su objetivo, no contra cero, y si se convierte en pan rallado se registra como
conversión.

**Lotes y trazabilidad.** Cada lote con fecha de elaboración y vencimiento. Pantalla: **dado un
lote, a qué clientes fue y qué día**. Es requisito bromatológico y es la única pantalla que sirve
el día que hay que retirar mercadería.

**Dos formatos de la misma masa.** De una tanda pueden salir **paquetes** y **panes enteros**, y
son dos productos distintos: cada uno con su precio, su stock y su lote. La tanda registra **lo que
realmente salió de cada formato**, no un solo número de paquetes. Para que el rendimiento siga
siendo comparable, cada producto declara **a cuántos paquetes equivale** una de sus unidades (un
paquete = 1): con un solo formato todo vale 1 y la métrica es la de siempre.

**Venta mayorista.** Mostrador rápido: cliente, productos, cantidades, contado o cuenta corriente.
Descuenta stock de producto terminado igual que una entrega, sale con **remito numerado** y con
lote, y afecta la caja general — **no** el stock del repartidor.

**Plan de producción.** Cuánto amasar mañana, sobre el promedio de consumo de los últimos N días,
más el stock actual, menos lo que vence. Empezá con promedio simple y a mano; el pronóstico fino es
otra fase.

### MÓDULO 3 — Insumos y servicios

Tres cosas distintas viven acá y **no se modelan igual**:

| Grupo | Ejemplos | Cómo se modela |
|---|---|---|
| **Materias primas** | harina, levadura, sal, agua de proceso, azúcar, grasa/margarina, leche en polvo, mejorador, conservante | Stock con unidad y lote. Se consume **por receta**. |
| **Paquetería** | bolsas, cintas, fibrones, etiquetas, cajas, bandejas | Stock. Se consume **por unidad empaquetada**, no por kg de harina. |
| **Servicios** | luz, gas, agua de red, alquiler, combustible, mantenimiento, impuestos | **NO son stock.** Son `Gasto` de período, con lectura de medidor opcional, y entran al costo por prorrateo (§4/M4). |

> El dueño los nombra a todos juntos ("harina, levadura, sal, agua, luz, gas…") y desde el negocio
> está bien: todo eso lo paga él. Pero un **"stock de electricidad" es una tabla que nunca cierra**.
> La pantalla los puede mostrar juntos en un resumen "lo que gasté este mes"; el modelo los tiene
> separados. **El agua entra dos veces y no es contradicción:** el agua de la masa es materia prima
> de la receta, el agua de red que se factura es gasto de período.

Lo que hay que poder hacer:

- **Compras**: proveedor, remito/factura, insumos, cantidad, precio unitario, IVA. Mueve stock y
  mueve plata (cuenta corriente con el proveedor).
- **Stock actual** por insumo, con mínimo y **días de cobertura** — *"harina para 3 días"* es más
  útil que *"1.240 kg"*.
- **Valorización a costo promedio ponderado móvil**:
  `costo = (stock × costo_viejo + compra × precio_nuevo) / (stock + compra)`.
  Mostrá también el **último costo**, que es el que sirve para decidir si hay que subir el precio.
- **Inventario físico**: recuento con fecha, teórico vs. contado, diferencia visible, ajuste con
  motivo.
- **Alertas**: bajo mínimo · cobertura menor a N días · precio de un insumo que subió más de X%
  desde la última compra · insumo por vencer.
- **Evolución del precio de la harina** (y de cada insumo). Es la variable que se come el margen de
  una panificadora y el dueño la mira todas las semanas.

### MÓDULO 4 — Costeo algorítmico

El sistema cruza el consumo del M3 con la producción del M2 y las ventas del M1. Método: **costeo
por absorción simple, mensual**. Que quede **una sola definición** y que todas las pantallas la usen.

**Costo directo (por unidad, desde la receta)**
```
costo_materia_prima = Σ (cantidad_insumo_por_paquete × costo_promedio_ponderado)
costo_paqueteria    = bolsa + cinta + etiqueta + (fibrón, tinta) por unidad empaquetada
COSTO_DIRECTO       = costo_materia_prima + costo_paqueteria
```
La cantidad por paquete sale de la receta **y del rendimiento real**, no del esperado: si la receta
dice que 100 kg rinden 400 paquetes pero rindieron 380, el costo real es más alto. Usá el
rendimiento real del mes.

**Costo indirecto — son dos bolsas, nunca una sola**
```
INDIRECTOS_FABRICA = mano_de_obra_fabrica + luz + gas + agua + alquiler
                   + mantenimiento y limpieza + amortización de maquinaria

INDIRECTOS_COMERCIALIZACION = combustible + mantenimiento de vehículos
                            + sueldos de reparto y administración + gastos de cobranza

COSTO_INDIRECTO_FABRICA_PAQUETE = INDIRECTOS_FABRICA / paquetes_producidos_en_el_mes
costo_comercializacion_del_canal = INDIRECTOS_COMERCIALIZACION_del_canal
                                 / paquetes_vendidos_por_ese_canal
```

> **Por qué dos bolsas.** El costo de *producir* un paquete no cambia porque el reparto gaste más
> nafta. Si las mezclás, el margen por canal miente y no vas a poder responder *"¿me conviene el
> reparto o el mayorista?"* — que es exactamente la pregunta del negocio.

**Costo total y margen**
```
COSTO_PAQUETE     = COSTO_DIRECTO + COSTO_INDIRECTO_FABRICA_PAQUETE
MARGEN_BRUTO      = precio_venta − COSTO_PAQUETE
MARGEN_NETO_CANAL = MARGEN_BRUTO − costo_comercializacion_del_canal
MARGEN_%          = MARGEN_NETO_CANAL / precio_venta

COSTO_DE_LA_MERMA = (unidades_merma + devueltas_no_recuperadas) × COSTO_PAQUETE
```

El costo de la merma va como **tarjeta propia** en el tablero: en una panificadora con reparto suele
ser la pérdida más grande y la que nadie mira.

**Pantalla de costos** (`/costos`, solo Admin y Empleado_Fabrica): composición del costo por
paquete · comparación contra el precio de cada canal · **serie histórica del costo vs. el precio de
venta** (el día que las dos líneas se tocan, el dueño lo tiene que ver antes de que pase) ·
**simulador** ("si la harina sube 20%, ¿cuánto tengo que aumentar?") · **punto de equilibrio** en
paquetes por mes.

### MÓDULO 5 — Tablero de negocio y AI Advisor (solo Admin)

**Las tarjetas**, cada una con su definición sin ambigüedad (§4/M5.1):

| Tarjeta | Qué dice exactamente |
|---|---|
| **Facturado** | Σ cargos del período (devengado). Aclarar en la tarjeta si es con o sin IVA. |
| **Cobrado** | Σ pagos recibidos en el período, sea de la deuda que sea. |
| **Caja** | ingresos − egresos, con saldo de apertura y cierre, separando efectivo / banco / cheques. |
| **Deuda en la calle** | saldo total a cobrar hoy, con su antigüedad. |
| **A cobrar del mes** | facturado del mes − cobrado imputable a ese mes. **No** es lo mismo que deuda. |
| **Deuda a proveedores** | saldo de cuentas por pagar, con vencimientos. |
| **Margen** | facturado − costo de lo vendido (M4). |
| **Devolución %** | Σ devuelto / Σ entregado. |
| **Merma %** | merma / producido. |
| **Rendimiento** | paquetes por cada 100 kg de harina. |

**Cortes obligatorios:** por canal (reparto vs. mayorista) · por repartidor · por zona · por
producto · por cliente (top 20 y **los que bajaron su consumo**).

**M5.1 — Las diez palabras que no pueden ser ambiguas.** Escribilas en un solo archivo
(`src/dominio/definiciones.ts`), con un comentario arriba de cada una, y usalas en todos lados —
el tablero, el PDF del cliente, el CSV del contador y el JSON del Advisor salen de ahí:

`producido` · `entregado` · `consumido` (= entregado − devuelto, lo que se cobra) · `facturado`
(devengado) · `cobrado` (caja del período) · `caja` (un cheque entra recién cuando se acredita) ·
`deuda` (saldo a hoy, todos los períodos) · `a_cobrar_del_mes` · `merma` (con motivo, no llegó a
ningún cliente) · `margen`.

**AI Business Advisor:** su propia sección, la §6. Es la parte más fácil de hacer mal.

---

## §5 — INVARIANTES (prohibido romper esto)

### 5.1 — Zonas horarias

- Todo timestamp se guarda en **UTC** y se formatea con `Intl.DateTimeFormat` a
  `America/Argentina/Buenos_Aires`. Nunca `new Date().toLocaleString()` sin timezone explícita.
- **El día del repartidor corta a la medianoche local, no a la UTC.** Una entrega cargada a las
  22:30 del 31 de agosto en Buenos Aires es del 31 de agosto, aunque en UTC ya sea 1 de septiembre.
  Si esto se rompe, el cierre de mes factura mal y el error aparece una vez al mes, de noche.
- `Entrega.fecha` y todo lo que se agrupa por día es `date` (día calendario local ya resuelto), no
  `timestamp`. La conversión se hace **una sola vez, en el borde**, y de ahí para adentro es un día.
- **Ninguna función de dominio llama a `new Date()`.** El "ahora" **entra por parámetro**. Así se
  puede testear el 31 de agosto, febrero y el cambio de año sin levantar nada.

### 5.2 — Plata en centavos

- Todo monto en Postgres es **`BigInt` (centavos)**. **NUNCA** `Float`, **nunca** `Decimal`, nunca
  un `number` de JS para plata.
- El redondeo se hace **una sola vez**, al estampar el importe de la entrega. De ahí en adelante se
  suman enteros. Sumar redondeos es cómo aparecen las diferencias de un peso que el cliente
  encuentra y vos no podés explicar.
- Las cantidades de paquetes son enteros; las de insumo (kg, litros) van en `numeric(12,3)`.
- Se formatea **solo al mostrar**, con `Intl.NumberFormat('es-AR', {style:'currency', currency:'ARS'})`.

### 5.3 — Validación pura

- **Zod para TODO lo que entra.** Las server actions **no confían en el frontend**: ni en los
  tipos, ni en los ids, ni en que el número sea positivo, ni en que el cliente sea del repartidor.
- Un esquema por acción, en `src/dominio/esquemas/`, reusado por el formulario y por el servidor.
- El error de Zod se traduce a un mensaje que entiende un repartidor antes de llegar a la pantalla.

### 5.4 — Idempotencia

Toda server action que mueva inventario o plata lleva una **clave de idempotencia generada en el
cliente** (UUID por operación).

- El servidor hace `INSERT ... ON CONFLICT DO UPDATE` contra la clave natural y guarda la clave de
  idempotencia para descartar el reintento repetido.
- La pantalla es **optimista** y reintenta sola. Si falla definitivo lo dice fuerte y en rojo, y el
  número queda marcado como "sin guardar".
- **Esto se construye desde la Fase 1**, aunque el modo offline sea de otra fase. Agregar
  idempotencia después de tener seis meses de datos es una pesadilla; el repartidor va a apretar
  dos veces y el colectivo le va a cortar la conexión a la mitad.

### 5.5 — Autorización server-side

- **Ninguna server action confía en la sesión sola**: `exigir([...roles])` (§3.7) es la primera
  línea de todas, sin excepción.
- El `empresaId` y el `usuarioId` **se leen del acceso**, nunca vienen del cliente. Si un
  parámetro trae un id de empresa, es un intento de ataque.
- Un repartidor solo escribe sobre clientes de su ruta: se verifica **en la consulta**, con el
  `where`, no con un `if` después de traer la fila.

### 5.6 — Las invariantes que van en Postgres, no en el código

La base es la última red. Un bug futuro, una importación de Excel o un `psql` a mano tienen que
rebotar contra la base. Esto se escribe **a mano** en la migración —Prisma no lo sabe expresar— y
**nunca uses `prisma db push`**: las borra en silencio.

```sql
-- 1) Una sola entrega por cliente/producto/día: el doble cobro se vuelve imposible.
CREATE UNIQUE INDEX entrega_unica
  ON "Entrega" ("empresaId", "fecha", "clienteId", "productoId");

-- 2) No se devuelve más de lo que se entregó, y nada es negativo.
ALTER TABLE "Entrega" ADD CONSTRAINT entrega_coherente
  CHECK (entregado >= 0 AND devuelto >= 0 AND devuelto <= entregado);

-- 3) Un solo precio vigente por (producto, canal, cliente) en cada fecha. Sin solapes.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "Precio" ADD CONSTRAINT precio_sin_solape
  EXCLUDE USING gist (
    "empresaId" WITH =,
    "productoId" WITH =,
    "canal" WITH =,
    (COALESCE("clienteId", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    "vigencia" WITH &&
  );

-- 4) El mes cerrado es piedra.
CREATE OR REPLACE FUNCTION mes_cerrado_rechaza() RETURNS trigger AS $fn$
DECLARE periodo_fila text;
BEGIN
  periodo_fila := to_char(COALESCE(NEW.fecha, OLD.fecha), 'YYYY-MM');
  IF EXISTS (
    SELECT 1 FROM "CierreMes" c
     WHERE c."empresaId" = COALESCE(NEW."empresaId", OLD."empresaId")
       AND c.periodo = periodo_fila
       AND c."reabiertoEn" IS NULL
  ) THEN
    RAISE EXCEPTION 'El período % está cerrado: usá una nota de crédito o débito', periodo_fila
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER entrega_mes_cerrado BEFORE INSERT OR UPDATE OR DELETE ON "Entrega"
  FOR EACH ROW EXECUTE FUNCTION mes_cerrado_rechaza();
CREATE TRIGGER asiento_mes_cerrado BEFORE INSERT OR UPDATE OR DELETE ON "Asiento"
  FOR EACH ROW EXECUTE FUNCTION mes_cerrado_rechaza();

-- 5) El ledger es append-only. Se corrige con otro asiento que referencia al original.
CREATE OR REPLACE FUNCTION ledger_append_only() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'El ledger es append-only: corregí con NOTA_CREDITO / NOTA_DEBITO'
    USING ERRCODE = 'check_violation';
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER asiento_inmutable BEFORE UPDATE OR DELETE ON "Asiento"
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

-- 6) Una rendición no se cierra descuadrada sin motivo escrito.
ALTER TABLE "Rendicion" ADD CONSTRAINT rendicion_cuadra
  CHECK (estado <> 'cerrada' OR diferencia = 0 OR motivo IS NOT NULL);

-- 7) El stock no queda negativo.
ALTER TABLE "Stock" ADD CONSTRAINT stock_no_negativo CHECK (cantidad >= 0);

-- 8) Una hoja de ruta por reparto y día; un cierre vigente por período.
CREATE UNIQUE INDEX hoja_unica   ON "HojaDeRuta" ("empresaId", "repartoId", "fecha");
CREATE UNIQUE INDEX cierre_unico ON "CierreMes"  ("empresaId", "periodo");
```

> **Escribí un test que meta un `INSERT` crudo salteándose la aplicación y verifique que la base lo
> rechaza.** Es el test más importante del proyecto: prueba que la red existe.

### 5.7 — Neon: dos URLs y un lock que no es el que creés

- `DATABASE_URL` = la conexión **pooled** (host con `-pooler`), para la app.
  `DIRECT_URL` = la **directa**, para las migraciones. Las dos declaradas en el `datasource` de
  Prisma. Migrar por el pooler falla de maneras raras y a destiempo.
- El pooler de Neon es **PgBouncer en modo transacción**. Consecuencia concreta: usá
  **`pg_advisory_xact_lock`** (nivel transacción), **nunca `pg_advisory_lock`** (nivel sesión), o el
  lock te queda colgado en una conexión que ya no es tuya.
- El cierre de mes y la confirmación de una tanda corren dentro de **una transacción interactiva**,
  no en tres llamadas sueltas.

---

## §6 — EL AI ADVISOR, EN SERIO

Es el módulo con más chances de quedar lindo y estar mal. Estas reglas no son opcionales.

### 6.1 — La regla madre: el modelo no calcula

**El LLM nunca hace una cuenta.** Recibe métricas **ya calculadas** por las funciones puras del
dominio (las mismas que alimentan el tablero, §4/M5.1) y su trabajo es **priorizar, explicar y
recomendar**. Todo número que aparezca en su respuesta tiene que estar **copiado textual del JSON
de entrada**.

Un advisor que suma, promedia o proyecta a ojo te va a dar un número que no coincide con el
tablero, y el día que eso pase el dueño deja de creerle al sistema entero.

### 6.2 — Arquitectura en tres capas

```
1. MÉTRICAS   src/dominio/metricas.ts   → funciones puras, testeadas. Devuelven números.
2. ALERTAS    src/dominio/alertas.ts    → reglas deterministas con umbrales. Devuelven hechos.
                                          "devolucion_alta: 15.2% vs objetivo 8%"
3. NARRATIVA  src/servicios/advisor.ts  → el LLM. Ordena por impacto, explica y sugiere.
```

Las capas 1 y 2 **funcionan sin la API prendida**. Si el Advisor se cae, se queda sin crédito o el
dueño lo apaga, el tablero sigue mostrando todo y las alertas siguen saltando. La IA agrega
criterio, no es el cableado.

### 6.3 — El JSON de entrada

Lo arma una función pura, `construirContexto(periodo, empresaId)`. Chico, agregado y estable:

```jsonc
{
  "periodo": "2026-08", "generado": "2026-08-26", "moneda": "ARS",
  "ventas":   { "facturado": 4820000, "cobrado": 3910000, "a_cobrar": 910000,
                "por_canal": { "reparto": 3120000, "mayorista": 1700000 } },
  "deuda":    { "total": 1840000, "vencida_mas_60": 420000, "clientes_en_mora": 7 },
  "caja":     { "apertura": 210000, "ingresos": 3910000, "egresos": 3480000,
                "cierre": 640000, "cheques_en_cartera": 380000 },
  "costos":   { "costo_paquete": 412, "variacion_vs_mes_anterior": 0.083,
                "insumo_que_mas_subio": { "nombre": "harina 000", "variacion": 0.19 } },
  "operacion":{ "devolucion_pct": 0.152, "merma_pct": 0.031, "rendimiento_100kg": 384 },
  "alertas":  [ { "codigo": "devolucion_alta", "valor": 0.152, "objetivo": 0.08,
                  "detalle": "Zona Sur, repartidor R-3, últimas 2 semanas" } ],
  "top_caidas": [ { "cliente": "C-118", "consumo_actual": 40, "consumo_previo": 120 } ]
}
```

**Reglas del JSON:**
- **Sin PII.** Clientes y repartidores viajan como **códigos** (`C-118`, `R-3`). Los nombres se
  vuelven a poner **en la pantalla**, cruzando el código localmente. No mandes nombres, teléfonos
  ni direcciones a un servicio externo si no hace falta — y no hace falta.
- **Chico**: agregados, no filas. Nunca 50.000 entregas.
- **Estable**: mismas claves siempre, en el mismo orden. Es lo que hace que el prompt cachee.
- Los importes van en la unidad ya formateada como número (pesos, no centavos) **y el prompt lo
  aclara**, para que el modelo no divida por 100 por su cuenta.

### 6.4 — El prompt del analista

Va en `src/servicios/advisor/prompt.ts`, como constante congelada. Va **primero** en el request y
marcado para cachear: es lo estable, el JSON es lo volátil.

```ts
export const PROMPT_ANALISTA = `
Sos el analista de negocio de una panificadora de pan de miga en Argentina, con fábrica y reparto
a la calle. Le hablás al dueño, en español rioplatense, de vos.

QUÉ RECIBÍS
Un JSON con las métricas del período, ya calculadas por el sistema. Los importes están en pesos.

REGLAS QUE NO SE ROMPEN
1. NO calcules. Todo número que escribas tiene que estar en el JSON, copiado tal cual.
2. Si un dato no está en el JSON, decí "no tengo ese dato". Jamás lo estimes.
3. Nada de proyecciones que el JSON no traiga ya calculadas.
4. Máximo 4 recomendaciones. Ordenadas por PLATA EN JUEGO, no por lo fácil que son.
5. Cada recomendación: qué pasa, cuánto cuesta o cuánto vale, y qué hacer esta semana.
6. Frases cortas. Sin "sinergia", "optimizar procesos" ni "robusto". Hablás como un contador
   que conoce el oficio, no como un consultor.
7. Si algo está bien, decilo en una línea y seguí. No inventes problemas para llenar espacio.

CONTEXTO DEL OFICIO
- La devolución alta significa que se está cargando de más la camioneta: ese pan vuelve y se
  pierde o se vende como pan rallado a una fracción del precio.
- La harina es el insumo que define el margen. Si sube, o sube el precio o se come la ganancia.
- La deuda en la calle a más de 60 días rara vez se cobra entera.
- El pan de miga tiene vencimiento corto: el stock viejo es pérdida, no inventario.
`;
```

### 6.5 — La llamada

TypeScript, SDK oficial, **salida estructurada con Zod** (que ya está en el stack) para que la
respuesta entre tipada y no haya que parsear texto:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { PROMPT_ANALISTA } from "./prompt";

const Consejo = z.object({
  resumen: z.string(),                    // dos líneas, lo primero que lee el dueño
  recomendaciones: z.array(z.object({
    titulo: z.string(),
    que_pasa: z.string(),
    plata_en_juego: z.number().nullable(), // null si el JSON no lo trae
    que_hacer: z.string(),
    urgencia: z.enum(["alta", "media", "baja"]),
  })).max(4),
  esta_bien: z.array(z.string()),          // lo que va bien, una línea cada uno
});

const anthropic = new Anthropic();         // toma ANTHROPIC_API_KEY del entorno

export async function pedirConsejo(contexto: ContextoNegocio) {
  const r = await anthropic.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(Consejo) },
    system: [{ type: "text", text: PROMPT_ANALISTA, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: JSON.stringify(contexto) }],
  });
  if (!r.parsed_output) throw new Error("El analista no devolvió un informe válido");
  return { informe: r.parsed_output, uso: r.usage };
}
```

Detalles que importan y que se olvidan:
- **`max_tokens` generoso** (16000). Quedarse corto trunca el informe a la mitad y hay que
  reintentar, que sale más caro que el margen.
- **Caché de prompt**: el `system` va marcado con `cache_control` y **no cambia entre llamadas**
  (nada de fechas ni ids adentro). Verificá que funciona mirando
  `usage.cache_read_input_tokens` — si da 0 llamada tras llamada, algo del prefijo está cambiando.
- **Errores tipados**, en cadena de más específico a más general: `RateLimitError` →
  `APIError` → conexión. Y el fallback siempre es el mismo: **mostrar las alertas deterministas**
  con un cartel que dice que el analista no está disponible.
- No uses `budget_tokens` (está removido en este modelo) ni prefill de la respuesta del asistente
  (devuelve 400).

### 6.6 — Guardarraíles

1. **El Advisor NO escribe en la base.** Nunca. No tiene tools, no tiene acciones, no cambia
   precios. Recomienda; el dueño decide y ejecuta a mano.
2. **Todo informe se guarda con su JSON de entrada.** Tabla `Informe`: período, contexto,
   respuesta, tokens, costo, modelo. Sirve para auditar ("¿de dónde sacó ese número?") y para
   comparar informes viejos.
3. **La pantalla muestra la fecha de corte** ("datos al 26/08"). Un consejo sobre datos de hace dos
   semanas es peor que ninguno.
4. **Solo Admin.** El Advisor lee toda la plata del negocio: no aparece para ningún otro rol, ni
   siquiera en gris.
5. **Botón de apagado.** Un flag por empresa. Apagado, el tablero funciona igual (§6.2).

### 6.7 — Costo y cadencia

- **No se llama en cada carga de página.** Se genera **una vez por día** (job programado) y
  **a pedido** con un botón que tiene enfriamiento de unos minutos.
- Con el JSON de §6.3 la llamada son unos pocos miles de tokens: centavos por informe. Lo que sale
  caro es llamarlo 400 veces por día porque quedó en un `useEffect`.
- **Preguntas de seguimiento**: el dueño puede repreguntar sobre el mismo contexto. Se reusa el
  mismo `system` cacheado y se agrega el turno; no se rearma el contexto.

---

## §7 — INTERFAZ

### 7.1 — Reglas generales

- **shadcn/ui + Tailwind**, sin librería de componentes encima. Los componentes se copian al repo y
  se editan: son tuyos, no una dependencia.
- **Mobile-first de verdad en el reparto**, escritorio en la fábrica y la administración. No es lo
  mismo: la planilla del mes en 390 px no es una grilla de 31 columnas (§4/M1).
- **Ninguna pantalla hace una cuenta.** Los componentes reciben números ya calculados. Un
  `.reduce()` con plata adentro de un `.tsx` es un bug esperando su turno.
- El estado que importa vive en la **URL** (mes, cliente, zona, producto): el botón "atrás"
  funciona y el link de un día se manda por WhatsApp.
- Números con `font-variant-numeric: tabular-nums`, siempre, en toda columna que se lea vertical.
- Estados vacíos que dicen qué hacer, no "no hay datos".

### 7.2 — La pantalla del repartidor

La usa una persona con una mano ocupada, bajo el sol, a veces con guantes.

- Botones de **44 px como mínimo**. Teclado numérico grande. Contraste alto: nada de gris claro
  sobre blanco.
- Tres campos por cliente y nada más: dejé / me llevé / cobré.
- **Sin señal, no se rompe**: guarda, reintenta, y un cartel dice cuántas cosas faltan subir. No
  deja cerrar la rendición hasta que suben todas.
- El saldo del cliente arriba, grande, con la deuda vencida en rojo.

### 7.3 — La planilla del mes

Le tiene que ganar al cuaderno **el primer día**. Edición en celda, Tab y flechas como en Excel,
totales vivos, guardado optimista. Si para cargar un mes atrasado hay que abrir un modal por celda,
la pantalla fracasó aunque funcione.

### 7.4 — El tablero y el "3D"

El dueño pidió gráficos modernos, fluidos, con sensación de volumen. Se hace, con una regla:

> **El 3D es piel; el dato es hueso.** La profundidad, el gradiente y la animación son para que la
> pantalla se entienda de un vistazo. **El valor nunca se lee de una dimensión en perspectiva.**

Reglas concretas:

1. **Todo gráfico tiene el número escrito.** Si para saber cuánto facturaste hay que estimar la
   altura de un prisma girado, el gráfico falló.
2. **Botón "ver como tabla"** en cada gráfico. Los mismos números, en filas. Es lo que el dueño le
   manda al contador.
3. **Nada de torta en 3D.** Una torta en perspectiva miente sobre las proporciones. Para partes de
   un total: barras apiladas u horizontales.
4. **Una sola fuente**: el gráfico, la tabla, el PDF y el JSON del Advisor llaman a la misma función
   pura de `src/dominio/metricas.ts`. Prohibido que el componente del gráfico haga su propia cuenta.
5. **Los datos se agregan en el servidor.** Al cliente le llega un JSON chico, no 50.000 filas.

**Con qué se construye.** Recharts (vía el componente `chart` de shadcn/ui) **es 2D**, y con eso
alcanza: la sensación de profundidad y fluidez sale de gradientes en las áreas, sombras suaves,
transiciones animadas al cambiar de período, y micro-interacciones en el hover. **Eso es lo que hay
que hacer primero.** Si después del tablero terminado el dueño insiste con volumen real, se agrega
**una sola** pieza 3D (barras `producto × mes × facturación`, que es el único caso con tres ejes de
verdad) con una librería cargada por `dynamic import` **solo en esa ruta**, con caída a 2D si no hay
WebGL. Nunca en el bundle general y nunca en la pantalla del repartidor.

**Qué NO va en 3D, nunca:** la evolución del costo por paquete (línea), la antigüedad de la deuda
(barras), el % de devolución (línea con su objetivo), la composición del costo (barra apilada).

---

## §8 — ROADMAP DE EJECUCIÓN

Una fase termina cuando **pasa su criterio de aceptación**, no cuando "está el código". **No
avances a la siguiente sin mi OK** (§0.2).

### FASE 1 — Modelado de datos

**Entregable, y tu primera respuesta a este prompt: EXCLUSIVAMENTE el código de `schema.prisma`.**
Sin explicaciones largas, sin pantallas, sin `package.json`.

Entidades mínimas: `Empresa` · `Usuario` · `Acceso` (rol) · `Invitacion` · `Auditoria` · `Cliente` ·
`Reparto` · `Producto` · `Precio` · `HojaDeRuta` · `Carga` · `Entrega` · `Rendicion` · `Receta` ·
`RecetaItem` · `TandaProduccion` · `TandaConsumo` · `Lote` · `MovimientoProducto` · `Insumo` ·
`Proveedor` · `Compra` · `CompraItem` · `MovimientoInsumo` · `Inventario` · `InventarioItem` ·
`Gasto` · `Asiento` · `Cobro` · `Cheque` · `MovimientoCaja` · `CierreMes` · `TandaSalida` ·
`Informe` (§6.6).

Todas con `empresaId`, `creadoEn`, `actualizadoEn`; las que deciden plata, además `creadoPor`.
Plata en `BigInt`. Cantidades de insumo en `Decimal(12,3)`.

Inmediatamente después, en el mismo turno de la fase: **`prisma/migrations/0001_invariantes/migration.sql`**
con las 8 invariantes de §5.6 escritas a mano.

**Criterio de aceptación:** el dueño mira una planilla de papel de un mes real y confirma que el
modelo la representa entera, sin "eso lo anotamos aparte".

### FASE 2 — Dominio y Zod

Validadores de entrada y **lógica de cálculo sin tocar la base**: `entregas.ts` (consumido,
importe), `precios.ts` (vigencia y jerarquía), `rendicion.ts` (Ley 1), `receta.ts` (porcentaje
panadero, rendimiento), `costos.ts` (§4/M4 completo), `planilla.ts`, `cuenta-corriente.ts`,
`definiciones.ts`, `metricas.ts`, `alertas.ts`.

**Criterio:** los tests de §9 (bloque dominio) en verde, incluido **un caso numérico de costo por
paquete escrito a mano por el dueño** que da exactamente lo mismo que el sistema.

### FASE 3 — Autenticación y roles

NextAuth v5, login, olvidé/restablecer, pantalla de **Accesos** (invitar, cambiar rol, activar,
desactivar, resetear clave), y el wrapper `exigir()` de §3.7 con la revalidación fresca.

**Criterio:** el test de aislamiento pasa —repartidor A pidiendo datos de B recibe 404— y desactivar
a alguien lo saca en la acción siguiente, sin esperar vencimiento de sesión.

### FASE 4 — El core del reparto

Clientes, productos, precios. Hoja de ruta, carga, entrega/devolución/cobro en el celular,
rendición del día, y **la planilla del mes**. Cuenta corriente y cierre de mes con PDF.

**Criterio:** se carga **un mes real completo** desde el cuaderno y los totales coinciden con lo que
el dueño cobró de verdad ese mes. Ese es el examen del proyecto entero.

### FASE 5 — Fábrica e insumos

Recetas versionadas, tandas, lotes, trazabilidad, merma, stock de producto terminado. Venta
mayorista con remito. Insumos: compras, stock, valorización, inventario físico, gastos de servicios,
alertas.

**Criterio:** las Leyes 2 y 3 de §3.5 cierran sobre una semana real de producción, y el inventario
físico explica su diferencia.

### FASE 6 — Tablero y AI Advisor

Métricas, cortes, gráficos (§7.4), y el Advisor completo de §6 con sus tres capas, su tabla de
informes y su botón de apagado.

**Criterio:** el dueño responde *"¿me conviene el reparto o el mayorista?"* mirando una sola
pantalla; y el informe del Advisor no tiene **ni un número** que no esté en el JSON de entrada.

> **El tablero crece por capas.** No esperes a la Fase 6 para mostrar números: desde la Fase 4 hay
> una versión chica con facturado, cobrado y deuda. Un dueño que no ve un número hasta la última
> fase abandona el sistema en la segunda.

---

## §9 — TESTS OBLIGATORIOS

No se pide cobertura del 90%. Se piden **estos**, y sin ellos una fase no está terminada.

**Dominio** (puros, sin base, corren en segundos)
- `consumido = entregado − devuelto`, con los bordes: devuelto = entregado, devuelto = 0.
- Precio vigente al día de la entrega, con las tres jerarquías de §3.4 y el **error** cuando no hay.
- Planilla del mes de un cliente: día sin visita ≠ día con cero; total en paquetes y en $.
- Cuadre de la rendición, por producto, con y sin diferencia.
- Rendimiento de una tanda y consumo teórico por receta con porcentaje panadero.
- Costo por paquete completo de §4/M4, contra el caso numérico del dueño.
- Meses de 28, 29, 30 y 31 días; el 31 que cierra; año nuevo.
- **La medianoche local**: entrega a las 22:30 del último día del mes cae en ese mes, no en el
  siguiente.

**Integración** (contra Postgres real, en su propia base que se borra en cada corrida)
- El `UNIQUE` de entrega: dos inserts compitiendo, uno gana, el otro recibe el error **traducido**.
- El `EXCLUDE` de precios: dos precios que se solapan, el segundo rebota.
- El trigger de mes cerrado: un `UPDATE` a una entrega de un mes cerrado rebota.
- El trigger del ledger: `UPDATE` y `DELETE` sobre `Asiento` rebotan.
- Aislamiento de empresa y de repartidor (§5.5).
- Cierre de mes apretado dos veces = un solo juego de cargos.
- Reintento con la misma clave de idempotencia = una sola entrega.

**E2E con Playwright**
- Login → planilla → cargar una celda → aparece el total.
- Reparto en celular: carga → dos entregas → rendición que cuadra → cerrada.
- Cierre de mes → PDF descargado con el mismo total que la pantalla.

**Advisor**
- Con la API mockeada: el informe se guarda con su contexto.
- Con la API caída: el tablero sigue mostrando alertas deterministas y el cartel correcto.
- **Test de fidelidad**: todo número del informe existe en el JSON de entrada.

---

## §10 — LEGAL Y FISCAL (Argentina)

**Esto no lo decide el software: lo deciden un contador y un abogado.** El software tiene que:

1. **No emitir factura fiscal en v1.** Comprobante interno no fiscal, campo para pegar el CAE del
   comprobante emitido por fuera, y **export del libro de ventas en CSV**. La facturación
   electrónica ARCA entra en v2 vía proveedor externo (TusFacturas, Facturante o similar), nunca
   contra el webservice a mano.
2. **Remito numerado** para la mercadería que sale a la calle o a un mayorista. Confirmá la forma
   exigida con el contador antes de imprimir el primero.
3. **Trazabilidad de lote**: elaboración, vencimiento y lote en el paquete y en el sistema, con la
   consulta "este lote fue a estos clientes". Requisito bromatológico y lo único que sirve el día de
   un retiro de mercadería.
4. **Documentos con vencimiento**: habilitación municipal, RNE/RNPA, libreta sanitaria de cada
   empleado, control de plagas, análisis de agua. Con su fecha y **aviso 30 días antes**. La opción
   "ignorar el vencimiento" no existe.
5. **Datos personales** (Ley 25.326): acceso por rol, cifrado en tránsito, exportación y borrado a
   pedido. Y lo de §6.3: al servicio de IA no le mandes nombres si podés mandarle códigos.
6. **Faltantes de rendición**: se informan y se discuten, **no se descuentan solos del sueldo**. El
   descuento unilateral sobre la remuneración tiene límites legales (LCT arts. 131-133). El software
   informa; la decisión y su instrumentación son del dueño con su abogado.
7. **Términos y política de privacidad** revisados antes de que entre el primer usuario que no sea
   el dueño.

Todo esto va en `docs/legal.md` con el estado de cada punto y quién lo tiene que responder. No como
comentario en el código.

---

## §11 — DECISIONES ABIERTAS

Contestá estas 12 **antes de escribir una tabla**. Cada una viene con recomendación: **si el dueño
no contesta, tomá la recomendación, dejala escrita en `docs/decisiones.md` y seguí.** Lo que no se
puede es empezar sin decidir y descubrirlo a mitad de camino.

| # | Decisión | Recomendación | Qué cambia si se decide al revés |
|---|---|---|---|
| 1 | ¿El reparto es **consignación** o venta en firme? | **Consignación**, configurable por cliente. | Si es en firme, `devuelto` desaparece de la pantalla y toda devolución es nota de crédito. Cambia la planilla, no el esquema. |
| 2 | ¿La unidad es **paquete**, plancha o kilo? | ✅ **CERRADA: paquete.** *"Pesa siempre lo mismo, no interesa: es un paquete y ya."* Cantidades enteras. | — |
| 3 | ¿Cuántos **productos** distintos tiene el reparto? | 1 o 2 → la planilla muestra uno por vez. Más de 5 → selector de producto obligatorio desde la Fase 4. | Cambia el diseño de la pantalla estrella. |
| 4 | ¿El repartidor es empleado o **revendedor** que compra y revende? | ✅ **CERRADA: empleado a sueldo.** El cliente es de la empresa; no hay liquidación por venta. | — |
| 5 | ¿Comisión sobre lo **cobrado** o sobre lo entregado? | ✅ **CERRADA: no aplica**, cobra sueldo fijo (#4). El sueldo es un gasto de período y entra al costeo por prorrateo (§4/M4). | — |
| 6 | ¿Se cobra **mensual** o hay clientes de contado diario? | **Los dos**: `modalidadDeCobro` en el cliente. La planilla es igual; cambia si genera saldo o entra a caja. | Nada si se contempla desde el día 1; caro si se agrega después. |
| 7 | ¿Corta el reparto por **deuda**? | **No automático.** Avisa siempre; el bloqueo lo activa el admin, default 60 días. | Un corte automático mal calibrado le hace perder un cliente al dueño. La decisión es humana. |
| 8 | ¿**Cheques**? | **Sí, cartera simple desde la Fase 4** (número, banco, fecha de cobro, estado). | Sin esto, la caja del tablero miente en un negocio mayorista. |
| 9 | ¿**Offline** en el celular del repartidor? | Idempotencia desde la Fase 1 (§5.4); cola persistente cuando el reparto ya esté en uso. | Nada si la idempotencia está desde el día 1. Todo si no está. |
| 10 | ¿**Multi-empresa**? | Una empresa en pantalla, **`empresaId` en el esquema desde la primera migración**. | Agregar el tenant después es una migración con plata adentro. |
| 11 | ¿El sistema toca **plata online** (link de pago, QR)? | **No en v1.** Efectivo, transferencia y cheque, registrados a mano. | Meterse con una pasarela agrega una integración crítica antes de tener el negocio modelado. |
| 12 | ¿El **Advisor** arranca en la Fase 6 o antes? | **Fase 6.** Necesita costos y ventas reales; con datos de mentira da consejos de mentira. | Adelantarlo produce una demo linda que no se puede usar. |

---

## §12 — GLOSARIO DEL OFICIO

Para que los nombres del código sean los de la panadería, no los de un ERP genérico.

**Cómo se hace el pan de miga** (el flujo que el sistema refleja):

`amasado` (harina + agua + levadura + sal + azúcar + grasa + leche en polvo + mejorador) →
`fermentación` en cámara → `horneado en molde cerrado` (por eso no tiene corteza dorada arriba) →
`enfriado` (horas, y es obligatorio: el pan caliente no se puede cortar) → `descortezado` →
`rebanado` → `empaquetado` (bolsa + cierre + etiqueta con lote, elaboración y vencimiento) →
`despacho` (camioneta de reparto o mostrador mayorista).

| Palabra | Qué es |
|---|---|
| **Tanda / amasijo / bacha** | una hornada de masa. La unidad de producción. |
| **Porcentaje panadero** | todos los ingredientes expresados como % de la harina, que es 100%. Así está escrita toda receta de panadería. |
| **Plancha / pan entero** | el pan de miga entero, sin cortar ni empaquetar. También se vende así, y es un producto distinto del paquete. |
| **Descortezado** | sacarle la corteza a la plancha. Merma grande y esperada; suele volverse pan rallado. |
| **Hoja de ruta** | la lista ordenada de clientes de un reparto en un día. |
| **Rendición** | la cuenta que hace el repartidor al volver: lo que llevó vs. lo que trae y lo que cobró. |
| **Consignación** | dejar mercadería y cobrar solo lo que se consumió, retirando el resto. |
| **Canje / devolución** | el pan que vuelve sin venderse. |
| **Merma** | lo que se perdió y no llegó a ningún cliente. Siempre con motivo. |
| **Remito** | el papel que acompaña la mercadería cuando se mueve. |

**Los números que un panadero mira**, y que el sistema le da sin que los pida:

| Número | Por qué le importa |
|---|---|
| Paquetes por cada 100 kg de harina | Es el rendimiento. Si baja, algo cambió: la harina, el corte, el horno. |
| % de descortezado | Merma grande y esperada. Se controla contra su objetivo, no contra cero. |
| % de devolución del reparto | Si sube, está cargando de más la camioneta y regalando pan. |
| Costo de la harina, semana a semana | Es la variable que se come el margen. |
| Consumo promedio por cliente | Es lo que sugiere cuánto dejarle mañana. |
| Días de cobertura de insumos | "Harina para 3 días" es lo que evita parar la producción. |

---

## §13 — ARRANQUE

**No abras el editor todavía.**

Tu primera respuesta a este documento tiene que ser, en este orden y nada más:

1. **Confirmación en 5 líneas** de que entendiste: (a) las directivas de ahorro de tokens y el
   paso a paso con aprobación de §0; (b) que la entrega es la fila atómica y que
   `consumido = entregado − devuelto`; (c) que el ledger es append-only y los saldos se derivan;
   (d) que el rol se revalida fresco en la base en cada server action; (e) que el Advisor no calcula.
2. **Las contradicciones o huecos que encontraste** en este documento, si los hay. Si no hay,
   decilo en una línea. Esta es la última oportunidad barata de encontrarlos.
3. **Las decisiones de §11 que necesitás cerradas** para escribir el esquema, con tu recomendación
   al lado. Si el dueño no está, tomá la recomendación y marcala como **ASUMÍ**.
4. **El `schema.prisma` de la FASE 1**, completo, sin explicaciones alrededor.

Después de eso frenás y esperás el OK.

> El orden importa: la planilla que no cuadra no se arregla con un tablero en 3D.
