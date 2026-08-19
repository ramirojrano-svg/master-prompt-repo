// app/panel/[slug]/reportes/Graficos.tsx — los gráficos de las métricas, en SVG inline.
//
// SVG a mano y no una librería de charts: entra un paquete de ~200 kB al bundle para dibujar
// cuatro barras, y el proyecto ya decidió no traer dependencias de presentación (la misma razón
// por la que los íconos son SVG inline y no una fuente remota).
//
// SOBRE EL 3D. Las barras son isométricas: cada una se extruye con la MISMA profundidad y sin
// perspectiva. Eso importa — un 3D con fuga hace que la barra de adelante se vea más grande que
// una de atrás del mismo valor, y entonces el dibujo miente. Acá la altura de la cara frontal
// sigue siendo proporcional al valor y las barras se pueden comparar a ojo sin error.
// Por lo mismo la torta es un anillo con relieve y NO una torta inclinada: al inclinarla, las
// porciones de adelante se agrandan y las del fondo se achican, así que dos porciones iguales
// dejan de verse iguales. El relieve da volumen sin tocar los ángulos.
//
// COLORES. La paleta MOCA cruda no sirve como paleta de SERIES: su turquesa y su verde quedan a
// ΔE 9,6 para visión normal (el piso legible es 15), o sea que dos consultorios distintos se ven
// del mismo color. Esta es la versión separada, con azul/turquesa/verde de la marca en los tres
// primeros lugares —que son los que casi siempre se usan— y complementos para el resto.
// Verificada con el validador: pasa banda de luminosidad, croma, separación para daltonismo y
// piso de visión normal.

export const SERIES: string[] = ["#1a6fae", "#19b7c9", "#0e8a5f", "#6d54c8", "#c14d78", "#b07216"];

/** El color de la serie i. Los colores se asignan en ORDEN FIJO y se repiten al agotarse: nunca
 *  se genera un tono nuevo, porque un séptimo color inventado no está validado contra los otros. */
const colorDe = (i: number): string => SERIES[i % SERIES.length]!;

/** Aclara u oscurece un color para las caras del volumen. Sin dependencias: mezcla en sRGB. */
function tono(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mezcla = (c: number) => Math.round(factor > 0 ? c + (255 - c) * factor : c * (1 + factor));
  return `#${[16, 8, 0].map((s) => mezcla((n >> s) & 255).toString(16).padStart(2, "0")).join("")}`;
}

export type Dato = { etiqueta: string; valor: number; texto: string };

/**
 * Barras verticales con volumen. `texto` es lo que se escribe arriba de cada barra: el número ya
 * formateado por el servidor (pesos, horas), porque el gráfico no decide formatos.
 */
export function BarrasVolumen({ datos, alto = 240 }: { datos: Dato[]; alto?: number }) {
  if (datos.length === 0) return null;

  const P = 16; // profundidad de la extrusión, igual para todas
  const ANCHO_BARRA = 54;
  const SEPARACION = 30;
  const MARGEN_SUP = 34; // el valor va arriba de la barra más alta
  const MARGEN_INF = 46; // etiquetas al pie
  const w = datos.length * (ANCHO_BARRA + SEPARACION) + SEPARACION + P;
  const h = alto + MARGEN_SUP + MARGEN_INF;
  const base = alto + MARGEN_SUP;
  const max = Math.max(...datos.map((d) => d.valor), 1);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
        {/* Piso: da apoyo al volumen y hace de línea de base del eje. */}
        <path d={`M0 ${base} L${w - P} ${base} L${w} ${base - P} L${P} ${base - P} Z`} fill="var(--panel-2)" />
        <line x1={0} y1={base} x2={w - P} y2={base} stroke="var(--borde-fuerte)" strokeWidth={1} />

        {datos.map((d, i) => {
          const color = colorDe(i);
          const altura = Math.max(2, (d.valor / max) * (alto - 8));
          const x = SEPARACION + i * (ANCHO_BARRA + SEPARACION);
          const y = base - altura;
          return (
            <g key={d.etiqueta}>
              {/* cara superior (más clara) */}
              <path d={`M${x} ${y} L${x + P} ${y - P} L${x + ANCHO_BARRA + P} ${y - P} L${x + ANCHO_BARRA} ${y} Z`} fill={tono(color, 0.3)} />
              {/* cara lateral (más oscura) */}
              <path
                d={`M${x + ANCHO_BARRA} ${y} L${x + ANCHO_BARRA + P} ${y - P} L${x + ANCHO_BARRA + P} ${base - P} L${x + ANCHO_BARRA} ${base} Z`}
                fill={tono(color, -0.28)}
              />
              {/* cara frontal: ES la que codifica el valor */}
              <rect x={x} y={y} width={ANCHO_BARRA} height={altura} fill={color} />

              {/* El número va SIEMPRE escrito: el turquesa no llega a 3:1 contra el fondo, y con
                  la etiqueta a la vista el dato no depende de distinguir el color. */}
              <text x={x + ANCHO_BARRA / 2 + P / 2} y={y - P - 9} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--texto)">
                {d.texto}
              </text>
              <text x={x + ANCHO_BARRA / 2} y={base + 18} textAnchor="middle" fontSize={11} fill="var(--tenue)">
                {d.etiqueta.length > 14 ? `${d.etiqueta.slice(0, 13)}…` : d.etiqueta}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * Anillo de participación con relieve. Sin inclinación: los ángulos son exactos, así que dos
 * porciones iguales se ven iguales (ver la nota de arriba sobre el 3D).
 */
export function AnilloVolumen({ datos, alto = 240 }: { datos: Dato[]; alto?: number }) {
  const total = datos.reduce((a, d) => a + d.valor, 0);
  if (total <= 0) return null;

  const R = alto / 2 - 14;
  const r = R * 0.58;
  const cx = alto / 2;
  const cy = alto / 2;
  const RELIEVE = 10; // grosor del borde inferior que da el volumen

  let acumulado = 0;
  const porciones = datos.map((d, i) => {
    const desde = (acumulado / total) * Math.PI * 2 - Math.PI / 2;
    acumulado += d.valor;
    const hasta = (acumulado / total) * Math.PI * 2 - Math.PI / 2;
    return { ...d, desde, hasta, color: colorDe(i), pct: Math.round((d.valor / total) * 100) };
  });

  const arco = (desde: number, hasta: number, dy = 0) => {
    const largo = hasta - desde > Math.PI ? 1 : 0;
    return [
      `M${cx + R * Math.cos(desde)} ${cy + R * Math.sin(desde) + dy}`,
      `A${R} ${R} 0 ${largo} 1 ${cx + R * Math.cos(hasta)} ${cy + R * Math.sin(hasta) + dy}`,
      `L${cx + r * Math.cos(hasta)} ${cy + r * Math.sin(hasta) + dy}`,
      `A${r} ${r} 0 ${largo} 0 ${cx + r * Math.cos(desde)} ${cy + r * Math.sin(desde) + dy}`,
      "Z",
    ].join(" ");
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
      <svg viewBox={`0 0 ${alto} ${alto + RELIEVE}`} width={alto} height={alto + RELIEVE} role="img" style={{ flexShrink: 0 }}>
        {/* Primero el canto (mismas porciones, corridas hacia abajo y oscurecidas): es lo que da
            el volumen sin mover un solo ángulo. */}
        {porciones.map((p) => (
          <path key={`canto-${p.etiqueta}`} d={arco(p.desde, p.hasta, RELIEVE)} fill={tono(p.color, -0.35)} />
        ))}
        {porciones.map((p) => (
          <path key={p.etiqueta} d={arco(p.desde, p.hasta)} fill={p.color} stroke="var(--panel)" strokeWidth={2} />
        ))}
      </svg>

      {/* Leyenda con el porcentaje escrito: la identidad nunca queda solo en el color. */}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 7, minWidth: 180, flex: 1 }}>
        {porciones.map((p) => (
          <li key={p.etiqueta} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13 }}>
            <span aria-hidden style={{ width: 12, height: 12, borderRadius: 3, background: p.color, flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.etiqueta}</span>
            <span className="tenue num" style={{ fontSize: 12 }}>{p.texto}</span>
            <strong style={{ width: 38, textAlign: "right" }}>{p.pct}%</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type Grupo = {
  etiqueta: string;
  /** Un valor por serie, en el mismo orden que `series`. */
  valores: number[];
  /** Los mismos valores ya formateados, para el globito. */
  textos: string[];
  /** Línea al pie de la columna (acá: el resultado del mes). */
  pie?: string;
  pieColor?: string;
};

/**
 * Barras AGRUPADAS con el mismo volumen isométrico que `BarrasVolumen`: varias series por
 * categoría, una al lado de la otra.
 *
 * Existe porque el gráfico de los seis meses estaba dibujado aparte con divs y bordes CSS, y en la
 * misma pantalla que estos convivían dos lenguajes visuales distintos para decir lo mismo. Ahora la
 * regla del 3D —extrusión pareja, sin fuga— vale para todos los gráficos, que es lo que permite
 * comparar alturas a ojo sin que el dibujo mienta.
 *
 * La separación DENTRO del grupo es mayor que la profundidad de la extrusión a propósito: si fuera
 * menor, el volumen de una barra taparía a su vecina y la de la derecha se vería más baja de lo que
 * es.
 */
export function BarrasVolumenAgrupadas({
  grupos,
  series,
  alto = 190,
}: {
  grupos: Grupo[];
  /** Nombre y color de cada serie. El color se pasa explícito: acá el orden no es "el i-ésimo dato"
   *  sino un significado fijo (facturado / gastos) que no puede cambiar según cuántos meses haya. */
  series: { nombre: string; color: string }[];
  alto?: number;
}) {
  if (grupos.length === 0 || series.length === 0) return null;

  const P = 12; // profundidad de la extrusión
  const ANCHO_BARRA = 26;
  const HUECO = 14; // dentro del grupo; > P para que un volumen no tape al de al lado
  const SEPARACION = 26; // entre grupos
  const MARGEN_SUP = 26;
  const MARGEN_INF = 44; // dos renglones al pie: el mes y el resultado
  const anchoGrupo = series.length * ANCHO_BARRA + (series.length - 1) * HUECO;
  const w = grupos.length * (anchoGrupo + SEPARACION) + SEPARACION + P;
  const h = alto + MARGEN_SUP + MARGEN_INF;
  const base = alto + MARGEN_SUP;
  // El máximo se toma sobre TODAS las series juntas: con una escala por serie, gastos y facturado
  // se dibujarían con la misma altura aunque uno sea el doble del otro.
  const max = Math.max(...grupos.flatMap((g) => g.valores), 1);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
        <path d={`M0 ${base} L${w - P} ${base} L${w} ${base - P} L${P} ${base - P} Z`} fill="var(--panel-2)" />
        <line x1={0} y1={base} x2={w - P} y2={base} stroke="var(--borde-fuerte)" strokeWidth={1} />

        {grupos.map((g, gi) => {
          const x0 = SEPARACION + gi * (anchoGrupo + SEPARACION);
          return (
            <g key={g.etiqueta}>
              {series.map((s, si) => {
                const valor = g.valores[si] ?? 0;
                // Altura 0 para el valor 0, no un mínimo de 2px: un mes sin gastos tiene que
                // verse vacío, no con una rayita que se confunde con "poquito".
                const altura = valor <= 0 ? 0 : Math.max(2, (valor / max) * (alto - 8));
                const x = x0 + si * (ANCHO_BARRA + HUECO);
                const y = base - altura;
                if (altura === 0) return null;
                return (
                  <g key={s.nombre}>
                    <title>{`${s.nombre} ${g.etiqueta}: ${g.textos[si] ?? ""}`}</title>
                    <path d={`M${x} ${y} L${x + P} ${y - P} L${x + ANCHO_BARRA + P} ${y - P} L${x + ANCHO_BARRA} ${y} Z`} fill={tono(s.color, 0.3)} />
                    <path
                      d={`M${x + ANCHO_BARRA} ${y} L${x + ANCHO_BARRA + P} ${y - P} L${x + ANCHO_BARRA + P} ${base - P} L${x + ANCHO_BARRA} ${base} Z`}
                      fill={tono(s.color, -0.28)}
                    />
                    <rect x={x} y={y} width={ANCHO_BARRA} height={altura} fill={s.color} />
                  </g>
                );
              })}

              <text x={x0 + anchoGrupo / 2} y={base + 17} textAnchor="middle" fontSize={11} fill="var(--tenue)">
                {g.etiqueta}
              </text>
              {g.pie && (
                <text x={x0 + anchoGrupo / 2} y={base + 33} textAnchor="middle" fontSize={11} fontWeight={600} fill={g.pieColor ?? "var(--texto)"}>
                  {g.pie}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
