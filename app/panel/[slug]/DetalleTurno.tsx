// app/panel/[slug]/DetalleTurno.tsx — el turno que se clickeó, con lo que se puede hacerle.
//
// Cerraba el ciclo que faltaba: se podía crear un turno y moverlo, pero no darlo de baja ni
// marcar que el profesional no vino. Un turno que no iba a ocurrir seguía ocupando la sala y
// facturado, y la única salida era la base de datos.
//
// Vive en la URL (`?turno=<id>`) y no en un estado de cliente: así el botón "atrás" lo cierra,
// el link del turno se puede mandar, y el panel funciona aunque el JavaScript no cargue. Las
// acciones son <form> con server actions, por la misma razón.

import Link from "next/link";
import type { EventoAgenda } from "../../../src/servicios/agenda/dia.ts";
import { formatearPesos } from "../../../src/dominio/tarifa.ts";
import { horasYMinutos } from "../../../src/dominio/reporte.ts";

/** Rótulo humano del estado. El crudo de la base ("no_show") no se le muestra a nadie. */
const ROTULO: Record<string, string> = {
  confirmada: "Confirmado",
  en_curso: "En curso",
  usada: "Usado",
  no_show: "No vino",
  cancelada: "Cancelado",
  reubicada: "Movido",
};

export function DetalleTurno({
  turno,
  moneda,
  cerrarHref,
  puedeEditar,
  cancelar,
  editar,
  salas,
  error,
}: {
  turno: EventoAgenda;
  moneda: string;
  cerrarHref: string;
  puedeEditar: boolean;
  cancelar: (fd: FormData) => Promise<void>;
  editar: (fd: FormData) => Promise<void>;
  /** Los consultorios activos, para poder mover el turno de sala desde acá. */
  salas: { id: string; nombre: string }[];
  error?: string;
}) {
  // `estado` y `motivo` solo existen en la proyección de quien ve identidad; para el resto el
  // turno es un "ocupado" sin más, y no hay nada que ofrecer.
  const estado = "tipo" in turno ? turno.estado : "ocupado";
  const motivo = "motivo" in turno ? turno.motivo : null;
  const minutos = Math.round((new Date(turno.fin).getTime() - new Date(turno.inicio).getTime()) / 60_000);
  // `serieId` solo existe en la proyección con identidad; para el resto no hay nada que preguntar.
  const esSerie = "serieId" in turno && turno.serieId != null;

  // Un turno cancelado o ya movido es historia: se muestra, no se opera.
  const vivo = estado === "confirmada" || estado === "no_show";
  const acciones = puedeEditar && vivo && !turno.esBloqueo;

  return (
    <aside
      aria-label="Detalle del turno"
      style={{
        position: "fixed",
        top: "calc(var(--barra) + 12px)",
        right: 16,
        zIndex: 40,
        width: "min(340px, calc(100vw - 32px))",
        background: "var(--panel)",
        border: "1px solid var(--borde)",
        borderRadius: "var(--radio)",
        boxShadow: "var(--sombra-alta)",
        padding: 18,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span aria-hidden style={{ width: 12, height: 12, borderRadius: 3, background: turno.color, marginTop: 5, flexShrink: 0 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>{turno.titulo}</h2>
          <p className="tenue" style={{ margin: "2px 0 0", fontSize: 13 }}>
            {turno.horaTexto} · {horasYMinutos(minutos)}
          </p>
        </div>
        <Link href={cerrarHref} aria-label="Cerrar" className="nav-circ" style={{ marginTop: -4, marginRight: -6 }}>
          ×
        </Link>
      </div>

      <dl style={{ margin: "14px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", fontSize: 13 }}>
        <dt className="tenue">Consultorio</dt>
        <dd style={{ margin: 0 }}>{turno.salaNombre}</dd>
        <dt className="tenue">Estado</dt>
        <dd style={{ margin: 0 }}>{ROTULO[estado] ?? "Ocupado"}</dd>
        {motivo && (
          <>
            <dt className="tenue">Motivo</dt>
            <dd style={{ margin: 0 }}>{motivo}</dd>
          </>
        )}
      </dl>

      {error && <p className="error" style={{ marginBottom: 0, fontSize: 13 }}>{error}</p>}

      {acciones && (
        <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
          {/* Editar = cambiar CUÁNDO y DÓNDE. Es lo que se necesita apenas se agenda algo y se ve
              que iba media hora después, y hasta ahora la única forma era arrastrar el bloque —que
              no existe en el teléfono, donde justamente se agenda a las apuradas.
              Va detrás de un <details> para no llenar el panel de campos: lo normal al abrir un
              turno es mirarlo, no editarlo. */}
          <details data-burbuja>
            <summary className="btn-suave" style={{ width: "100%", textAlign: "center", borderRadius: 999, padding: "10px 18px", cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, listStyle: "none" }}>
              Editar turno
            </summary>
            <form action={editar} style={{ marginTop: 10 }}>
              <input type="hidden" name="ocupacionId" value={turno.id} />

              <label htmlFor="ed-sala" style={{ marginTop: 0 }}>Consultorio</label>
              <select id="ed-sala" name="salaDestinoId" required defaultValue={turno.salaId ?? ""}>
                {salas.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>

              <label htmlFor="ed-fecha">Día</label>
              <input id="ed-fecha" name="fecha" type="date" required defaultValue={turno.fechaLocal} />

              <label htmlFor="ed-hora">Empieza</label>
              <input id="ed-hora" name="hora" type="time" required step={900} defaultValue={turno.horaTexto.slice(0, 5)} />

              <p className="tenue" style={{ margin: "8px 0 0", fontSize: 12 }}>
                Dura {minutos} minutos y se conserva: mover un turno no lo estira.
              </p>

              <p style={{ marginTop: 12, marginBottom: 0 }}>
                <button type="submit" style={{ width: "100%" }}>Guardar cambios</button>
              </p>
            </form>
          </details>

          {estado === "confirmada" && (
            <form action={cancelar}>
              <input type="hidden" name="ocupacionId" value={turno.id} />

              {/* Si es parte de una serie hay que PREGUNTAR el alcance, como cualquier calendario:
                  sin la pregunta, "cancelar" o deja cincuenta turnos que nadie quiere, o se lleva
                  puestos los que ya pasaron. El default es el más chico —solo este—: el alcance
                  amplio se elige a propósito, nunca se asume. */}
              {esSerie && (
                <fieldset style={{ border: "none", padding: 0, margin: "4px 0 12px" }}>
                  <legend className="tenue" style={{ fontSize: 12, padding: 0, marginBottom: 6 }}>
                    Este turno se repite. ¿Qué cancelás?
                  </legend>
                  {[
                    { v: "solo", t: "Solo este turno" },
                    { v: "siguientes", t: "Este y los siguientes" },
                    { v: "serie", t: "Todos los de la serie" },
                  ].map((o, i) => (
                    <label key={o.v} htmlFor={`alcance-${o.v}`} style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 4px", fontSize: 13, color: "var(--texto)", fontWeight: 400 }}>
                      <input id={`alcance-${o.v}`} type="radio" name="alcance" value={o.v} defaultChecked={i === 0} style={{ width: "auto", margin: 0 }} />
                      {o.t}
                    </label>
                  ))}
                </fieldset>
              )}

              <button type="submit" style={{ width: "100%", background: "var(--error)" }}>
                {esSerie ? "Cancelar" : "Cancelar turno"}
              </button>
              <p className="tenue" style={{ margin: "8px 0 0", fontSize: 12 }}>
                Libera la hora y devuelve lo facturado. Queda registrado: el cargo no se borra, se
                le suma una nota de crédito.
              </p>
            </form>
          )}
        </div>
      )}

      {!acciones && vivo && !turno.esBloqueo && (
        <p className="tenue" style={{ margin: "14px 0 0", fontSize: 12 }}>
          Tu rol puede ver este turno, pero no modificarlo.
        </p>
      )}
    </aside>
  );
}
