// app/panel/[slug]/NuevaReserva.tsx — alta rápida de turno, desplegada desde el botón "Crear".
// El <form action={...}> apunta a una server action que resuelve la sesión y delega en la acción
// de dominio (que ya declara su permiso). Sin JS del lado del cliente: es un form HTML.

import { etiquetaDeRepeticion, REPETICIONES } from "../../../src/dominio/repeticion.ts";

export type OpcionSala = { id: string; nombre: string };
export type OpcionInquilino = { id: string; nombre: string };

export function NuevaReserva({
  salas,
  inquilinos,
  fecha,
  accion,
  error,
  creada,
  precios,
}: {
  salas: OpcionSala[];
  inquilinos: OpcionInquilino[];
  fecha: string;
  accion: (formData: FormData) => Promise<void>;
  error?: string;
  /** Resultado del alta: cuántos turnos se crearon y cuántas fechas quedaron afuera. */
  creada?: { creadas: number; conflictos: number };
  /** Aviso de precio, ya formateado por el servidor. null = quien mira no administra precios. */
  precios?: { texto: string; href: string } | null;
}) {
  return (
    <form className="panel" action={accion} style={{ padding: 14 }}>
      <input type="hidden" name="fecha" value={fecha} />

      <label htmlFor="inquilinoId" style={{ marginTop: 0 }}>
        Profesional
      </label>
      <select id="inquilinoId" name="inquilinoId" required>
        {inquilinos.map((i) => (
          <option key={i.id} value={i.id}>
            {i.nombre}
          </option>
        ))}
      </select>

      <label htmlFor="salaId">Consultorio</label>
      <select id="salaId" name="salaId" required defaultValue={salas[0]?.id ?? ""}>
        {salas.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nombre}
          </option>
        ))}
      </select>

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
        <div>
          <label htmlFor="hora">Empieza</label>
          <input id="hora" name="hora" type="time" step={1800} required defaultValue="09:00" />
        </div>
        <div>
          <label htmlFor="duracionMin">Dura</label>
          <select id="duracionMin" name="duracionMin" defaultValue="60">
            <option value="30">30 minutos</option>
            {/* 1 a 12 horas correlativas. 12 h es el máximo que admite el motor
                (DURACION_MAX_MIN), y el CHECK de la base lo respalda. */}
            {Array.from({ length: 12 }, (_, k) => k + 1).map((h) => (
              <option key={h} value={h * 60}>
                {h} {h === 1 ? "hora" : "horas"}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Repetición, con las etiquetas armadas desde la fecha elegida ("el segundo viernes", no
          "mensual"): la etiqueta ES la explicación. El campo "veces" solo aparece cuando hay algo
          que repetir, así el alta de un turno suelto sigue teniendo los mismos cuatro campos. */}
      <label htmlFor="repeticion">Se repite</label>
      <select id="repeticion" name="repeticion" defaultValue="no">
        {REPETICIONES.map((r) => (
          <option key={r} value={r}>
            {etiquetaDeRepeticion(fecha, r)}
          </option>
        ))}
      </select>

      <p className="tenue" style={{ margin: "4px 0 0", fontSize: 12 }}>
        La repetición cubre toda la agenda que se puede reservar (poco más de un año). Las fechas
        que choquen con otro turno se informan y no se crean; el resto sí.
      </p>

      {/* El precio no se elige en el alta: sale de la tarifa vigente (§8.8). Se avisa cuál es,
          en vez de dejar que el profesional se entere en el resumen del mes. */}
      {precios && (
        <p className="tenue" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          {precios.texto} · <a href={precios.href}>cambiar precios</a>
        </p>
      )}

      {/* Mensaje honesto: nunca "no hay disponibilidad" cuando la causa es otra (§13). */}
      {error && (
        <p className="error" style={{ marginTop: 12, marginBottom: 0, fontSize: 13 }}>
          {error}
        </p>
      )}
      {creada && (
        <p className="exito" style={{ marginTop: 12, marginBottom: 0, fontSize: 13 }}>
          {creada.creadas === 1 ? "Turno creado." : `${creada.creadas} turnos creados.`}
          {creada.conflictos > 0 && (
            <span className="tenue" style={{ display: "block", fontWeight: 400, marginTop: 4 }}>
              {creada.conflictos} fecha{creada.conflictos === 1 ? "" : "s"} quedaron afuera porque
              el consultorio ya estaba ocupado o cerrado.
            </span>
          )}
        </p>
      )}

      <p style={{ marginTop: 14, marginBottom: 0 }}>
        <button type="submit" style={{ width: "100%" }}>
          Crear turno
        </button>
      </p>
    </form>
  );
}
