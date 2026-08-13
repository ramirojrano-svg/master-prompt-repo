// app/panel/[slug]/Grilla.tsx — la vista día multi-sala (§6.4). Columnas = salas, filas = tiempo.
// El componente NO calcula posiciones: todo viene ubicado desde `ubicarBloques` (función pura y
// testeada). CSS Grid con filas por paso; nada de `position:absolute` con top en píxeles, que se
// desincroniza al hacer zoom.

import type { DiaVista } from "../../../src/servicios/agenda/dia.ts";
import { minutosAHora } from "../../../src/dominio/motor/zona.ts";

const ALTO_CELDA = 32; // px por paso (30') en desktop

function etiquetaHoras(aperturaMin: number, cierreMin: number, paso: number): { min: number; texto: string }[] {
  const out: { min: number; texto: string }[] = [];
  for (let m = aperturaMin; m < cierreMin; m += paso) {
    out.push({ min: m, texto: m % 60 === 0 ? minutosAHora(m) : "" });
  }
  return out;
}

export function Grilla({ dia }: { dia: DiaVista }) {
  const horas = etiquetaHoras(dia.aperturaMin, dia.cierreMin, dia.pasoMin);
  const porId = new Map(dia.reservas.map((r) => [r.id, r]));

  if (dia.salas.length === 0) {
    // Estado vacío con la acción que lo resuelve (§6.16): la grilla no se renderiza vacía.
    return (
      <div className="panel">
        <h3>Todavía no cargaste ninguna sala</h3>
        <p className="tenue">Sin salas no hay agenda. Cargá tu primera sala para ver la grilla del día.</p>
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `44px repeat(${dia.salas.length}, minmax(132px, 1fr))`,
          minWidth: 44 + dia.salas.length * 132,
        }}
      >
        {/* Cabecera de salas (sticky arriba) */}
        <div style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--fondo)" }} />
        {dia.salas.map((s) => (
          <div
            key={s.id}
            style={{
              position: "sticky", top: 0, zIndex: 2, background: "var(--fondo)",
              padding: "6px 8px", fontWeight: 600, borderBottom: "1px solid var(--borde)",
              borderLeft: `3px solid ${s.color}`,
            }}
          >
            {s.nombre} {!s.activa && <span className="tenue">(archivada)</span>}
          </div>
        ))}

        {/* Eje horario (sticky a la izquierda) + una celda de fondo por sala/fila */}
        <div
          style={{
            position: "sticky", left: 0, zIndex: 1, background: "var(--fondo)",
            display: "grid", gridTemplateRows: `repeat(${dia.filas}, ${ALTO_CELDA}px)`,
          }}
        >
          {horas.map((h) => (
            <div key={h.min} style={{ fontSize: 11, color: "var(--tenue)", textAlign: "right", paddingRight: 6, transform: "translateY(-6px)" }}>
              {h.texto}
            </div>
          ))}
        </div>

        {dia.salas.map((sala) => {
          const bloques = dia.ubicaciones.filter((u) => u.columnaId === sala.id);
          const carriles = bloques[0]?.carriles ?? 1;
          return (
            <div
              key={sala.id}
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
                const conIdentidad = "inquilinoNombre" in r ? r : null;
                const esBloqueo = conIdentidad?.tipo === "mantenimiento" || conIdentidad?.tipo === "bloqueo";
                const titulo = conIdentidad?.inquilinoNombre ?? conIdentidad?.motivo ?? "Ocupado";
                return (
                  <div
                    key={u.id}
                    title={titulo}
                    aria-label={`${sala.nombre}, ${titulo}`}
                    style={{
                      gridRow: `${u.fila} / span ${u.span}`,
                      gridColumn: `${u.carril + 1} / span 1`,
                      // altura mínima táctil (44px, WCAG 2.5.5) aunque el bloque sea de 15'
                      minHeight: 44,
                      margin: "1px 2px",
                      padding: "3px 6px",
                      borderRadius: 6,
                      fontSize: 12,
                      overflow: "hidden",
                      color: "#fff",
                      background: esBloqueo ? "var(--tenue)" : sala.color,
                      backgroundImage: esBloqueo
                        ? "repeating-linear-gradient(45deg, rgba(255,255,255,.25) 0 6px, transparent 6px 12px)"
                        : undefined,
                      borderTop: u.recortadoArriba ? "2px dotted #fff" : undefined,
                      borderBottom: u.recortadoAbajo ? "2px dotted #fff" : undefined,
                      userSelect: "none",
                    }}
                  >
                    {titulo}
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
