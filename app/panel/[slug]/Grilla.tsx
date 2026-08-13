// app/panel/[slug]/Grilla.tsx — la grilla de tiempo: vista DÍA (columnas = salas) y vista SEMANA
// (columnas = días). El componente NO calcula posiciones: todo viene ubicado desde `ubicarBloques`
// (función pura y testeada). CSS Grid con filas por paso; nada de `position:absolute` con top en
// píxeles, que se desincroniza al hacer zoom.

import type { AgendaVista } from "../../../src/servicios/agenda/dia.ts";
import { minutosAHora } from "../../../src/dominio/motor/zona.ts";
import { formatearPesos } from "../../../src/dominio/tarifa.ts";
import { DIA_CORTO, nombreCorto } from "../../../src/dominio/calendario.ts";
import { diaSemanaDeFecha } from "../../../src/dominio/motor/zona.ts";

const ALTO_CELDA = 30; // px por paso (30')

export function Grilla({ dia, hoy }: { dia: AgendaVista; hoy: string }) {
  if (dia.salas.length === 0) {
    // Estado vacío con la acción que lo resuelve (§6.16): la grilla no se renderiza vacía.
    return (
      <div className="panel" style={{ margin: 16 }}>
        <h3 style={{ marginTop: 0 }}>Todavía no cargaste ninguna sala</h3>
        <p className="tenue">Sin salas no hay agenda. Cargá tu primer consultorio para ver la grilla.</p>
      </div>
    );
  }

  // Las columnas: salas en vista día, días en vista semana.
  const columnas =
    dia.vista === "semana"
      ? dia.dias.map((f) => ({ id: f, titulo: `${DIA_CORTO[diaSemanaDeFecha(f) ?? 0]}`, sub: String(Number(f.slice(8, 10))), esHoy: f === hoy, color: null as string | null }))
      : dia.salas
          .filter((s) => dia.salasVisibles.includes(s.id))
          .map((s) => ({ id: s.id, titulo: s.nombre, sub: s.activa ? "" : "archivada", esHoy: false, color: s.color }));

  const horas: number[] = [];
  for (let m = dia.aperturaMin; m < dia.cierreMin; m += 60) horas.push(m);
  const porId = new Map(dia.reservas.map((r) => [r.id, r]));
  const anchoEje = 56;

  return (
    <div style={{ overflow: "auto", maxHeight: "calc(100vh - var(--barra) - 58px)" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `${anchoEje}px repeat(${columnas.length}, minmax(120px, 1fr))`,
          minWidth: anchoEje + columnas.length * 120,
        }}
      >
        {/* ── Cabecera (sticky) ──────────────────────────────────────────── */}
        <div style={{ position: "sticky", top: 0, zIndex: 3, background: "var(--panel)", borderBottom: "1px solid var(--borde)" }} />
        {columnas.map((c) => (
          <div
            key={c.id}
            style={{
              position: "sticky",
              top: 0,
              zIndex: 3,
              background: "var(--panel)",
              borderBottom: "1px solid var(--borde)",
              borderLeft: "1px solid var(--borde)",
              padding: "8px 10px 6px",
              textAlign: dia.vista === "semana" ? "center" : "left",
            }}
          >
            {dia.vista === "semana" ? (
              <>
                <div className="tenue" style={{ fontSize: 11, letterSpacing: "0.04em" }}>{c.titulo}</div>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    fontSize: 19,
                    fontWeight: 500,
                    marginTop: 2,
                    background: c.esHoy ? "var(--marca-500)" : "transparent",
                    color: c.esHoy ? "#fff" : "var(--texto)",
                  }}
                >
                  {c.sub}
                </div>
              </>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 14 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: c.color ?? "var(--marca-500)" }} />
                {c.titulo} {c.sub && <span className="tenue" style={{ fontWeight: 400 }}>({c.sub})</span>}
              </div>
            )}
          </div>
        ))}

        {/* ── Eje horario (sticky a la izquierda) ────────────────────────── */}
        <div
          style={{
            position: "sticky",
            left: 0,
            zIndex: 2,
            background: "var(--panel)",
            display: "grid",
            gridTemplateRows: `repeat(${dia.filas}, ${ALTO_CELDA}px)`,
          }}
        >
          {Array.from({ length: dia.filas }, (_, i) => {
            const min = dia.aperturaMin + i * dia.pasoMin;
            return (
              <div key={min} style={{ position: "relative" }}>
                {min % 60 === 0 && (
                  <span
                    className="tenue"
                    style={{
                      position: "absolute",
                      right: 8,
                      // la primera etiqueta NO se sube: se cortaría contra el borde de la grilla
                      top: i === 0 ? 0 : -7,
                      fontSize: 11,
                      background: "var(--panel)",
                      paddingLeft: 4,
                    }}
                  >
                    {minutosAHora(min)}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Una columna de bloques por sala (o por día) ─────────────────── */}
        {columnas.map((col) => {
          const bloques = dia.ubicaciones.filter((u) => u.columnaId === col.id);
          const carriles = bloques[0]?.carriles ?? 1;
          return (
            <div
              key={col.id}
              style={{
                display: "grid",
                gridTemplateRows: `repeat(${dia.filas}, ${ALTO_CELDA}px)`,
                gridTemplateColumns: `repeat(${carriles}, 1fr)`,
                borderLeft: "1px solid var(--borde)",
                background: `repeating-linear-gradient(to bottom, transparent 0 ${ALTO_CELDA - 1}px, var(--borde) ${ALTO_CELDA - 1}px ${ALTO_CELDA}px)`,
              }}
            >
              {bloques.map((u) => {
                const r = porId.get(u.id);
                if (!r) return null;
                // El importe ya viene PROYECTADO: si el que mira no puede ver plata, llega null.
                // Acá no se decide nada de privacidad, solo se muestra lo que el servidor mandó.
                const conPlata = "importeCent" in r ? r.importeCent : null;
                const importe = conPlata ? formatearPesos(BigInt(conPlata), dia.moneda) : null;
                return (
                  <div
                    key={u.id}
                    className="evento"
                    title={[r.titulo, r.horaTexto, dia.vista === "semana" ? r.salaNombre : null, importe].filter(Boolean).join(" · ")}
                    aria-label={`${r.salaNombre}, ${r.titulo}, ${r.horaTexto}`}
                    style={{
                      gridRow: `${u.fila} / span ${u.span}`,
                      // col/colSpan vienen calculados: un bloque solo ocupa TODO el ancho de la
                      // columna; los solapados se reparten (§6.4).
                      gridColumn: `${u.col} / span ${u.colSpan}`,
                      // altura mínima táctil (44px, WCAG 2.5.5) aunque el bloque sea de 15'
                      minHeight: 44,
                      margin: "1px 2px",
                      background: r.esBloqueo ? "var(--tenue)" : r.color,
                      backgroundImage: r.esBloqueo
                        ? "repeating-linear-gradient(45deg, rgba(255,255,255,.25) 0 6px, transparent 6px 12px)"
                        : undefined,
                      borderTop: u.recortadoArriba ? "2px dotted #fff" : undefined,
                      // bloque corto dibujado más alto que su duración: borde punteado (§6.5)
                      borderBottom: u.recortadoAbajo || u.estirado ? "2px dotted #fff" : undefined,
                    }}
                  >
                    {/* Si el bloque comparte la columna con otro, el nombre entero no entra:
                        se muestra corto y el completo queda en el tooltip y en el aria-label. */}
                    <b>{u.colSpan < u.carriles ? nombreCorto(r.titulo) : r.titulo}</b>
                    {u.span > 1 && <div style={{ opacity: 0.9, fontSize: 11 }}>{r.horaTexto}</div>}
                    {u.span > 2 && dia.vista === "semana" && <div style={{ opacity: 0.9, fontSize: 11 }}>{r.salaNombre}</div>}
                    {u.span > 2 && importe && <div style={{ opacity: 0.9, fontSize: 11 }}>{importe}</div>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
