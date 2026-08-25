# Medición y conversiones

Si la medición está mal, todo lo demás es opinión. Empezá siempre por acá:
una cuenta con conversiones mal contadas no tiene un problema de pujas, tiene
un problema de datos, y tocar pujas encima lo empeora.

## Qué cuenta como conversión en un consultorio

El objetivo real casi nunca es lo que la cuenta esta midiendo. Ordenados de
mejor a peor señal:

1. **Turno agendado y confirmado** — lo único que representa plata. Requiere
   que el sistema de turnos dispare la conversión al confirmar.
2. **Llamada telefónica de más de X segundos** — buen sustituto cuando el
   teléfono es el canal principal. El umbral importa: una llamada de 8
   segundos es alguien que corto, y contarla ensucia la señal.
3. **Envío de formulario de contacto**.
4. **Clic a WhatsApp** — el más común y el más engañoso. Mide una intención,
   no una consulta: buena parte no escribe nunca. Si es lo único que hay,
   usalo, pero decile al usuario que está optimizando hacia un proxy y que el
   CPA real es peor que el que ve.
5. **Clic al teléfono en mobile** — mide que tocaron el número, no que
   hablaron con alguien.

Lo que **no** debe ser conversión principal: visitas a la página de contacto,
tiempo en el sitio, scroll, "vistas de página clave". Son secundarias. En una
cuenta chica alcanzan para desviar por completo la puja automática, porque el
algoritmo va a buscar gente que hace scroll en lugar de gente que pide turno.

## Principales y secundarias

Solo las conversiones marcadas como **principales** entran en la puja
automática y en la columna "Conversiones". Las secundarias se registran para
mirar, sin afectar la optimización.

El error más frecuente en cuentas de salud es tener cinco acciones marcadas
como principales, de las cuales tres son proxies debiles. La puja optimiza
hacia el promedio de todas, o sea hacia la más fácil y menos valiosa. Regla
práctica: **una principal, la más cercana a la plata**; el resto, secundarias.

## Duplicación: el error que infla todo

El clásico: la misma acción medida dos veces, con la etiqueta de Google Ads y
también importada desde GA4. La cuenta muestra el doble de conversiones, el
CPA parece la mitad y todas las decisiones salen mal.

Cómo detectarlo: si el número de conversiones es sospechosamente parejo al
doble de lo que el consultorio reporta como consultas reales, o si en la lista
de acciones de conversión hay dos entradas que describen lo mismo con nombres
distintos, revisá el origen de cada una.

Elegí una fuente de verdad. Si el sitio ya tiene GA4 bien configurado, importar
desde GA4 y no poner además la etiqueta directa; o al revés. No las dos.

## Ventana de conversión y como leer los números

- La decisión de atenderse no es inmediata: se consulta, se pregunta la obra
  social, se compara. Una ventana corta subcuenta conversiones que la campaña
  si genero.
- Las conversiones se atribuyen **al día del clic**, no al día en que
  ocurrieron. Por eso los últimos días siempre parecen peores: todavía les
  faltan conversiones por acreditarse. No saques conclusiones de los últimos
  3-7 días.
- El modelo de atribución cambia como se reparte el crédito entre puntos de
  contacto. Lo importante no es cuál usar sino **no comparar períodos medidos
  con modelos distintos** y avisar cuando el modelo cambio.

## Llamadas

En consultorios, el teléfono suele ser el canal principal, y ahí se cae la
medición:

- El seguimiento de llamadas por reenvío permite medir duración, que es lo que
  distingue una consulta de un número equivocado.
- Configurá un umbral de duración razonable como conversión.
- **Antes de nada, preguntá quien atiende y en que horario.** Si nadie atiende
  de 13 a 16, o si las llamadas caen en un contestador, no hay ajuste de puja
  que arregle esa cuenta. Es el hallazgo más valioso y más invisible de
  cualquier auditoría de un consultorio, porque no aparece en ninguna métrica
  de Google: la campaña se ve perfecta y el negocio no recibe pacientes.
- Cruzá conversiones de llamada contra el registro real de turnos del mes. Si
  Google dice 40 llamadas y la agenda muestra 12 turnos nuevos, la brecha está
  en la atención del teléfono, no en la campaña.

## Datos de pacientes: el límite técnico

Antes de tocar conversiones mejoradas, Customer Match o importaciones offline,
leé `politicas-salud.md`. Resumen operativo:

- No mandes datos identificables de pacientes a Google, aunque vayan con hash.
- Revisá que el motivo de consulta, la especialidad o cualquier dato clínico
  **no viaje en la URL de la página de gracias ni en los parámetros del
  evento**. Es la fuga más común: el formulario redirige a
  `/gracias?motivo=oncología` y eso queda en el evento de conversión.
- Ante la duda, minimizá: medí que hubo una conversión, no de qué se trataba.
