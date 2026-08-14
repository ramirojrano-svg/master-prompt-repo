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
  noShow,
  error,
}: {
  turno: EventoAgenda;
  moneda: string;
  cerrarHref: string;
  puedeEditar: boolean;
  cancelar: (fd: FormData) => Promise<void>;
  noShow: (fd: FormData) => Promise<void>;
  error?: string;
}) {
  // `estado` y `motivo` solo existen en la proyección de quien ve identidad; para el resto el
  // turno es un "ocupado" sin más, y no hay nada que ofrecer.
  const estado = "tipo" in turno ? turno.estado : "ocupado";
  const motivo = "motivo" in turno ? turno.motivo : null;
  const importe = "importeCent" in turno && turno.importeCent != null ? formatearPesos(BigInt(turno.importeCent), moneda) : null;
  const minutos = Math.round((new Date(turno.fin).getTime() - new Date(turno.inicio).getTime()) / 60_000);

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
        {importe && (
          <>
            <dt className="tenue">Importe</dt>
            <dd style={{ margin: 0 }}>{importe}</dd>
          </>
        )}
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
          <form action={noShow}>
            <input type="hidden" name="ocupacionId" value={turno.id} />
            <input type="hidden" name="accion" value={estado === "no_show" ? "revertir" : "marcar"} />
            <button type="submit" className="btn-suave" style={{ width: "100%" }}>
              {estado === "no_show" ? "Deshacer «no vino»" : "Marcar que no vino"}
            </button>
          </form>

          {estado === "confirmada" && (
            <form action={cancelar}>
              <input type="hidden" name="ocupacionId" value={turno.id} />
              <button type="submit" style={{ width: "100%", background: "var(--error)" }}>
                Cancelar turno
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
