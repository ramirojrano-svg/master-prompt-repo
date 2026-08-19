// app/panel/[slug]/VistaMes.tsx — la vista mes: 6 semanas × 7 días con los turnos como chips.
//
// La grilla es SIEMPRE de 6 filas (lo garantiza `diasDeVista`), así la pantalla no salta de alto
// al cambiar de mes. Cada celda muestra hasta 3 turnos y, si hay más, un "+N más" que lleva al
// día — nunca se recortan turnos en silencio.

import Link from "next/link";
import type { AgendaVista } from "../../../src/servicios/agenda/dia.ts";
import { DIA_CORTO, nombreCorto } from "../../../src/dominio/calendario.ts";

const MAX_CHIPS = 3;

export function VistaMes({
  dia,
  hoy,
  href,
}: {
  dia: AgendaVista;
  hoy: string;
  href: (fecha: string, extra?: Record<string, string>) => string;
}) {
  // Un solo agrupamiento por día; el orden viene del servidor (por hora de inicio).
  const porDia = new Map<string, AgendaVista["reservas"]>();
  for (const r of dia.reservas) {
    const lista = porDia.get(r.fechaLocal) ?? [];
    lista.push(r);
    porDia.set(r.fechaLocal, lista);
  }
  const mesAncla = dia.fecha.slice(0, 7);
  const semanas = Array.from({ length: 6 }, (_, s) => dia.dias.slice(s * 7, s * 7 + 7));

  return (
    <div className="mes" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - var(--barra) - 58px)" }}>
      <div className="mes-encabezado" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--borde)" }}>
        {DIA_CORTO.map((d) => (
          <div key={d} className="tenue" style={{ padding: "8px 0", textAlign: "center", fontSize: 11, letterSpacing: "0.04em" }}>
            {/* En el teléfono la inicial alcanza: la posición ya dice qué día es, y "DOM" ocupa el
                ancho de la celda para repetirlo. El nombre corto vuelve en cuanto hay lugar. */}
            <span className="oculta-mobile">{d}</span>
            <span className="solo-mobile">{d.slice(0, 1)}</span>
          </div>
        ))}
      </div>

      <div className="mes-grilla" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gridTemplateRows: "repeat(6, 1fr)", flex: 1, minHeight: 520 }}>
        {semanas.flatMap((semana) =>
          semana.map((f) => {
            const delMes = f.slice(0, 7) === mesAncla;
            const esHoy = f === hoy;
            const lista = porDia.get(f) ?? [];
            const visibles = lista.slice(0, MAX_CHIPS);
            const resto = lista.length - visibles.length;
            return (
              <div
                key={f}
                className="mes-celda"
                style={{
                  borderRight: "1px solid var(--borde)",
                  borderBottom: "1px solid var(--borde)",
                  padding: "4px 5px",
                  minWidth: 0,
                  overflow: "hidden",
                  background: delMes ? "var(--panel)" : "var(--panel-2)",
                }}
              >
                <div style={{ textAlign: "center", marginBottom: 3 }}>
                  <Link
                    href={href(f, { vista: "dia" })}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: 24,
                      height: 24,
                      borderRadius: "50%",
                      fontSize: 12,
                      fontWeight: esHoy ? 600 : 400,
                      background: esHoy ? "var(--marca-500)" : "transparent",
                      color: esHoy ? "#fff" : delMes ? "var(--texto)" : "var(--tenue)",
                      textDecoration: "none",
                    }}
                  >
                    {Number(f.slice(8, 10))}
                  </Link>
                </div>

                {visibles.map((r) => (
                  <div
                    key={r.id}
                    className="evento mes-chip"
                    title={`${r.titulo} · ${r.horaTexto} · ${r.salaNombre}`}
                    style={{
                      background: r.esBloqueo ? "var(--tenue)" : r.color,
                      backgroundImage: r.esBloqueo
                        ? "repeating-linear-gradient(45deg, rgba(255,255,255,.25) 0 5px, transparent 5px 10px)"
                        : undefined,
                      marginBottom: 2,
                      fontSize: 11,
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {/* La hora se apaga en pantallas chicas: en una celda de 46px no entra, y lo
                        que se busca de un vistazo es QUIÉN, no a qué hora. La hora completa sigue
                        estando en el tooltip y en la vista del día. */}
                    <span className="oculta-mobile">{r.horaTexto.slice(0, 5)} </span>
                    <b>{nombreCorto(r.titulo)}</b>
                  </div>
                ))}

                {/* Nunca se recortan turnos en silencio: si hay más, se dice cuántos. */}
                {resto > 0 && (
                  <Link href={href(f, { vista: "dia" })} className="tenue mes-resto" style={{ fontSize: 11, fontWeight: 500 }}>
                    +{resto} más
                  </Link>
                )}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
