// app/panel/[slug]/NuevaReserva.tsx — alta rápida de reserva desde el panel.
// El <form action={...}> apunta a una server action que resuelve la sesión y delega en la
// acción de dominio (que ya declara su permiso). Sin JS del lado del cliente: es un form HTML.

export type OpcionSala = { id: string; nombre: string };
export type OpcionInquilino = { id: string; nombre: string };

export function NuevaReserva({
  salas,
  inquilinos,
  fecha,
  accion,
  error,
  creada,
}: {
  salas: OpcionSala[];
  inquilinos: OpcionInquilino[];
  fecha: string;
  accion: (formData: FormData) => Promise<void>;
  error?: string;
  creada?: boolean;
}) {
  return (
    <details className="panel" style={{ marginTop: 16 }} open={Boolean(error)}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>+ Nueva reserva</summary>

      <form action={accion} style={{ marginTop: 12 }}>
        <input type="hidden" name="fecha" value={fecha} />

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <div>
            <label htmlFor="salaId">Sala</label>
            <select id="salaId" name="salaId" required defaultValue={salas[0]?.id ?? ""}>
              {salas.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="inquilinoId">Profesional</label>
            <select id="inquilinoId" name="inquilinoId" required>
              {inquilinos.map((i) => (
                <option key={i.id} value={i.id}>{i.nombre}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="hora">Hora de inicio</label>
            <input id="hora" name="hora" type="time" step={1800} required defaultValue="09:00" />
          </div>

          <div>
            <label htmlFor="duracionMin">Duración</label>
            <select id="duracionMin" name="duracionMin" defaultValue="60">
              <option value="30">30 minutos</option>
              <option value="60">1 hora</option>
              <option value="90">1 h 30</option>
              <option value="120">2 horas</option>
              <option value="240">4 horas (turno)</option>
            </select>
          </div>
        </div>

        {/* Mensaje honesto: nunca "no hay disponibilidad" cuando la causa es otra (§13). */}
        {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
        {creada && <p style={{ marginTop: 12, color: "#157f4a" }}>Reserva creada.</p>}

        <p style={{ marginTop: 14 }}>
          <button type="submit">Crear reserva</button>
        </p>
      </form>
    </details>
  );
}
