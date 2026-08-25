# Checklist de auditoría

El orden importa: cada bloque asume que el anterior está sano. Auditar pujas
sobre una medición rota produce conclusiones seguras y equivocadas, que es el
peor resultado posible de una auditoría.

Pedí los datos que falten en vez de asumir. Si algo no se puede verificar,
anotalo como no verificado en el entregable en lugar de completarlo con una
suposición.

## 0. Contexto del negocio (antes de abrir la cuenta)

Sin esto, cualquier número de Google es un número sin unidad:

- [ ] Qué servicios se quieren llenar y cuál es la prioridad
- [ ] **Capacidad de la agenda por especialidad**: dónde sobran turnos y dónde
      ya no entra nadie
- [ ] Valor de un paciente nuevo, y si vuelve
- [ ] Obras sociales y prepagas que acepta, y cuales no
- [ ] Zona real de atención
- [ ] **Quien atiende el teléfono y en que horario**
- [ ] País y marco regulatorio aplicable

## 1. Medición (si esto falla, se corta la auditoría)

- [ ] Hay conversiones configuradas y están registrando
- [ ] Cuales están marcadas como principales, y representan plata real
- [ ] No hay acciones duplicadas (etiqueta de Ads + importada de GA4)
- [ ] Las llamadas se miden, con umbral de duración razonable
- [ ] Ventana de conversión acorde al ciclo de decisión
- [ ] Ningun dato clínico viaja en URLs de gracias ni en parámetros de evento
- [ ] Conversiones mejoradas / Customer Match: si están activas, revisar contra
      `politicas-salud.md`
- [ ] Cruce de control: conversiones reportadas vs turnos reales del mes

Si el cruce de control da una brecha grande, ese es el hallazgo principal de
la auditoría y hay que decirlo primero, por encima de cualquier otra cosa que
encuentres.

## 2. Cumplimiento (el que rompe cuentas)

- [ ] Anuncios activos, sin rechazos ni desaprobaciones pendientes
- [ ] Ninguna audiencia ni remarketing basado en condición de salud
- [ ] Listas de remarketing solo desde páginas neutras
- [ ] Textos sin promesas de resultado ni de cura
- [ ] Sin testimonios presentados como resultado típico
- [ ] Matrículas y títulos exhibidos correctamente
- [ ] Servicios que requieren certificación: verificados para el país destino
- [ ] Landing coherente con lo que promete el anuncio

## 3. Estructura

- [ ] Campaña de marca separada y medida aparte
- [ ] Cantidad de campañas acorde al presupuesto (consolidar si están
      hambreadas)
- [ ] Grupos organizados por intención, cada uno con su landing
- [ ] Concordancias adecuadas al volumen de conversiones de la cuenta
- [ ] Lista de negativas a nivel cuenta, con formación, gratuidad e
      informativo
- [ ] Negativas de obras sociales no aceptadas
- [ ] Segmentación geográfica en **presencia**, con radio razonable
- [ ] Informe de ubicaciones sin zonas fuera de alcance
- [ ] Programación de anuncios alineada al horario de atención telefónica

## 4. Pujas y presupuesto

- [ ] Estrategia de puja acorde al volumen mensual de conversiones
- [ ] Presupuesto diario suficiente por campaña (referencia: ~10x el CPA
      objetivo)
- [ ] Cuota de impresiones perdida: por presupuesto vs por ranking, cuál domina
- [ ] Sin cambios de estrategia recientes que expliquen inestabilidad
- [ ] CPA objetivo alcanzable según lo que la cuenta ya logró
- [ ] PMax, si existe: marca excluida, Búsqueda sigue viva, incrementalidad
      medida

## 5. Anuncios y destino

- [ ] Variedad real de títulos y descripciones
- [ ] Recursos de ubicación, llamada y enlaces por especialidad
- [ ] Obras sociales, horarios y dirección visibles en la landing
- [ ] Velocidad y usabilidad en mobile
- [ ] Formulario corto; teléfono visible sin scroll
- [ ] Cada especialidad con landing propia, no todo a la home

## 6. Términos de búsqueda

- [ ] Revisar los últimos 30-90 días, ordenados por costo
- [ ] Marcar dónde se fue la plata sin conversión
- [ ] Identificar términos que convierten y no están como exacta
- [ ] Derivar negativas nuevas de lo que apareció, no de una lista genérica

## Cierre

Ordená los hallazgos **por plata en juego**, no por facilidad de arreglo ni
por el orden de este checklist. Un consultorio con el teléfono desatendido
tiene un solo problema que importa, aunque tenga veinte casillas sin tildar.

Cerrá siempre con qué datos te faltaron: eso le permite al usuario saber cuánta
confianza darle a cada conclusión.
