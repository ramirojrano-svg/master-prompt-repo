# MASTER PROMPT — PANIFICADORA (fábrica + reparto)

> **Qué es este documento.** Es el prompt maestro de un producto nuevo: un SaaS de gestión para
> una panificadora de **pan de miga** que tiene dos brazos —una **fábrica** que produce y vende a
> mayoristas, y un **reparto a la calle** que atiende clientes con planilla mensual—.
>
> **Cómo se usa.** Pegá este documento entero como primer mensaje de una sesión nueva de Claude
> Code, sobre un repositorio vacío (o una rama nueva). No lo resumas ni lo recortes: cada regla de
> acá está para evitar una decisión mala que después cuesta una migración con plata adentro.
>
> **Quién gana.** Lo que dice este documento gana sobre cualquier costumbre, tutorial, memoria de
> otro proyecto o sugerencia de librería. Si algo acá te parece equivocado, **decilo antes de
> escribir código**, no lo cambies por tu cuenta.
>
> **Hermano mayor.** Este producto se construye con las mismas convenciones que EMOAPP (el SaaS de
> alquiler de consultorios del mismo dueño): mismo stack, mismo español en el código, misma manera
> de separar dominio puro / servicios / pantallas. Repo, base de datos y despliegue son **propios y
> separados**: no comparten ni una tabla.

---

## §0 — Las cinco reglas que explican todo lo demás

1. **La fila atómica es la entrega.** Un cliente, un producto, un día, una fila. Todo lo demás
   —la planilla del mes, la deuda, la comisión del repartidor, el margen del negocio— se deriva
   de esa fila. No hay una segunda tabla que "también" tenga la venta.
2. **Nada de pan se pierde en el aire.** Lo que sube a la camioneta tiene que cerrar contra lo que
   se entregó, lo que volvió y lo que se rompió. Lo que salió del horno tiene que cerrar contra lo
   que se vendió, lo que volvió y lo que quedó en cámara. Son leyes de conservación (§5), y se
   verifican en la base, no en el buen criterio del que carga.
3. **El precio viaja con la entrega.** El importe se estampa el día que se entrega. Si mañana sube
   la lista, la planilla de ayer no cambia. Los precios no se editan: se cierra el vigente y se
   abre uno nuevo.
4. **El mes cerrado es piedra.** Después del cierre, ninguna entrega ni ningún movimiento de ese
   mes se toca. La corrección existe, pero es una nota de crédito o débito con fecha de hoy, que
   apunta al original. El original nunca se borra.
5. **Lo que se muestra y lo que decide salen de la misma función.** El número del tablero, el del
   resumen que se le manda al cliente y el del PDF tienen que venir de la misma función pura. Si
   la pantalla dice 148 paquetes y el resumen dice 147, el cliente deja de creerle al sistema —y
   tiene razón—.

---

## §1 — Decisión 0: ¿para quién es este software?

Antes de cualquier tabla, cerrá este fork. Cambia el esquema, no la pantalla.

**RECOMENDADO: A — herramienta de una panificadora, con esquema listo para ser producto.**

- El cliente es **la panificadora del dueño** (cliente cero). Se construye para su operación real,
  con sus productos, sus clientes y sus precios.
- Pero **cada tabla lleva `empresaId` desde la primera migración**, y ninguna pantalla dice la
  palabra "empresa" mientras haya una sola. Agregar el `empresaId` después es una migración cara e
  irreversible; tenerlo y no usarlo no cuesta nada.
- Si algún día se le vende a otra panificadora, se enciende el alta de empresas y no se toca una
  línea del motor.

`[x] A — herramienta interna con esquema multi-empresa`  ·  `[ ] B — SaaS vendido a panificadoras desde el día 1`

> Si el dueño elige **B**, agregá al roadmap: alta autogestionada de empresa, planes y cobro de la
> suscripción, y aislamiento de tenant probado con un test que intenta leer datos de otra empresa y
> tiene que fallar. Nada de eso cambia el motor.

---

## §2 — Variables del proyecto

Estas son las perillas. Los valores marcados `# default` los podés tomar como están; los marcados
`# COMPLETAR` los tiene que responder el dueño antes de F1. Copiá este bloque a
`docs/F0-modelo-de-negocio.md` con las respuestas puestas: ese archivo es la fuente de verdad
del negocio, este prompt es la del software.

```yaml
PRODUCTO:              # COMPLETAR  nombre de la app (ej: MIGAPP)
RAZON_SOCIAL:          # COMPLETAR
DOMINIO:               # COMPLETAR  ej: app.lapanificadora.com
EMAIL_SOPORTE:         # COMPLETAR
IDIOMA:                es-AR (voseo)                          # default
PAIS:                  AR                                     # default
MONEDA:                ARS                                    # default
TZ:                    America/Argentina/Buenos_Aires         # default

# --- Operación ---
SUCURSALES:            1                                      # default (esquema soporta N)
CAMIONETAS:            # COMPLETAR  cuántas salen por día
REPARTIDORES:          # COMPLETAR
CLIENTES_REPARTO:      # COMPLETAR  cuántos clientes tiene el reparto hoy
CLIENTES_MAYORISTAS:   # COMPLETAR
DIAS_DE_REPARTO:       Lun a Sab                              # default — CONFIRMAR
TURNOS_FABRICA:        # COMPLETAR  ej: noche 22-06 amasado, mañana 06-14 corte y empaque

# --- Producto ---
PRODUCTOS_V1:          # COMPLETAR  lista real: pan de miga blanco, integral, sin corteza,
                       #            planchas, tamaños, pan lactal, pan rallado (subproducto)
UNIDAD_DE_VENTA:       PAQUETE                                # default — CONFIRMAR (paquete/plancha/kg/bandeja)
VIDA_UTIL_DIAS:        # COMPLETAR  días de vencimiento por producto
MODALIDAD_REPARTO:     CONSIGNACION                           # default — ver §5.2
MODALIDAD_MAYORISTA:   VENTA_EN_FIRME                         # default

# --- Plata ---
CANALES_DE_PRECIO:     REPARTO | MAYORISTA | MOSTRADOR        # default
CICLO_DE_COBRO:        MENSUAL (cierre el último día del mes) # default — CONFIRMAR
COMISION_REPARTIDOR:   10% sobre lo COBRADO                   # default — CONFIRMAR (§8.6)
MEDIOS_DE_PAGO:        efectivo | transferencia | cheque      # default
FACTURACION_FISCAL:    NO en v1 (comprobante interno + export contable, §13)  # default

# --- Técnico ---
STACK:                 Next.js 16 + TypeScript estricto + Prisma + Postgres 16
PROVEEDOR_DB:          Supabase (Data API DESACTIVADA)        # default
REGION_DB:             sa-east-1 (São Paulo)                  # default
REGION_FUNCIONES:      gru1                                   # default
PROVEEDOR_MAIL:        Resend                                 # default
HOSTING:               Vercel                                 # default
REPO:                  # COMPLETAR
```

> **Los `# COMPLETAR` son bloqueantes de F1, no de F0.** Podés cerrar las decisiones de negocio y
> dejar el modelo de datos escrito sin saber cuántos clientes hay. No podés cargar el seed sin eso.

---

## §3 — El producto en una frase, y dónde termina

**En una frase:** el sistema donde la panificadora anota qué produjo, con qué insumos, qué le dejó
a cada cliente cada día, cuánto le tiene que cobrar a fin de mes, y cuánta plata quedó.

### Adentro de v1

- Login propio, con el administrador decidiendo quién entra y con qué permisos.
- **Planilla mensual de reparto**: clientes en las filas, días del mes en las columnas, paquetes en
  las celdas, total y $ a fin de mes.
- **Reparto del día en el celular**: hoja de ruta, carga de la camioneta, entrega y devolución por
  cliente, cobranza en la calle, rendición al volver.
- **Cuenta corriente por cliente**: cargos, pagos, saldo, antigüedad de la deuda.
- **Fabricación**: recetas, amasadas, lotes, rendimiento, merma, stock de producto terminado.
- **Insumos**: compras, stock, valorización, consumo por receta, inventario físico, alertas.
- **Servicios** (luz, gas, agua) como gasto de período —no como stock, §7.7—.
- **Costos**: costo por paquete, margen por producto, por canal y por cliente.
- **Negocio**: tablero con facturado, cobrado, caja, deuda, a cobrar, margen; con los gráficos en
  3D que pidió el dueño y la regla que los hace legibles (§10).
- **Mayoristas**: venta desde la fábrica, con remito y cuenta corriente igual que el reparto.

### Afuera de v1 (decilo, no lo construyas)

| Afuera | Por qué |
|---|---|
| Facturación electrónica ARCA | Se resuelve con un proveedor externo en v2 (§13). En v1: comprobante interno no fiscal + export para el contador + campo para pegar el CAE. |
| Liquidación de sueldos | Esto no es un sistema de nómina. Sí liquida **comisiones y adelantos** de reparto, y los exporta para el estudio contable. |
| Contabilidad por partida doble | Es un libro de cuenta corriente y caja, no un plan de cuentas. El contador recibe un CSV. |
| Tienda online / venta al público | Otro producto. |
| GPS y optimización de recorrido | v2. El orden de la hoja de ruta lo fija el humano, arrastrando. |
| Códigos de barra y WMS | v2. El modelo de datos queda preparado (`codigo` en producto y lote), la lectora no. |
| Balanza / PLC / horno conectado | Nunca en v1. Los datos los carga una persona. |

---

## §4 — Quién entra y qué ve

El administrador es el único que da y saca accesos. **No hay auto-registro**: nadie se crea una
cuenta solo. El admin invita por mail, elige el rol, y puede desactivar a alguien sin borrarle la
historia (un repartidor que se va no borra sus entregas de marzo).

| Rol | Entra a | Nunca ve |
|---|---|---|
| **admin** (dueño) | todo, incluidos costos, márgenes, sueldos de reparto y accesos | — |
| **encargado** (jefe de fábrica) | fabricación, insumos, compras, stock, costos de producción | la deuda de los clientes, la caja, el margen del negocio (configurable) |
| **repartidor** | **solo su hoja de ruta y sus clientes**: carga, entrega, devolución, cobranza, su rendición y su comisión | los clientes de otro repartidor, los precios de otro canal, cualquier número global del negocio, los costos |
| **administracion** | clientes, planilla, cuenta corriente, cobranza, caja, cierre de mes | costos y recetas (configurable) |
| **soporte** (opcional) | lectura de todo, sin poder escribir | — |

### §4.1 — Reglas de privacidad que son de arquitectura, no preferencias

1. **Un repartidor solo ve los clientes de su reparto.** El filtro va en el servidor, en la consulta,
   no en la pantalla. Hay un test que entra como repartidor A y pide una entrega del repartidor B
   por su id: tiene que devolver 404, no una fila con menos campos.
2. **Los costos y los márgenes no salen del rol admin/encargado.** Nunca los mandes al cliente en
   un payload "por las dudas": si el rol no los puede ver, no viajan por la red.
3. **El precio de un cliente no se le muestra a otro cliente ni a otro repartidor.** La lista de
   precios es información comercial: dos clientes de la misma cuadra pueden tener precios distintos
   y enterarse es un problema del dueño, no un detalle.
4. **Desactivar ≠ borrar.** Un usuario desactivado no entra más y sigue apareciendo como autor de
   lo que cargó. Borrar de verdad es una acción del admin, con confirmación escrita, y solo si esa
   persona no dejó movimientos de plata.

### §4.2 — Pantalla de entrada

La pantalla de inicio es el **login**, y nada más: logo, mail, contraseña, "olvidé mi contraseña".
Sin carrusel, sin explicación del producto, sin link a registrarse.

- Contraseñas con hash (bcrypt/argon2), nunca en texto plano, nunca en un log.
- Bloqueo por intentos: 5 fallidos → 15 minutos de espera para ese mail. Contado en el servidor.
- Sesión con expiración; "cerrar sesión en todos los dispositivos" en el perfil.
- Recuperación por mail con token de un solo uso, vencimiento de 30 minutos.
- Después del login, **cada rol cae en su pantalla**: el repartidor en el reparto de hoy, el
  encargado en fabricación, el admin en el tablero. Nadie tiene que aprender a navegar hasta lo
  suyo.

---

## §5 — El motor: la unidad de verdad y las tres leyes de conservación

Esta sección es el corazón. Escribila **primero, en dominio puro y con sus tests**, antes de la
primera pantalla. Si el motor está bien, el resto es formulario; si está mal, no hay interfaz que
lo salve.

### §5.1 — La entrega es la fila atómica

```
Entrega = (empresaId, fecha, clienteId, productoId) → { entregado, devuelto, precioUnitario, importe }
```

- **Una sola fila** por esa combinación. Si el repartidor carga dos veces, es la misma fila
  actualizada, no dos ventas. Esto es un `UNIQUE` en la base, no una validación en el formulario.
- Corregir una entrega **antes del cierre** es editar la fila y dejar rastro en auditoría (quién,
  cuándo, de qué valor a qué valor). Corregirla **después del cierre** es imposible: va nota de
  crédito o débito (§5.7).
- `fecha` es la **fecha de reparto** (un `date`, no un timestamp). El pan se entrega un día, no a
  una hora. Todo lo que se agrupa por mes agrupa por esta fecha.
- La entrega guarda **quién** la cargó y **desde dónde** (celular en la calle / escritorio), porque
  la diferencia entre lo que anotó el repartidor y lo que corrigió administración es un dato del
  negocio.

### §5.2 — Consignación: entregado − devuelto = consumido

El dueño lo dijo con la palabra exacta: la planilla dice cuántos paquetes el cliente **consumió**.
Eso no es lo mismo que lo que se le dejó.

```
consumido = entregado − devuelto          ← esto es lo que se cobra
importe   = consumido × precioUnitario     ← estampado el día de la entrega
```

- En **consignación** (default del reparto), el repartidor deja 10 y se lleva 2 que no se
  vendieron: el cliente debe 8. La devolución vuelve a la fábrica y entra en la ley 2 (§5.4).
- En **venta en firme** (default de mayorista), `devuelto` siempre es 0 y lo entregado es lo
  cobrado. Una devolución posterior es una **nota de crédito**, no una edición de la entrega.
- La modalidad es un campo del **cliente**, no una configuración global: la misma panificadora
  puede tener kioscos en consignación y una cadena que compra en firme.
- `devuelto` nunca puede ser mayor que `entregado` (constraint duro). Si el cliente devuelve pan de
  ayer, eso es una devolución de **la entrega de ayer** o una nota de crédito, no un número negativo
  en la de hoy.

> **Ojo con esto, es el error clásico:** si modelás una sola columna "cantidad" ya neteada, perdés
> para siempre el dato de cuánto se devolvió. Y el porcentaje de devolución es *la* métrica que te
> dice si estás cargando de más la camioneta —que es plata tirada, porque el pan que vuelve se
> vende como pan rallado o se pierde—.

### §5.3 — Ley 1: el reparto cuadra

```
carga_inicial + recarga = (Σ entregado − Σ devuelto_por_cliente) + vuelve_a_fabrica + roto + obsequio
```

Donde `vuelve_a_fabrica` es **todo lo que baja de la camioneta a la noche**: lo que nunca se
entregó más lo que los clientes devolvieron. Por eso las devoluciones de cliente se restan de un
lado y están adentro del otro: son el mismo pan, contado una sola vez.

Dicho en criollo: cada paquete que subió a la camioneta a la mañana tiene que estar, a la noche, en
un cliente, de vuelta en la fábrica, o en la lista de rotos con su motivo. No hay cuarta opción.

- La **rendición del día** (por repartidor y fecha) calcula esa diferencia y la muestra en la
  pantalla del repartidor **antes** de que cierre.
- Una rendición **no se cierra con diferencia ≠ 0** salvo que se escriba un motivo. El motivo queda
  guardado, es visible para el admin, y es el insumo de una métrica: "diferencias por repartidor,
  últimos 90 días".
- La rendición cuadra **por producto**, no por total: 3 paquetes de blanco de menos y 3 de integral
  de más no es cero, son dos errores.
- La misma rendición cuadra la **plata**: cobrado en efectivo declarado vs. cobros registrados.

### §5.4 — Ley 2: el producto terminado cuadra

```
stock_inicial + producido + devuelto_de_reparto = vendido + merma + stock_final
```

- `producido` sale de una **amasada confirmada** (§7.6), no de que alguien escriba un número suelto.
- `vendido` es Σ consumido de reparto + Σ mayorista + mostrador.
- `merma` de producto terminado es: vencido, roto, mal cortado, muestra. **Cada merma lleva motivo**,
  y el motivo es una lista cerrada, no texto libre —si es texto libre no se puede graficar—.
- El pan devuelto que se transforma en **pan rallado** no es merma: es una **conversión** de un
  producto a otro, con su propio rendimiento. Modelalo así desde el día 1 si el dueño lo hace; si
  no lo hace, dejá el tipo de movimiento definido y sin uso.
- El stock de producto terminado se lleva **por lote**, con su fecha de elaboración y vencimiento.

### §5.5 — Ley 3: el insumo cuadra

```
stock_inicial + comprado = consumido_por_recetas + merma + ajustes + stock_final
```

- El consumo se descuenta **al confirmar la amasada**, por receta, y se puede corregir a mano con
  motivo (el panadero tiró 2 kg de masa; pasa).
- El **inventario físico** (recuento) genera un ajuste con su diferencia visible. La diferencia
  entre teórico y contado es una métrica, no un dato que se pisa en silencio.
- Los **servicios** (luz, gas, agua) **no son stock**: son gasto de período (§7.7). No inventes un
  "stock de electricidad".

### §5.6 — Idempotencia: escribir dos veces no cobra dos veces

El repartidor carga desde el celular, en la calle, con señal mala. Va a apretar dos veces. El colectivo
va a cortar la conexión a la mitad.

- Cada escritura de entrega lleva una **clave de idempotencia generada en el cliente** (UUID por
  operación). El servidor hace `INSERT ... ON CONFLICT DO UPDATE` contra la clave natural, y guarda
  la clave de idempotencia para descartar el reintento repetido.
- La pantalla es **optimista**: muestra el número cargado y reintenta sola. Si falla definitivo,
  lo dice fuerte y en rojo, y el número queda marcado como "sin guardar".
- **Esto se construye desde F1 aunque el modo offline sea F5.** El día que se agregue la cola
  offline, no hace falta migrar nada. Al revés, agregar idempotencia después de tener seis meses
  de datos es una pesadilla.

### §5.7 — El mes cerrado es piedra

- **Cerrar un mes** (acción del admin) congela todas las entregas, cargos y pagos con fecha adentro
  de ese mes. La base lo hace cumplir con un trigger, no el código.
- Después del cierre, el resumen que se le manda al cliente **no puede cambiar solo**. Ese es el
  contrato: si el cliente vuelve a abrir el PDF en noviembre, dice lo mismo que en agosto.
- Corregir algo de un mes cerrado = **nota de crédito o débito** con fecha de hoy que referencia el
  cargo original. El original queda.
- **Reabrir un mes** existe, es solo del admin, pide motivo escrito y queda en auditoría. (En EMOAPP
  esto ya se construyó: "botón para deshacer el cierre de un mes, solo para el administrador".)
- El cierre es **idempotente**: apretarlo dos veces no genera dos juegos de cargos.

---

## §6 — Modelo de datos

Nombres en español, como el resto del código. Todo lleva `empresaId`. Todo lleva `creadoEn`,
`actualizadoEn`, y las tablas que deciden plata llevan además `creadoPor`.

### §6.1 — Las tablas

**Identidad y acceso**
- `Empresa` — tenant. `nombre`, `razonSocial`, `cuit`, `zonaHoraria`, `logo`.
- `Sucursal` — fábrica y/o depósito. Desde F1 aunque haya una sola.
- `Usuario` — `email` único, `hashClave`, `nombre`, `activo`.
- `Acceso` — `usuarioId` × `empresaId` × `rol` × `activo`. El rol vive acá, no en el usuario: la
  misma persona puede ser repartidor en una empresa y admin en otra.
- `Invitacion` — token, mail, rol propuesto, vencimiento, quién invitó.
- `Auditoria` — append-only: quién, cuándo, qué tabla, qué fila, valor anterior → valor nuevo.

**Comercial**
- `Cliente` — `nombre`, `nombreFantasia`, `direccion`, `zona`, `telefono`, `cuit`, `condicionIva`,
  `modalidad` (CONSIGNACION | FIRME), `canal` (REPARTO | MAYORISTA | MOSTRADOR), `repartidorId`,
  `ordenEnRuta`, `diasDeVisita`, `limiteCredito`, `activo`, `notas`.
- `Repartidor` — es un `Usuario` con rol repartidor + `Reparto` (la ruta). Un repartidor tiene una
  ruta; una ruta tiene N clientes ordenados.
- `Reparto` (ruta) — `nombre` ("Zona Sur"), `usuarioId`, `vehiculo`, `activo`.
- `Producto` — `nombre`, `codigo`, `tipo` (TERMINADO | SUBPRODUCTO), `unidadDeVenta`,
  `pesoUnitarioG`, `vidaUtilDias`, `activo`.
- `Precio` — `productoId`, `canal`, `clienteId` (NULL = precio de lista del canal), `importe`,
  `vigencia` (`daterange`). **Sin solapamiento** (§6.2). Nunca se edita: se cierra y se abre otro.

**Reparto**
- `HojaDeRuta` — `repartoId`, `fecha`, `estado` (planificada | en_calle | cerrada), `usuarioId`.
- `Carga` — `hojaDeRutaId`, `productoId`, `cantidad`, `momento` (inicial | recarga).
- `Entrega` — la fila atómica del §5.1. `hojaDeRutaId`, `clienteId`, `productoId`, `fecha`,
  `entregado`, `devuelto`, `precioUnitario`, `importe`, `claveIdempotencia`, `origen`.
- `Rendicion` — `repartoId`, `fecha`, por producto: cargado, entregado, devuelto por clientes,
  devuelto a fábrica, roto; y la plata: cobrado declarado vs. registrado. `diferencia`, `motivo`,
  `estado`.

**Fabricación**
- `Receta` — `productoId`, `version`, `rindeEsperado`, `activa`. **Versionada, nunca editada.**
- `RecetaItem` — `insumoId`, `cantidad`, `porcentajePanadero`.
- `Amasada` (producción) — `fecha`, `turno`, `recetaId`+`version`, `kgHarina`, `responsableId`,
  `estado` (borrador | confirmada), `loteId`.
- `AmasadaConsumo` — insumo, cantidad teórica, cantidad real, motivo del desvío.
- `Lote` — `codigo`, `fechaElaboracion`, `fechaVencimiento`, `productoId`, `cantidadProducida`.
- `MovimientoProducto` — append-only: producción, venta, devolución, merma, conversión, ajuste.

**Insumos y compras**
- `Insumo` — `nombre`, `tipo` (MATERIA_PRIMA | PAQUETERIA | LIMPIEZA | MANTENIMIENTO),
  `unidad` (kg | l | un | m), `stockMinimo`, `activo`.
- `Proveedor` — `nombre`, `cuit`, `contacto`, `condicionesDePago`.
- `Compra` / `CompraItem` — remito/factura, fecha, proveedor, insumo, cantidad, precio unitario,
  IVA, total. **Toda compra mueve stock y mueve plata.**
- `MovimientoInsumo` — append-only: compra, consumo, merma, ajuste por inventario, devolución.
- `Inventario` / `InventarioItem` — recuento físico con fecha, contado vs. teórico, diferencia.
- `Gasto` — servicios y gastos de período: `tipo` (LUZ | GAS | AGUA | ALQUILER | COMBUSTIBLE |
  MANTENIMIENTO | IMPUESTOS | SUELDOS | OTRO), `periodo`, `importe`, `medidorAnterior`,
  `medidorActual`, `comprobante`.

**Plata**
- `Movimiento` — el ledger de cuenta corriente, **append-only**: `clienteId`, `tipo` (CARGO |
  PAGO | NOTA_CREDITO | NOTA_DEBITO | AJUSTE), `fecha`, `importe`, `periodo`, `referencia`
  (entregaId / cobroId / movimientoId original), `detalle`.
- `Cobro` — `clienteId`, `fecha`, `medio` (EFECTIVO | TRANSFERENCIA | CHEQUE), `importe`,
  `recibidoPor`, `chequeId`.
- `Cheque` — `numero`, `banco`, `fechaCobro`, `importe`, `estado` (en_cartera | depositado |
  acreditado | rechazado).
- `MovimientoCaja` — ingresos y egresos de caja/banco con su origen.
- `CierreMes` — `periodo`, `cerradoEn`, `cerradoPor`, `reabiertoEn`, `motivoReapertura`.
- `Liquidacion` — la comisión del repartidor del mes: base, porcentaje, adelantos, neto, estado.

### §6.2 — Las invariantes que van en Postgres, no en el código

La base es la última red. Un bug futuro, una importación de Excel o un `psql` a mano tienen que
rebotar contra la base. Escribí esto a mano en la migración (Prisma no lo sabe expresar) y **nunca
uses `prisma db push`**: te las borra en silencio.

```sql
-- 1) Una sola entrega por cliente/producto/día. El doble cobro se vuelve imposible.
CREATE UNIQUE INDEX entrega_unica
  ON "Entrega" ("empresaId", "fecha", "clienteId", "productoId");

-- 2) No se devuelve más de lo que se entregó, y nada es negativo.
ALTER TABLE "Entrega" ADD CONSTRAINT entrega_coherente
  CHECK (entregado >= 0 AND devuelto >= 0 AND devuelto <= entregado);

-- 3) Un solo precio vigente por (producto, canal, cliente) en cada fecha. Sin solapes, sin huecos
--    silenciosos. Es el mismo mecanismo que impide vender dos veces la misma sala en EMOAPP.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "Precio" ADD CONSTRAINT precio_sin_solape
  EXCLUDE USING gist (
    "empresaId" WITH =,
    "productoId" WITH =,
    "canal" WITH =,
    (COALESCE("clienteId", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    "vigencia" WITH &&
  );

-- 4) El mes cerrado es piedra: ninguna escritura con fecha adentro de un período cerrado.
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
CREATE TRIGGER movimiento_mes_cerrado BEFORE INSERT OR UPDATE OR DELETE ON "Movimiento"
  FOR EACH ROW EXECUTE FUNCTION mes_cerrado_rechaza();

-- 5) El ledger no se edita ni se borra. Se corrige con otro movimiento que lo referencia.
CREATE OR REPLACE FUNCTION ledger_append_only() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'El ledger es append-only: corregí con NOTA_CREDITO / NOTA_DEBITO'
    USING ERRCODE = 'check_violation';
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER movimiento_inmutable BEFORE UPDATE OR DELETE ON "Movimiento"
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

-- 6) Una rendición no se cierra descuadrada sin motivo escrito.
ALTER TABLE "Rendicion" ADD CONSTRAINT rendicion_cuadra
  CHECK (estado <> 'cerrada' OR diferencia = 0 OR motivo IS NOT NULL);

-- 7) El stock no queda negativo.
ALTER TABLE "Stock" ADD CONSTRAINT stock_no_negativo CHECK (cantidad >= 0);

-- 8) Una hoja de ruta por reparto y día.
CREATE UNIQUE INDEX hoja_unica ON "HojaDeRuta" ("empresaId", "repartoId", "fecha");

-- 9) Un cierre vigente por período.
CREATE UNIQUE INDEX cierre_unico ON "CierreMes" ("empresaId", "periodo");
```

> **Escribí un test que meta un `INSERT` crudo saltándose la aplicación y verifique que la base lo
> rechaza.** Es el test más importante del proyecto: prueba que la red existe.

### §6.3 — Plata: enteros, no decimales

Guardá todo importe en **centavos, como entero** (`BigInt`/`bigint`). Nunca `float`. Las cantidades
de paquetes son enteros; las cantidades de insumo (kg, litros) van en `numeric(12,3)`.

El redondeo se hace **una sola vez, al estampar el importe de la entrega**, y de ahí en adelante se
suman enteros. Sumar redondeos es cómo aparecen las diferencias de un peso que el cliente encuentra
y vos no podés explicar.

---

## §7 — Las pantallas, una por una

Ruta base: `/panel/<slug-empresa>/...`. El estado que importa vive en la URL (mes, cliente, zona,
producto), para que el botón "atrás" funcione y un link se pueda mandar por WhatsApp.

### §7.1 — Login, olvidé, restablecer

Ya descrito en §4.2. Tres pantallas chicas, sin menú, sin barra lateral.

### §7.2 — Accesos — *"el dueño decide quién entra"*

`…/accesos` — solo admin.

- Tabla de personas: nombre, mail, rol, último ingreso, estado.
- **Invitar**: mail + rol → se manda un link de alta con vencimiento. Mientras no lo usa, figura
  "invitado, pendiente".
- **Cambiar rol** sin recrear la persona. Queda en auditoría.
- **Activar / desactivar** con un interruptor. Desactivar cierra sus sesiones abiertas.
- **Restablecer contraseña** (le manda el mail; el admin nunca ve ni elige la contraseña de otro).
- Buscador, porque a los 40 empleados la lista no se lee.

### §7.3 — Planilla del mes — **la pantalla estrella**

`…/planilla?mes=2026-08&reparto=<id>` — admin, administración y (solo la suya) el repartidor.

Es la planilla de papel que hoy vive en un cuaderno, y tiene que ganarle al cuaderno el primer día.

```
                     1   2   3   4   5   6   7  ...  30  31   TOTAL     $
  Kiosco El Sol      12   -  10  12   -  14  10  ...  12   -    286   $ ...
  Rotisería Doña Tita 8   8   8   -   8   8   8  ...   8   8    214   $ ...
  Bar La Esquina      -   6   -   6   -   6   -  ...   6   -     84   $ ...
  ──────────────────────────────────────────────────────────────────────
  TOTAL DEL DÍA      20  14  18  18   8  28  18  ...                $ ...
```

- **Filas = clientes** (de un reparto, o de todos si es el admin). **Columnas = días del mes.**
  **Celda = paquetes consumidos** (§5.2: entregado − devuelto).
- Si hay más de un producto, hay un **selector de producto** arriba, y una vista "todos los
  productos" que muestra el total en paquetes equivalentes **y aclara que está sumando peras con
  manzanas**. La celda con varios productos se abre en un detalle.
- **Se edita en la celda**: click, escribo, Enter, y ya está guardado (optimista, §5.6). Tab y las
  flechas se mueven como en una planilla de cálculo. El que carga el mes atrasado no puede estar
  abriendo un modal por celda.
- Los **días sin visita** se ven distintos de los días con 0 paquetes. "No pasé" y "pasé y no
  llevó" son dos hechos distintos y el dueño los quiere distinguir.
- **Totales vivos**: por cliente (paquetes y $), por día, y del mes. El total en $ usa el precio
  estampado en cada entrega, no el precio de hoy.
- **Cerrar el mes** desde acá, con el resumen de lo que se va a congelar y cuánto se va a facturar.
- **Exportar a CSV y a PDF**, con el mismo número que muestra la pantalla.
- Un mes cerrado se ve **en gris y sin lápiz**, con un cartel que explica que se corrige con nota
  de crédito.
- **En el celular** la planilla no es una grilla de 31 columnas: es la lista de clientes con su
  total del mes, y adentro el detalle por día. No intentes meter la tabla entera en 390 px.

### §7.4 — Reparto de hoy — la pantalla del celular

`…/reparto?fecha=2026-08-26` — el repartidor entra acá directo al loguearse.

Está pensada para una mano, con la otra sosteniendo una caja, bajo el sol, con guantes.

1. **Carga**: qué sube a la camioneta, por producto. Un teclado numérico grande. Se puede sumar una
   **recarga** al mediodía.
2. **Hoja de ruta**: los clientes en orden, arrastrables. Cada uno muestra lo que **suele llevar**
   (promedio de las últimas 4 visitas del mismo día de semana) como sugerencia ya escrita, que se
   confirma con un toque o se corrige.
3. **En el cliente**: dejé ___ / me llevé ___ / cobré $___. Tres campos, botones de +1 y −1, nada
   más. Si el cliente es de venta en firme, el campo "me llevé" no aparece.
4. **Botones grandes** (mínimo 44 px), números en tipografía tabular, contraste alto. Nada de
   celeste sobre blanco.
5. **Cobranza en la calle**: efectivo / transferencia (con foto del comprobante) / cheque. El saldo
   del cliente se ve arriba, en grande, con la deuda vencida en rojo.
6. **Al volver: la rendición** (§5.3). El sistema ya sabe la carga y las entregas: le pide al
   repartidor lo que trae de vuelta y la plata, y muestra la diferencia **antes** de cerrar. Si
   cuadra, un botón verde. Si no, el motivo es obligatorio.
7. **Sin señal**: la pantalla no se rompe. Guarda lo cargado y reintenta. Un cartel dice cuántas
   cosas faltan subir, y no deja cerrar la rendición hasta que suben todas.

### §7.5 — Clientes y cuenta corriente

`…/clientes` y `…/clientes/<id>`

- Alta con: nombre, fantasía, dirección, zona, teléfono, CUIT y condición de IVA, reparto asignado,
  días de visita, modalidad (consignación/firme), límite de crédito, notas.
- La ficha del cliente muestra, arriba: **saldo, deuda vencida, promedio de consumo mensual, última
  visita**. Abajo: la cuenta corriente completa (cargos, pagos, notas), su planilla del mes, y su
  historial de precios.
- **Deuda con antigüedad**: 0-30 / 31-60 / 61-90 / +90 días. Es la tabla que decide a quién se le
  deja de dejar mercadería.
- **Bloqueo por mora**: por default **no corta automático**. Avisa en la pantalla del repartidor
  ("este cliente debe 45 días") y, si el admin lo activa, bloquea entregas nuevas a partir de N días
  (default 60). La decisión de dejar o no dejar el pan es del dueño, no del software.
- **Resumen de cuenta** en PDF, con logo, para mandar por mail o WhatsApp (botón `wa.me` con el
  texto ya armado).
- Baja = desactivar. La historia queda.

### §7.6 — Fabricación

`…/fabricacion`

- **Recetas** (`…/fabricacion/recetas`): por producto, con **porcentaje panadero** (harina = 100%)
  y el rinde esperado en paquetes por cada 100 kg de harina. **Versionadas**: cambiar una receta
  crea la versión 2 y la 1 queda cerrada, para que una amasada de marzo siga explicando su costo de
  marzo.
- **Amasadas** (`…/fabricacion/amasadas`): la producción del día.
  - Nueva amasada: receta + kg de harina → el sistema calcula el resto de los insumos y los muestra
    para confirmar o corregir (con motivo si difiere).
  - Al **confirmar**: descuenta insumos, genera el **lote**, suma stock de producto terminado y
    calcula el **rendimiento real vs. esperado**. Si el desvío supera el 5%, avisa.
  - Estados: borrador (se edita) → confirmada (mueve stock, ya no se edita; se corrige con ajuste).
- **Rendimiento**: kg de harina → paquetes. Es el número que le dice al panadero si algo cambió
  (harina distinta, horno mal calibrado, corte grueso).
- **Merma de producción**, por motivo cerrado: descortezado, mal cortado, quemado, mal fermentado,
  vencido, muestra. El **descortezado del pan de miga es una merma esperada y grande**; se controla
  contra su propio objetivo, no contra cero, y si se transforma en pan rallado se registra como
  conversión (§5.4), no como pérdida.
- **Lotes y trazabilidad** (`…/fabricacion/lotes`): dado un lote, **a qué clientes fue** y en qué
  fecha. Es un requisito bromatológico y es la pantalla que se usa el día que hay que retirar
  mercadería. Que exista desde temprano no es opcional en una fábrica de alimentos.
- **Plan de producción**: cuánto hay que amasar mañana, calculado sobre el consumo promedio de los
  últimos N días por producto, más el stock actual, menos lo que vence. Empezá simple —promedio y
  a mano—; el pronóstico fino es una fase posterior.

### §7.7 — Insumos

`…/insumos`

Tres cosas distintas viven acá, y **no se modelan igual**:

| Grupo | Ejemplos | Cómo se modela |
|---|---|---|
| **Materia prima** | harina, levadura, sal, azúcar, grasa/margarina, leche en polvo, mejorador, conservante, agua de proceso | Stock con unidad y lote. Se consume por receta. |
| **Paquetería** | bolsas, bobinas de film, etiquetas, tinta de fechadora, broches/precintos, cajas, bandejas | Stock. Se consume **por unidad empaquetada**, no por kg de harina. |
| **Servicios y gastos** | electricidad, gas, agua de red, alquiler, combustible, mantenimiento, ABL/impuestos | **NO son stock.** Son `Gasto` de período, con lectura de medidor opcional, y entran al costo por prorrateo (§9). |

> El dueño los nombró todos juntos en la misma frase ("harina, levadura, sal, agua, electricidad,
> gas…") y es correcto desde el negocio: todo eso lo paga él. Pero un "stock de electricidad" es
> una tabla que nunca cierra. La pantalla los puede mostrar juntos en un resumen "lo que gasté este
> mes"; el modelo los tiene separados.

Lo que hay que poder hacer:

- **Compras**: proveedor, remito/factura, insumos, cantidad, precio unitario, IVA. Mueve stock y
  mueve plata (cuenta corriente con el proveedor).
- **Stock actual** por insumo, con mínimo y **días de cobertura** ("harina para 3 días" es más útil
  que "1.240 kg").
- **Valorización a costo promedio ponderado móvil.** Al comprar: `costo = (stock×costo_viejo +
  compra×precio_nuevo) / (stock + compra)`. Mostrá también el **último costo**, que es el que sirve
  para decidir si hay que subir el precio de venta.
- **Inventario físico**: recuento con fecha, teórico vs. contado, diferencia visible, ajuste con
  motivo.
- **Alertas**: bajo mínimo, cobertura menor a N días, precio de un insumo que subió más de X% desde
  la última compra, insumo por vencer.
- **Evolución del precio de la harina** (y de cada insumo) en un gráfico: es la variable que se
  come el margen de una panificadora y el dueño la mira todas las semanas.

### §7.8 — Costos

`…/costos` — admin y encargado. La fórmula está en §9; esta pantalla la muestra y deja jugar.

- **Costo por paquete**, abierto en: materia prima, paquetería, mano de obra, energía y servicios,
  otros indirectos. Un gráfico de composición y la tabla con los números.
- **Comparación** contra el precio de venta de cada canal → **margen bruto y margen neto por
  producto y por canal**.
- **Serie histórica**: cómo se movió el costo por paquete mes a mes, con el precio de venta encima.
  El día que las dos líneas se tocan, el dueño lo tiene que ver antes de que pase.
- **Simulador**: "si la harina sube 20%, ¿cuánto tengo que aumentar para mantener el margen?".
  Es una pantalla de cálculo, no guarda nada.
- **Punto de equilibrio**: cuántos paquetes por mes hay que vender para cubrir los costos fijos.
- **Los costos no se muestran nunca en pantallas de repartidor.**

### §7.9 — Negocio — el tablero

`…/negocio?mes=2026-08` — solo admin (y administración, según configuración).

Los números que pidió el dueño, cada uno definido sin ambigüedad (§9.4):

| Tarjeta | Qué dice exactamente |
|---|---|
| **Facturado** | Σ importes de entregas + ventas mayoristas del período. Devengado, con IVA o sin IVA — elegí uno y aclaralo en la tarjeta. |
| **Cobrado** | Σ pagos recibidos en el período, sin importar de qué mes era la deuda. |
| **Caja** | ingresos − egresos del período, con saldo de apertura y de cierre, separando efectivo / banco / cheques en cartera. |
| **Deuda** | saldo total a cobrar a hoy, con su antigüedad. |
| **A cobrar del mes** | facturado del mes − cobrado del mes. No es lo mismo que "deuda". |
| **Margen** | facturado − costo de lo vendido (§9). |
| **Devolución %** | Σ devuelto / Σ entregado. La métrica que le dice si está cargando de más. |
| **Merma %** | merma / producido. |
| **Rendimiento** | paquetes por cada 100 kg de harina. |

Cortes obligatorios: **por canal** (reparto vs. mayorista), **por repartidor**, **por zona**, **por
producto**, **por cliente** (top 20 y los que bajaron su consumo).

### §7.10 — Configuración

`…/config` — empresa, sucursales, productos, precios, repartos y zonas, motivos de merma, feriados,
plantillas de mail y WhatsApp, y **el cierre de mes**.

---

## §8 — Plata: precios, cuenta corriente, caja y cierre

### §8.1 — Los precios no se editan

Un precio tiene **vigencia** (`daterange`). Cambiar el precio de un producto es **cerrar el vigente
y abrir uno nuevo desde mañana**. No hay botón "editar precio".

Por eso una entrega de ayer sigue valiendo lo que valía aunque hoy aumentes, y el resumen del mes
pasado no cambia solo. Es la misma regla que en EMOAPP (§8.8 de aquel master): **el pasado no se
recotiza**.

Jerarquía al buscar el precio de una entrega, en este orden:
1. Precio especial de **ese cliente** para ese producto, vigente ese día.
2. Precio de lista del **canal** del cliente (reparto / mayorista / mostrador), vigente ese día.
3. Si no hay ninguno: **la entrega se rechaza con un error claro**. Nunca `precio = 0`. Un cero
   silencioso es plata que no se cobra y nadie se entera hasta fin de mes.

**Aumento masivo**: una acción que cierra los precios vigentes y abre los nuevos con un % o un
importe, con vista previa de "estos 34 productos pasan de X a Y" antes de confirmar. Es idempotente
y queda en auditoría.

### §8.2 — Cuenta corriente

- **Cargo** por cada entrega, a la fecha de la entrega, con su `importe` estampado.
- **Pago** por cada cobro. El pago **no se aplica a una factura puntual**: baja el saldo. (Aplicar
  pagos a comprobantes específicos es contabilidad; acá alcanza con saldo y antigüedad. Si el dueño
  lo pide, se agrega después sin romper nada, porque el ledger ya tiene `referencia`.)
- **Nota de crédito**: devolución posterior, error de un mes cerrado, bonificación. Siempre apunta
  al movimiento original.
- **Saldo = Σ movimientos.** No guardes un saldo mutable como fuente de verdad. Si necesitás
  velocidad, guardá un saldo **materializado y recalculable**, con un test que verifique que
  recalcularlo desde cero da lo mismo.

### §8.3 — Caja

- Ingresos: cobranzas del reparto, ventas de mostrador, ventas mayoristas cobradas.
- Egresos: compras de insumos, gastos y servicios, combustible, adelantos a empleados, retiros.
- **Arqueo diario**: lo que el sistema dice que hay vs. lo que el que cierra la caja cuenta. La
  diferencia se registra con motivo, no se ajusta en silencio.
- **Cheques en cartera** con su fecha de cobro. Un cheque **no es caja hasta que se acredita**, y
  el tablero tiene que mostrarlos aparte. En el mayoreo argentino esto no es un detalle.

### §8.4 — Cierre de mes

Una acción, del admin, que en una sola transacción:
1. Verifica que **todas las rendiciones del mes estén cerradas**. Si falta una, no cierra y dice
   cuál.
2. Congela el período (§5.7).
3. Genera el **resumen por cliente**: paquetes por día, total del mes, cargos, pagos, saldo.
4. Genera el **PDF** de cada resumen y lo deja disponible para descargar o mandar.
5. Genera las **liquidaciones de comisión** de cada repartidor.
6. Deja una foto de los números del mes (facturado, cobrado, costo, margen) que **no se recalcula
   nunca más**.

Es **idempotente**: apretar dos veces no duplica cargos ni comisiones.

### §8.5 — Mayoristas

Mismo motor, otra puerta: la venta mayorista sale de la fábrica, no de una camioneta.

- **Remito** con número, productos y lote (trazabilidad, §7.6).
- Puede ser al contado (entra a caja) o a cuenta corriente (entra al ledger).
- Precio del canal MAYORISTA, con la misma regla del §8.1.
- Descuenta stock de producto terminado igual que una entrega de reparto.

### §8.6 — La comisión del repartidor

- Base recomendada: **porcentaje sobre lo COBRADO**, no sobre lo entregado. Si la comisión se paga
  sobre lo entregado, el repartidor no tiene ningún incentivo en cobrar, y la deuda se vuelve
  problema del dueño.
- Configurable por repartidor: % general, % por producto, o monto por paquete.
- **Adelantos** registrados, que se descuentan de la liquidación.
- **Los faltantes de rendición NO se descuentan automáticamente del sueldo.** Se muestran, se
  informan y se discuten. En Argentina el descuento unilateral sobre la remuneración tiene límites
  legales (LCT arts. 131-133): el software informa, la decisión y su instrumentación son del dueño
  con su abogado.

---

## §9 — Costos: la fórmula, escrita de una vez

Que quede una sola definición y que todas las pantallas la usen. Método: **costeo por absorción
simple**, mensual.

### §9.1 — Costo directo (se calcula por unidad, desde la receta)

```
costo_materia_prima_paquete = Σ (cantidad_insumo_por_paquete × costo_promedio_ponderado_insumo)
costo_paqueteria_paquete    = Σ (bolsa + etiqueta + broche + film + tinta) por unidad empaquetada
COSTO_DIRECTO = costo_materia_prima_paquete + costo_paqueteria_paquete
```

La cantidad de insumo por paquete sale de la receta **y del rendimiento real**, no del esperado:
si la receta dice que 100 kg de harina rinden 400 paquetes pero rinden 380, el costo real por
paquete es más alto. Usá el rendimiento real del mes.

### §9.2 — Costo indirecto (se prorratea por período)

**Son dos bolsas, no una.** Nunca las sumes en un solo número:

```
INDIRECTOS_FABRICA = mano_de_obra_fabrica
                   + energia (luz + gas del horno, amasadora, camara, cortadora)
                   + agua de red
                   + alquiler y expensas de la planta
                   + mantenimiento y limpieza
                   + amortizacion de maquinaria (si el dueño la carga)

INDIRECTOS_COMERCIALIZACION = combustible y mantenimiento de vehiculos
                            + sueldos de reparto y administracion
                            + telefonia y sistemas
                            + gastos de cobranza

COSTO_INDIRECTO_FABRICA_PAQUETE = INDIRECTOS_FABRICA / paquetes_producidos_en_el_mes
costo_comercializacion_paquete_del_canal =
    INDIRECTOS_COMERCIALIZACION_del_canal / paquetes_vendidos_por_ese_canal_en_el_mes
```

> **Por qué dos bolsas.** Separá **indirectos de fábrica** (los que hacen el pan) de
> **indirectos de comercialización** (los que lo llevan a la calle). El costo de producir un
> paquete no cambia porque el reparto gaste más nafta. Prorrateá los de fábrica sobre paquetes
> producidos, y los de comercialización sobre paquetes vendidos por canal. Si mezclás las dos
> bolsas, el margen por canal miente y no vas a poder responder "¿me conviene el reparto o el
> mayorista?", que es exactamente la pregunta del negocio.

### §9.3 — Costo total y margen

```
COSTO_PAQUETE      = COSTO_DIRECTO + COSTO_INDIRECTO_FABRICA_PAQUETE
MARGEN_BRUTO       = precio_venta − COSTO_PAQUETE
MARGEN_NETO_CANAL  = MARGEN_BRUTO − costo_comercializacion_paquete_del_canal − comision_repartidor
MARGEN_%           = MARGEN_NETO_CANAL / precio_venta
```

Y el costo de la merma, que es real y se olvida siempre:

```
COSTO_DE_LA_MERMA = (unidades_merma + unidades_devueltas_no_recuperadas) × COSTO_PAQUETE
```

Mostralo como una tarjeta propia en el tablero. En una panificadora con reparto, la devolución que
no se recupera suele ser la fuga de plata más grande y la menos visible.

### §9.4 — Las nueve palabras que no pueden ser ambiguas

Escribí estas definiciones en el código, en un solo archivo (`src/dominio/definiciones.ts`), con
un comentario arriba de cada una, y usalas en todos lados:

| Palabra | Definición exacta |
|---|---|
| **Producido** | unidades que salieron de amasadas confirmadas en el período. |
| **Entregado** | unidades que salieron a un cliente (antes de devoluciones). |
| **Consumido / vendido** | entregado − devuelto. Es lo que se cobra. |
| **Facturado** | Σ importes de cargos del período (devengado). |
| **Cobrado** | Σ pagos recibidos en el período, sea de la deuda que sea. |
| **Caja** | movimientos de efectivo y banco. Un cheque entra recién cuando se acredita. |
| **Deuda** | saldo total a cobrar hoy, de todos los períodos. |
| **A cobrar del mes** | facturado del mes − cobrado imputable a ese mes. |
| **Merma** | unidades perdidas, con motivo, que no llegaron a ningún cliente. |

---

## §10 — El tablero y los gráficos 3D

El dueño pidió métricas gráficas en 3D. Se hacen, y se hacen bien. La regla que las hace útiles:

> **El 3D es piel; el dato es hueso.** El volumen, la profundidad y la luz son para que la pantalla
> impresione y se entienda de un vistazo. **El valor nunca se lee de una dimensión en perspectiva.**

Reglas concretas, no negociables:

1. **Todo gráfico 3D tiene el número escrito.** Encima de la barra, en la tarjeta, o en la etiqueta.
   Si para saber cuánto facturaste hay que estimar la altura de un prisma girado, el gráfico falló.
2. **Botón "ver como tabla"** en cada gráfico. Los mismos números, en filas. Es lo que el dueño le
   manda al contador.
3. **Nada de torta en 3D.** Una torta en perspectiva miente sobre las proporciones. Para partes de
   un total: barras apiladas o barras horizontales.
4. **Una sola fuente.** El gráfico, la tabla, el PDF y el resumen del cliente llaman a la misma
   función pura del dominio. Prohibido que el componente del gráfico haga su propia cuenta.
5. **Rendimiento**: el tablero abre en menos de 2 segundos en un Android de gama media. La librería
   3D se carga **solo en la ruta del tablero** (import dinámico), nunca en el bundle general, y
   nunca en la pantalla del repartidor.
6. **Si no hay WebGL, cae a 2D** sin romperse y sin pedir disculpas.
7. **Los datos se calculan en el servidor.** Al cliente le llega un JSON chico y ya agregado, no
   50.000 entregas para que las sume el navegador.

**Librería recomendada:** ECharts con `echarts-gl` (barras 3D, superficie, dispersión 3D) — una sola
dependencia, funciona en canvas, degrada bien. Alternativa si se quiere algo más artesanal:
Three.js para dos o tres piezas de impacto y gráficos 2D nítidos para el resto.

**Qué gráfico va bien en 3D acá** (donde hay de verdad tres ejes):
- **Barras 3D: producto × mes × facturación.** Doce meses por seis productos es exactamente el caso
  donde el 3D suma.
- **Barras 3D: zona × día de semana × paquetes.** Muestra el patrón de la semana por zona.
- **Superficie: consumo por cliente a lo largo del mes.** Los pozos se ven a simple vista.
- **Mapa de calor 3D del mes** (semanas × días): dónde está el pico de producción.

**Qué NO va en 3D:** la evolución del costo por paquete (línea 2D), la antigüedad de la deuda (barras
2D), el % de devolución (línea 2D con su objetivo), la composición del costo (barra apilada 2D).

**Estética:** oscuro, con vidrio y profundidad, números en tipografía tabular, y **contraste alto**:
esta pantalla se mira en una oficina de fábrica con luz mala, y a veces desde el celular en la
calle. Nada de gris claro sobre gris.

---

## §11 — Stack y arquitectura innegociable

### §11.1 — El stack

| Pieza | Elección | Por qué |
|---|---|---|
| Framework | **Next.js 16** (App Router, server actions) | Es el que ya conoce el dueño y el que ya está desplegado en el producto hermano. |
| Lenguaje | **TypeScript estricto** (`strict: true`, sin `any`) | — |
| Base | **Postgres 16** (Supabase, **Data API desactivada**) | Los `EXCLUDE USING gist`, los triggers y los advisory locks del §6.2 necesitan Postgres de verdad. No es reemplazable por otra base. |
| ORM | **Prisma**, con guard de tenant | Y la migración escrita a mano para las invariantes. |
| Sesión | **NextAuth v5**, credenciales propias | Sin proveedores externos en v1. |
| Validación | **Zod** en el borde de cada server action | Nada entra al servicio sin validar. |
| Mail | **Resend** | Resúmenes, invitaciones, recupero de clave. |
| PDF | generación en el servidor | El resumen del cliente y la liquidación. |
| Tests | `node --test` para dominio, Postgres real para integración, **Playwright** para humo | — |
| Hosting | **Vercel**, funciones en `gru1` | Base en `sa-east-1`: la base y las funciones, cerca. |

### §11.2 — Las carpetas

```
src/dominio/     lógica PURA. No importa Prisma. No llama a new Date() sin argumento. No hace I/O.
                 Todo lo que DECIDE algo vive acá y tiene su test al lado.
                 → entregas.ts, precios.ts, rendicion.ts, receta.ts, costos.ts, planilla.ts,
                   cuenta-corriente.ts, definiciones.ts
src/db/          cliente Prisma + guard de empresa + traducción de errores de Postgres a mensajes
                 que un humano entiende ("ese día ya está cargado para este cliente").
src/servicios/   casos de uso: orquestan dominio + base. Reciben el usuarioId y el empresaId,
                 NUNCA los adivinan ni los leen de un global.
                 → reparto/, fabricacion/, insumos/, plata/, config/, reportes/
src/lib/         sesión, permisos, formato de plata y fechas.
app/             Next: páginas y server actions. Dueñas de la sesión. CERO lógica de negocio.
prisma/          schema + migración (baseline generado + invariantes del §6.2 escritas a mano).
scripts/         setup, doctor, seed, acceso — ver §11.4.
```

### §11.3 — Las cuatro reglas de código

1. **El "ahora" entra por parámetro.** Ninguna función de dominio llama a `new Date()`. Así se puede
   testear el cierre del 31 de agosto, el mes de febrero y el cambio de horario sin levantar nada.
2. **La base es la última red, no el código.** Las invariantes del §6.2 existen aunque el código
   tenga un bug. Y hay un test que lo prueba metiendo un `INSERT` crudo.
3. **Lo que se muestra y lo que decide salen de la misma función.** Si la planilla muestra un total
   y el PDF muestra otro, el sistema perdió la única cosa que tenía que ganar: que le crean.
4. **Ninguna pantalla hace una cuenta.** Los componentes reciben números ya calculados. Un `.reduce()`
   con plata adentro de un `.tsx` es un bug esperando su turno.

### §11.4 — Scripts obligatorios (lo que aprendió el producto hermano)

Estos cuatro comandos existen **desde F1**, no al final. Son los que hacen que el dueño pueda
levantar el sistema sin llamarte:

| Comando | Qué hace |
|---|---|
| `npm run instalar` | esquema + datos de ejemplo + revisión, todo con Node, sin depender de `psql`. |
| `npm run doctor` | revisa la cadena entera —variables de entorno, conexión, tablas **y columnas**, constraints, datos, y que la contraseña del admin ABRA de verdad— y se frena en el primer eslabón roto **diciendo qué comando lo arregla**. |
| `npm run acceso` | repara los usuarios y su acceso, sin tocar datos de negocio. Para el día que el login rechaza una contraseña que sabés que está bien. |
| `npm run seed` | carga (o **recarga**) los datos de ejemplo. Avisa fuerte que rehace todo. |

Y `npm run verify` (typecheck + tests puros) tiene que pasar antes de cada commit.

---

## §12 — Calidad: qué tests son obligatorios

No se pide cobertura del 90%. Se piden **estos** tests, y sin ellos una fase no está terminada:

**Dominio (puros, sin base, corren en segundos)**
- `consumido = entregado − devuelto`, incluidos los bordes: devuelto = entregado, devuelto = 0.
- El precio vigente al día de la entrega, con las tres jerarquías del §8.1 y el error cuando no hay.
- La planilla del mes de un cliente: días sin visita ≠ días con cero, total en paquetes y en $.
- El cuadre de la rendición, por producto, con y sin diferencia.
- El rendimiento de una amasada y el consumo teórico por receta con porcentaje panadero.
- El costo por paquete completo del §9, con un caso numérico escrito a mano por el dueño.
- Meses: 28, 29, 30 y 31 días; el 31 de un mes que cierra; año nuevo.

**Integración (contra Postgres real, en su propia base que se borra en cada corrida)**
- El `UNIQUE` de entrega: dos inserts compitiendo, uno gana, el otro recibe un error traducido.
- El `EXCLUDE` de precios: dos precios que se solapan, el segundo rebota.
- El trigger de mes cerrado: un `UPDATE` a una entrega de un mes cerrado rebota.
- El trigger del ledger: un `UPDATE` y un `DELETE` a `Movimiento` rebotan.
- **Aislamiento de empresa**: un usuario de la empresa A pidiendo una fila de la empresa B no la
  recibe. Nunca.
- **Aislamiento de repartidor**: el repartidor A pidiendo un cliente del repartidor B recibe 404.
- El cierre de mes apretado dos veces genera un solo juego de cargos.
- Reintento con la misma clave de idempotencia: una sola entrega.

**Humo (navegador real, deja capturas)**
- Login → planilla → cargar una celda → aparece el total.
- Reparto en el celular: carga → dos entregas → rendición que cuadra → cerrada.
- Cierre de mes → PDF que descarga y tiene el mismo total que la pantalla.

---

## §13 — Legal, fiscal y bromatológico (Argentina)

**Esto no lo decide el software. Lo decide un contador y un abogado.** El software tiene que:

1. **No emitir factura fiscal en v1.** Emite un **comprobante interno no fiscal** (remito/resumen),
   guarda un campo para pegar el CAE del comprobante emitido por fuera, y **exporta el libro de
   ventas en CSV** para el estudio contable. La facturación electrónica ARCA entra en v2 vía
   proveedor externo (TusFacturas, Facturante o similar), nunca contra el webservice de ARCA a mano.
2. **Remito de traslado.** La mercadería que sale a la calle o a un mayorista va con su remito
   numerado. Verificá con el contador la forma exigida antes de imprimir el primero.
3. **Trazabilidad de lote.** Fecha de elaboración, vencimiento y lote en el paquete y en el sistema,
   con la consulta "este lote fue a estos clientes" (§7.6). Es requisito bromatológico y es lo único
   que sirve el día de un retiro de mercadería.
4. **Documentos con vencimiento**: habilitación municipal, RNE/RNPA de los productos, libreta
   sanitaria de cada empleado, control de plagas, análisis de agua. Guardalos con su fecha de
   vencimiento y **avisá 30 días antes**. La opción "ignorar el vencimiento" no existe.
5. **Datos personales** (Ley 25.326): los datos de clientes y empleados se guardan cifrados en
   tránsito, con acceso por rol, y hay una acción de exportación y borrado a pedido.
6. **Comisiones y descuentos** (§8.6): informar, no descontar solo.
7. **Términos y política de privacidad** revisados antes de que entre el primer usuario que no sea
   el dueño.

> Poné todo esto en un `docs/legal.md` con el estado de cada punto y quién lo tiene que responder.
> No lo dejes como comentario en el código.

---

## §14 — Las fases: en qué orden se construye

Una fase termina cuando **su criterio de aceptación pasa**, no cuando "está el código". No adelantes
fases: cada una vive de la anterior.

| Fase | Qué se construye | Termina cuando… |
|---|---|---|
| **F0** | **Cero código.** Las 12 decisiones del §15 respondidas y escritas en `docs/F0-modelo-de-negocio.md`. Las variables del §2 completas. | El dueño mira la planilla de papel de un mes real y confirma que el modelo la representa entera. |
| **F1** | **La planilla que no se puede cobrar dos veces.** Login, accesos, clientes, productos, precios, entregas, planilla mensual con totales. El motor del §5 con sus tests. | Se carga un mes real completo desde el cuaderno y los totales coinciden con lo que el dueño cobró de verdad ese mes. Ese es el examen. |
| **F2** | **El reparto del día en el celular.** Hoja de ruta, carga, entrega/devolución, cobranza, rendición que cuadra. | Un repartidor real hace un día entero de reparto con el celular y la rendición cierra en cero. |
| **F3** | **Cierre de mes y cuenta corriente.** Cargos, pagos, saldo, antigüedad, cierre congelado, resumen en PDF, envío por mail/WhatsApp, cheques, caja. | El resumen que se le manda a un cliente coincide con la planilla, y reabrir el PDF un mes después dice lo mismo. |
| **F4** | **Fabricación.** Recetas versionadas, amasadas, lotes, rendimiento, merma, stock de producto terminado, trazabilidad. | La ley 2 del §5.4 cierra sobre una semana real de producción. |
| **F5** | **Insumos y compras.** Stock, valorización, consumo por receta, inventario físico, gastos de servicios, alertas. + **cola offline** del reparto. | La ley 3 del §5.5 cierra sobre un mes real, y el inventario físico explica su diferencia. |
| **F6** | **Costos.** La fórmula del §9 completa, con simulador y punto de equilibrio. | El costo por paquete calculado por el sistema coincide con el que el dueño calcula a mano, con la misma apertura. |
| **F7** | **Negocio.** El tablero con todos los cortes y los gráficos 3D del §10. | El dueño responde "¿me conviene el reparto o el mayorista?" mirando una sola pantalla. |
| **F8** | **Mayoristas completo + portal del cliente** (ve su cuenta y sus resúmenes) + facturación externa + retiro de lote. | — |
| **F9** | Pronóstico de producción, ruta sugerida, códigos de barra, multi-sucursal real. | — |

> **El tablero crece por capas.** No esperes a F7 para mostrar números: desde F3 hay una versión
> chica del tablero con facturado, cobrado y deuda. Lo que llega en F7 es el margen, los cortes
> finos y el 3D. Un dueño que no ve un número hasta la fase 7 abandona el sistema en la 2.

---

## §15 — Decisiones abiertas: contestá estas 12 antes de escribir una tabla

Cada una viene con una recomendación. **Si el dueño no contesta, tomá la recomendación, dejala
escrita en `docs/F0-modelo-de-negocio.md` y seguí.** Lo que no se puede hacer es empezar sin
decidir y descubrirlo a mitad de camino.

| # | Decisión | Recomendación | Qué cambia si se decide al revés |
|---|---|---|---|
| 1 | ¿El reparto es **consignación** o venta en firme? | **Consignación** (el dueño dijo "consumió"), configurable por cliente. | Si es en firme, `devuelto` desaparece de la pantalla y toda devolución es nota de crédito. Cambia la planilla, no el esquema. |
| 2 | ¿La unidad es **paquete**, plancha o kilo? | **Paquete**, con `pesoUnitarioG` guardado para poder convertir. | Si es kilo, las cantidades dejan de ser enteras y hay que revisar cada `CHECK`. **Decidilo ahora.** |
| 3 | ¿Cuántos **productos** distintos tiene el reparto? | Si son 1 o 2, la planilla muestra un producto por vez. Si son más de 5, el selector de producto es obligatorio desde F1. | Cambia el diseño de la pantalla estrella. |
| 4 | ¿El repartidor es **empleado a comisión** o **revendedor** que compra y revende? | **Empleado a comisión**, y el cliente es de la empresa. | Si es revendedor, el "cliente" del sistema pasa a ser el repartidor, la planilla es de él, y la panificadora no ve al kiosco. Es **otro producto**: decidilo en F0 o vas a reescribir. |
| 5 | ¿El precio es **por cliente** o hay una lista pareja? | Lista por canal + excepciones por cliente. Ya está en el esquema, se usa o no. | Ninguno. Por eso se construye así. |
| 6 | ¿Se cobra **mensual** o hay clientes de contado diario? | **Los dos**: `modalidadDeCobro` en el cliente. La planilla es igual; cambia si genera saldo o entra a caja. | Ninguno si se contempla desde el día 1; caro si se agrega después. |
| 7 | ¿Corta el reparto por **deuda**? | **No automático.** Avisa siempre; el bloqueo lo activa el admin y arranca a los 60 días. | Un corte automático mal calibrado le hace perder un cliente al dueño. La decisión es humana. |
| 8 | ¿**Cheques**? | **Sí, cartera simple desde F3** (número, banco, fecha de cobro, estado). | Sin esto, la caja del tablero miente en un negocio mayorista. |
| 9 | ¿**Offline** en el celular del repartidor? | Idempotencia y cola en memoria desde F1; cola persistente **en F5**. | Nada si la idempotencia está desde el día 1. Todo si no está. |
| 10 | ¿Se controlan **lotes y vencimientos**? | **Sí, desde F4.** Es una fábrica de alimentos. | Sin lote no hay trazabilidad ni retiro de mercadería posible. |
| 11 | ¿El sistema toca **plata online** (cobros con link/QR)? | **No en v1.** Efectivo, transferencia y cheque, registrados a mano. | Meterse con una pasarela en v1 agrega una integración crítica antes de tener el negocio modelado. |
| 12 | ¿**Multi-empresa** ya (fork del §1)? | **A**: una empresa en pantalla, `empresaId` en el esquema. | Agregar el tenant después es una migración con plata adentro. |

### §15.1 — Cosas del audio del dueño que hay que confirmar antes de F1

- **"Bibrones"** en paquetería: se interpreta como **bobinas de film**. Si eran otra cosa
  (broches, precintos), corregí el nombre del insumo. No cambia nada del modelo.
- **"Tintas"**: se interpreta como **tinta de la fechadora** (la que imprime elaboración y
  vencimiento en la bolsa). Si eran **cintas** de cierre, es igual de válido: ambos son paquetería
  que se consume por unidad empaquetada.
- **"Garantía final del mes"**: se interpreta como el **cierre y el total del mes** de la planilla
  (§7.3 + §8.4). Si el dueño quiso decir otra cosa —una garantía o depósito del cliente—, avisá,
  porque eso sí es una tabla nueva.
- **El agua**: entra dos veces y no es contradicción. El **agua de proceso** que va a la masa es
  materia prima de la receta; el **agua de red que se factura** es un gasto de período. Las dos
  cosas conviven.

---

## §16 — Definición de terminado

Una funcionalidad está terminada cuando las cinco cosas pasan:

1. **Los tests obligatorios de su fase (§12) pasan**, incluido el de integración contra Postgres.
2. **`npm run verify` pasa** (typecheck estricto + tests puros).
3. **Funciona en el celular**, no solo en el monitor de 27 pulgadas. Probado en un ancho de 390 px.
4. **Un número que aparece en pantalla aparece igual en el PDF y en el CSV.**
5. **El dueño la usó una vez con datos reales** y no volvió al cuaderno.

Y el criterio que manda sobre todos: **el sistema no puede cobrarle de más ni de menos a un
cliente.** Si hay que elegir entre una pantalla linda y un total confiable, gana el total.

---

## §17 — Anexo: el oficio, para que el que codea entienda lo que modela

**Cómo se hace el pan de miga** (el flujo que el sistema refleja):

`amasado` (harina + agua + levadura + sal + azúcar + grasa + leche en polvo + mejorador) →
`fermentación` en cámara → `horneado en molde cerrado` (por eso no tiene corteza dorada arriba) →
`enfriado` (varias horas, y es obligatorio: pan caliente no se puede cortar) → `descortezado` →
`rebanado` → `empaquetado` (bolsa + cierre + etiqueta con lote, elaboración y vencimiento) →
`despacho` (camioneta de reparto o mayorista).

**Los números que un panadero mira** y que el sistema tiene que darle sin que los pida:

| Número | Por qué le importa |
|---|---|
| Paquetes por cada 100 kg de harina | Es el rendimiento. Si baja, algo cambió: la harina, el corte, el horno. |
| % de descortezado | Es merma grande y esperada en pan de miga. Se controla contra su objetivo, no contra cero. |
| % de devolución del reparto | Si sube, está cargando de más la camioneta y regalando pan. |
| Costo de la harina, semana a semana | Es la variable que se come el margen. |
| Consumo promedio por cliente | Es lo que sugiere cuánto dejarle mañana. |
| Días de cobertura de insumos | "Harina para 3 días" es lo que evita parar la producción. |

**Glosario** para que los nombres del código sean los del oficio:

| Palabra | Qué es |
|---|---|
| **Amasada / bacha** | una tanda de masa. La unidad de producción. |
| **Porcentaje panadero** | todos los ingredientes expresados como % de la harina, que es 100%. Es como está escrita toda receta de panadería. |
| **Plancha** | el pan de miga entero, sin cortar en paquetes. |
| **Descortezado** | sacarle la corteza a la plancha. Genera merma que suele volverse pan rallado. |
| **Rendición** | la cuenta que hace el repartidor al volver: lo que llevó vs. lo que trae y lo que cobró. |
| **Hoja de ruta** | la lista ordenada de clientes de un reparto en un día. |
| **Consignación** | dejar mercadería y cobrar solo lo que se consumió, retirando el resto. |
| **Canje / devolución** | el pan que vuelve sin venderse. |
| **Merma** | lo que se perdió y no llegó a ningún cliente. |
| **Remito** | el papel que acompaña la mercadería cuando se mueve. |

---

## §18 — Lo primero que tenés que hacer

**No abras el editor todavía.**

1. Leé este documento entero y **decime qué de acá no cierra** con lo que ves. Una contradicción
   encontrada ahora vale más que una semana de código.
2. Escribí `docs/F0-modelo-de-negocio.md` con las 12 decisiones del §15 respondidas (con la
   recomendación si no hay respuesta del dueño) y las variables del §2 completas hasta donde se
   pueda.
3. Hacé **una sola pantalla estática**, sin base, sin login: la planilla del §7.3 con un mes real
   cargado a mano desde el cuaderno del dueño. Mostrásela y hacé **una sola pregunta**:
   *"¿esto te reemplaza el cuaderno?"*
4. Recién cuando la respuesta sea que sí: `src/dominio/entregas.ts` y `src/dominio/precios.ts`,
   **con sus tests, antes que cualquier pantalla**.

El orden importa. La planilla que no cuadra no se arregla con un tablero en 3D.
