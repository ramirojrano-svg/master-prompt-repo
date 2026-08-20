# Buscador de nichos — dónde meter la próxima startup

> Documento hermano de `F0-modelo-de-negocio.md`. Este no cierra un negocio: **abre la
> caza**. Sirve para encontrar el próximo vertical antes de escribir una línea de código.
>
> La tesis: tu ventaja no es "IA". Es que sabés parir **software operativo de un vertical**
> —agenda que no vende dos veces la misma sala, cuenta corriente, liquidación, roles,
> multi-tenant— rápido y bien (EMOAPP lo probó). El nicho bueno es el que **necesita
> exactamente eso** y hoy lo resuelve a mano, en Excel, o con un software carísimo y viejo.

---

## 1. Qué hace bueno a un nicho (el filtro)

Un nicho califica solo si pasa **casi todo** esto. Puntuá cada uno 0–2 y sumá.

| # | Criterio | 0 | 1 | 2 |
|---|----------|---|---|---|
| 1 | **Dolor puntual y repetido** | molestia difusa | duele a veces | duele todos los meses, con nombre propio |
| 2 | **Cómo se hace hoy** | ya hay un SaaS bueno y barato | Excel + WhatsApp | papel, cuaderno, o software viejo de €200+/mes |
| 3 | **Hay plata adentro** | hobby | factura chica | factura, liquida o cobra plata cada mes |
| 4 | **Quién decide = quién paga** | comité | jefe convence a otro | el que sufre firma el cheque |
| 5 | **Núcleo agendable/liquidable** | texto libre | algo de reglas | horarios/recursos con conflictos + cuenta corriente |
| 6 | **Regla dura que da miedo** | ninguna | alguna | "si esto se solapa/duplica, hay quilombo" |
| 7 | **Puerta de entrada** | mercado anónimo | frío total | tenés 1 piloto real a mano |
| 8 | **La IA agrega, no es el show** | la IA ES el producto (riesgo) | ayuda de costado | saca 1 tarea horrible (carga, conciliación, redacción) |

**≥12 = perseguir. 9–11 = tibio, validá primero. <9 = pasar.**

> Ojo con el criterio 8. Tu foso no es un modelo de IA (eso lo tiene todo el mundo). Tu foso
> es el **motor del vertical**: las reglas duras, el ledger, el "nunca cobres dos veces". La
> IA es el ayudante que carga datos y redacta — no la promesa central.

---

## 2. El prompt buscador (copiá y pegá)

Este prompt lo corrés con cualquier LLM con buen razonamiento. Está pensado para escupir
candidatos **filtrados por tu ventaja real**, no ideas de moda.

```
Actuá como un socio operador que ya construyó y vendió software vertical.

MI VENTAJA (no la contradigas, filtrá todo por acá):
- Construyo SaaS operativo de un vertical, rápido y sólido: agenda con conflictos
  (nunca vender dos veces el mismo recurso), cuenta corriente / ledger append-only,
  liquidación mensual, roles y permisos, multi-tenant, exportes.
- Uso IA para sacar UNA tarea horrible del proceso (carga de datos, conciliación,
  redacción de un documento repetitivo), no como el producto entero.
- Mercado: pymes de servicios en Argentina / LATAM. Ticket B2B chico-mediano.
  El que sufre el dolor es el que firma.

LO QUE BUSCO:
Nichos donde un proceso operativo se hace HOY a mano / en Excel / en papel, o con un
software caro, viejo y odiado. Que tenga plata adentro (se factura, liquida o cobra cada
mes) y una regla dura donde equivocarse duele (solapamiento, doble cobro, vencimiento,
turno perdido).

DAME 10 NICHOS. Para cada uno, en máximo 6 líneas:
1. El nicho y quién exactamente paga (rol + tamaño típico).
2. El proceso doloroso, tal como se hace hoy (sé concreto: "anota turnos en un cuaderno").
3. Qué software usan hoy y por qué lo odian (o por qué no usan ninguno).
4. La regla dura del dominio (qué NO puede pasar nunca).
5. Dónde entra la IA para sacar 1 tarea horrible.
6. Puntaje 0-2 en: dolor / hoy-analógico / plata / decisor=pagador / núcleo-agendable
   / regla-dura / puerta-de-entrada / IA-de-costado. Y el total sobre 16.

Ordená de mayor a menor puntaje. Después del listado, elegí EL nicho que atacarías
primero y explicá en 3 líneas por qué gana, y cuál sería el piloto de 1 cliente para
validarlo en 30 días.

No me des nichos genéricos ("consultorías", "e-commerce"). Quiero verticales angostos
con un dolor con nombre propio. Si un nicho depende de que la IA sea perfecta, descartalo.
```

### Variantes útiles

- **Para exprimir un nicho puntual:** reemplazá "DAME 10 NICHOS" por
  *"El nicho es \<X\>. Mapeá los 5 procesos que hoy se hacen a mano, cuál duele más, y qué
  parte es agendable/liquidable como en mi motor."*
- **Para encontrar el software caro a reemplazar:** pediní
  *"¿Qué software incumbente cobra caro en \<X\>? Precio, qué odia el usuario, y qué versión
  angosta y barata le comería el 20% de abajo del mercado."*
- **Para chequear la puerta de entrada:** *"Dame 5 formas concretas de conseguir el primer
  piloto en \<X\> sin red de contactos previa."*

---

## 3. Ideas ya filtradas (candidatos concretos, LATAM)

Estos ya pasaron el filtro. Todos comparten ADN con EMOAPP: un **recurso escaso con
conflictos** + **plata que se liquida o se cobra por período** + **una regla dura**. Eso es
literalmente reusar tu motor cambiándole la piel.

| Nicho | Dolor de hoy | Regla dura | Dónde entra la IA | Fit |
|---|---|---|---|---|
| **Alquiler de canchas / clubes de pádel-fútbol 5** | cuaderno + WhatsApp, doble reserva, quién pagó la seña es un misterio | no vender la misma cancha 2 veces; seña vs. saldo | responder WhatsApp y cargar la reserva sola | ★★★ |
| **Peluquerías / estética con varios profesionales y alquiler de sillón** | agenda en papel por profesional, la dueña alquila el sillón y liquida a fin de mes de memoria | no solapar profesional+sillón; liquidar comisión sin error | recordatorio y reprogramación por chat | ★★★ |
| **Kinesiología / centros de rehabilitación (obras sociales)** | turnos en Excel, y el infierno real: **facturar a la obra social** con planilla y códigos | no perder la sesión autorizada; no facturar mal el código | leer la autorización y armar la planilla de la OS | ★★★ |
| **Estudios contables chicos — vencimientos de clientes** | Excel de vencimientos por cliente, se les pasa uno y es multa | ningún vencimiento sin avisar; quién debe qué mes | leer el calendario fiscal y redactar el aviso al cliente | ★★☆ |
| **Guarderías / jardines maternales — cuota + asistencia** | cuota en cuaderno, quién pagó/quién debe, permisos de retiro | no dejar retirar a quien no está autorizado; cobrar la cuota una vez | armar el recordatorio de deuda y el recibo | ★★☆ |
| **Alquiler de equipos/herramientas o salas de ensayo** | planilla, se superponen reservas, el depósito en garantía se pierde de vista | no alquilar 2 veces el mismo equipo en la misma franja | estado del equipo y aviso de devolución | ★★☆ |
| **Veterinarias — turnos + plan sanitario recurrente** | agenda + "¿cuándo toca la próxima vacuna?" a ojo | no perder el refuerzo con fecha; cta. cte. del cliente | calcular el calendario sanitario y avisar solo | ★★☆ |
| **Escuelas de música / academias — aula + profe + cuota** | grilla de aulas en papel, cuota mensual, ausencias | no poner 2 clases en el aula a la vez; cobrar el mes una vez | reprogramar ausencias y liquidar al profe | ★★☆ |

**El que yo atacaría primero: canchas de pádel/fútbol 5.** Es EMOAPP con otra piel —"sala"
pasa a ser "cancha", "profesional" a "socio/cliente", "liquidación" a "cierre de caja del
día"—, el boom de pádel en Argentina/España llena de clubes nuevos sin sistema, el dueño
sufre y firma solo, y la puerta de entrada es física: entrás a un club, ves el cuaderno, y
ya tenés el piloto. La IA saca la tarea peor: **contestar el WhatsApp y cargar la reserva
sin humano en el medio.**

> Piloto de 30 días: 1 club, 3 canchas, reservas por WhatsApp que caen solas en la grilla,
> seña registrada, y el cierre de caja del día en una pantalla. Métrica que decide:
> reservas cargadas sin que nadie las tipee a mano.

---

## 4. Cómo usar esto

1. Corré el prompt de §2 con tu propio ángulo (barrio, contacto, industria que ya conocés).
2. Cada candidato que devuelva, pasalo por la tabla de §1. Si no llega a 12, no lo toques.
3. Al que gane, abrile su `F0-modelo-de-negocio.md` y cerrá las 8 decisiones ANTES de
   codear. Ese documento es el que te evita la migración con plata adentro.
4. El motor de EMOAPP (reservas puras + `EXCLUDE USING gist` + ledger append-only) es
   reusable casi tal cual. No lo reescribas: cambiale la piel.
