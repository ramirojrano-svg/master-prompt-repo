# Políticas de publicidad en salud

**Esto explica el criterio, no es la fuente.** La política de Google Ads
cambia varias veces al año y difiere por país. Verificá el punto concreto en
`support.google.com/adspolicy` (secciones de atención médica y medicamentos, y
de publicidad personalizada) antes de afirmarle algo definitivo al usuario. Si
no podés verificar, decilo: en este rubro una recomendación desactualizada se
paga con la cuenta suspendida.

## 1. Categorías sensibles: no se segmenta por condición de salud

La política de publicidad personalizada prohibe segmentar en base a que una
persona tenga, busque o se trate por una condición física o mental, una
discapacidad, un procedimiento o un medicamento.

Esto no es un detalle de compliance: **elimina de entrada varias tácticas que
en cualquier otro rubro serían lo primero que recomendarías**.

Queda afuera:
- Listas de remarketing armadas desde páginas que revelan una condición (la
  landing de "tratamiento de fertilidad", la de oncología, la de adicciones).
- Audiencias personalizadas construidas con términos de condiciones o
  tratamientos.
- Customer Match a partir de una base de pacientes de una especialidad.

Qué sí se puede, en general:
- Segmentar por **ubicación**, que en un consultorio local hace la mayor parte
  del trabajo.
- Remarketing desde páginas **neutras**: home, "sobre el equipo", contacto,
  aranceles. La distinción es si la página revela o no una condición de quien
  la visitó.
- Buscar por **intención en el momento**: alguien que busca "turno con
  cardiólogo" está declarando intención en la consulta, que no es lo mismo
  que Google clasificarlo por su salud.

La línea práctica: la publicidad de búsqueda responde a lo que la persona
escribe ahora; la segmentación por audiencia infiere lo que la persona es. En
salud lo primero es viable y lo segundo está restringido.

## 2. Datos de pacientes: no salen de la clínica

Conversiones mejoradas, Customer Match y las importaciones de conversiones
offline funcionan enviando datos del usuario, aunque vayan con hash. Con
pacientes eso significa mover datos de salud a un tercero.

Criterio:
- No subas listas de pacientes ni cruces datos clínicos con la cuenta de Ads.
- Antes de activar conversiones mejoradas en un sitio de salud, que lo mire
  quien lleve el tema legal o de datos personales.
- Cuidado con los formularios: si el campo "motivo de consulta" viaja en la
  URL o al evento de conversión, estás mandando dato clínico a Google sin
  querer. Es el error técnico más común y el más fácil de pasar por alto.
- En EE.UU. esto cae bajo HIPAA. Fuera de EE.UU. suele haber una ley de datos
  personales con categoría especial para datos de salud. El criterio de
  minimizar es el mismo en todos lados.

## 3. Servicios restringidos y certificaciones

Según el país, hay servicios que exigen certificación previa, quedan limitados
a determinados anunciantes o no se pueden anunciar:

- Medicamentos de venta bajo receta y farmacias en línea.
- Tratamiento de adicciones (suele exigir certificación de un tercero).
- Reclutamiento para estudios clínicos.
- Tratamientos con evidencia discutida o promesas de cura.
- Según jurisdicción: fertilidad, terminación del embarazo, estética invasiva,
  células madre.

Antes de planificar una cuenta para una especialidad de esta lista, verificá
disponibilidad y requisitos **para el país de destino**, no para el país del
anunciante. Un servicio anunciable en un país puede estar vedado en el vecino.

## 4. Cómo se cae una cuenta

Los rechazos aislados se corrigen. Lo que suspende cuentas es la reincidencia
y las políticas de tergiversación.

Bandera roja en el texto de los anuncios y en la landing:
- Prometer resultados o curación ("elimina la artrosis", "resultados
  garantizados").
- Testimonios de pacientes presentados como resultado típico.
- Sugerir urgencia o miedo sobre la salud del usuario.
- Títulos de especialidad o matrículas que el profesional no tiene: en salud
  esto además es un problema con el colegio profesional, no solo con Google.

La landing importa tanto como el anuncio: Google evalúa el destino. Una landing
con promesas que el anuncio no hace igual te rechaza el anuncio.

## 5. Marco local, que Google no cubre

La política de Google es un piso, no el techo. La publicidad de servicios de
salud suele estar regulada además por la autoridad sanitaria nacional y por el
colegio o consejo profesional, con reglas propias sobre que se puede prometer,
como se exhibe la matrícula y si se pueden publicar aranceles o testimonios.

Cuando el usuario esté en un país concreto, decilo explícitamente: "esto
cumple la política de Google, falta chequear la normativa de tu jurisdicción y
la de tu colegio profesional". No inventes el contenido de esa normativa.
