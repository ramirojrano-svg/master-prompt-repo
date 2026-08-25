# Pujas y presupuesto

## Cómo elegir estrategia de puja

La elección depende de una sola variable: **cuántas conversiones junta la
campaña por mes**. Las pujas automáticas son modelos estadísticos; sin datos no
tienen de qué aprender.

- **Menos de ~15 conversiones al mes**: Maximizar conversiones sin objetivo de
  CPA. Dejala juntar datos. Poner un CPA objetivo agresivo con este volumen
  ahoga la campaña: no encuentra subastas que cumplan y deja de mostrar.
- **~15-30 al mes de forma sostenida**: se puede pasar a CPA objetivo. Arrancá
  con el CPA que la cuenta ya consigue, no con el que al usuario le gustaría.
  Bajalo de a poco, 10-15% por vez, esperando dos semanas.
- **Sin conversiones medidas de forma confiable**: no uses puja automática por
  conversiones. Estarías optimizando hacia ruido. Maximizar clics con límite de
  CPC, o CPC manual, mientras se arregla la medición.
- **ROAS objetivo**: pensada para ecommerce con ingreso por transacción. En un
  consultorio solo tiene sentido si se asignan valores distintos por tipo de
  consulta y esos valores son reales. Si todas las conversiones valen lo mismo,
  ROAS objetivo y CPA objetivo son la misma cosa dicha distinto: usá CPA.

Cambiar de estrategia reinicia el aprendizaje. Cada cambio cuesta una o dos
semanas de rendimiento inestable, así que no encadenes cambios ni evalúes los
resultados a los tres días.

## Presupuesto

- El presupuesto diario es un promedio, no un tope duro: Google puede gastar
  más en un día de mucha demanda y compensar en el mes. No te alarmes por un
  día puntual.
- **Regla práctica**: una campaña necesita presupuesto diario de al menos unas
  10 veces su CPA objetivo para tener margen de aprender. Si el CPA es 20 y el
  presupuesto diario 15, esa campaña no va a estabilizarse nunca. Es la señal
  más clara de que hay que consolidar campañas en vez de repartir.
- **Cuota de impresiones perdida por presupuesto** te dice si el techo es la
  plata. **Cuota perdida por ranking** te dice que el problema es relevancia o
  puja, y ahí sumar presupuesto no arregla nada. Mirá cuál de las dos domina
  antes de recomendar subir el gasto: es la diferencia entre un problema de
  inversión y uno de calidad.

## Cómo repartir entre especialidades

Los criterios útiles, en orden:

1. **Capacidad real de la agenda.** Publicidad que llena una agenda ya llena no
   genera un peso. Si el traumatólogo está completo dos semanas, sacale
   presupuesto aunque su CPA sea el mejor de la cuenta. Este criterio le gana a
   todos los demás y es el que más se olvida.
2. **Valor por paciente**, incluyendo si vuelve. Una consulta que deriva en
   tratamiento largo justifica un CPA mucho mayor que una consulta suelta.
3. **Rendimiento demostrado**, no intuido: CPA y volumen de los últimos 30-90
   días.
4. **Estacionalidad**: hay especialidades con picos claros.

Un reparto razonable de arranque: la mayor parte a los servicios probados, una
porción chica y acotada a lo que se está probando, y a la marca lo mínimo que
sostenga la cuota de impresiones alta.

## Performance Max, si el usuario insiste

PMax puede funcionar, pero en cuentas locales chicas suele dar una mejora
aparente que es en realidad canibalización de tráfico que ya tenias. Si se
avanza, tres recaudos:

- **Excluí la marca** con negativas a nivel cuenta o campaña, para que no se
  anote conversiones de gente que ya te buscaba por nombre.
- **Mantené la campaña de Búsqueda corriendo**. Búsqueda con concordancia
  exacta tiene prioridad sobre PMax para el mismo término; si apagas Búsqueda
  perdés el control sin ganar nada.
- **Medí incrementalidad**, no total: la pregunta no es cuántas conversiones
  reporta PMax, es cuántas conversiones **más** tiene la cuenta desde que
  arrancó. Compará el total de la cuenta contra el período anterior.

Y revisá `politicas-salud.md` antes: PMax genera recursos y segmentaciones de
forma automática, lo que en salud aumenta el riesgo de terminar en una
combinación que la política no permite.

## Qué no hacer

- Tocar pujas todos los días. Cada cambio reinicia aprendizaje; la cuenta nunca
  sale del período inestable.
- Evaluar una semana con menos de ~15-20 conversiones como si fuera señal. Con
  esos números, la variación entre semanas es ruido. Mirá 30 días.
- Subir presupuesto cuando la cuota perdida es por ranking.
- Poner un CPA objetivo por debajo de lo que la cuenta logró alguna vez y
  esperar que aparezca volumen.
