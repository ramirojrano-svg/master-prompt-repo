// app/panel/[slug]/NuevaReserva.tsx — alta rápida de turno, desplegada desde el botón "Crear".
// El <form action={...}> apunta a una server action que resuelve la sesión y delega en la acción
// de dominio (que ya declara su permiso). Sin JS del lado del cliente: es un form HTML.

import type { GrupoConflicto } from "../../../src/dominio/conflictos.ts";
import { etiquetaDeRepeticion, REPETICIONES } from "../../../src/dominio/repeticion.ts";
import { BotonEnviar } from "./BotonEnviar.tsx";
import { Horario } from "./Horario.tsx";

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
  salaInicial,
  horaInicial,
  aperturaMin,
  cierreMin,
}: {
  salas: OpcionSala[];
  inquilinos: OpcionInquilino[];
  fecha: string;
  accion: (formData: FormData) => Promise<void>;
  /** Cuando se llegó tocando una celda de la grilla: el consultorio y la hora de esa celda. */
  salaInicial?: string;
  horaInicial?: string;
  /** Horario del centro, para que "Empieza" ofrezca solo horas en las que se puede reservar. */
  aperturaMin?: number;
  cierreMin?: number;
  error?: string;
  /** Resultado del alta: cuántos se crearon, y qué fechas quedaron afuera agrupadas por motivo. */
  creada?: { creadas: number; total: number; grupos: GrupoConflicto[] };
  /** Aviso de precio, ya formateado por el servidor. null = quien mira no administra precios. */
  precios?: { texto: string; href: string } | null;
}) {
  return (
    <form className="panel" action={accion} style={{ padding: 14 }}>
      <input type="hidden" name="fecha" value={fecha} />

      {/* Sin lista, el turno es de quien lo está creando y el campo no va: un profesional no elige
          de quién es su turno. El servidor tampoco lo aceptaría —la acción propia no tiene ese
          campo en su esquema— así que esconderlo no es el control, es solo no preguntar al pedo. */}
      {inquilinos.length > 0 && (
        <>
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
        </>
      )}

      <label htmlFor="salaId" style={inquilinos.length === 0 ? { marginTop: 0 } : undefined}>
        Consultorio
      </label>
      {/* El consultorio de la celda que se tocó; si se llegó por el botón "+", el primero.
          "Sin consultorio" son horas que se facturan igual pero no ocupan el espacio: el
          profesional que ese día atiende afuera. Sirve para que su hora no bloquee una sala que en
          realidad está libre y se le puede alquilar a otro.
          Solo aparece cuando hay lista de profesionales, o sea para la administración. Y no es la
          pantalla la que lo impide: el esquema de la acción propia exige sala, así que un POST
          directo del profesional tampoco pasa. */}
      <select id="salaId" name="salaId" required={inquilinos.length === 0} defaultValue={salaInicial ?? salas[0]?.id ?? ""}>
        {salas.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nombre}
          </option>
        ))}
        {inquilinos.length > 0 && <option value="">Sin consultorio (no ocupa sala)</option>}
      </select>

      <Horario horaInicial={horaInicial} aperturaMin={aperturaMin} cierreMin={cierreMin} />

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
        <div style={{ marginTop: 12, fontSize: 13 }}>
          <p className="exito" style={{ margin: 0 }}>
            {creada.creadas === 0
              ? "No se creó ningún turno."
              : creada.creadas === 1
                ? "Turno creado."
                : `${creada.creadas} turnos creados.`}
          </p>

          {/* Las que NO entraron, con fecha y motivo. El motivo importa tanto como la fecha: que
              el consultorio esté tomado se arregla eligiendo otro; que el profesional ya tenga
              turno a esa hora se arregla cambiando la hora; que esté cerrado, cambiando el día.
              "Ocupado o cerrado" las juntaba y borraba justo la parte accionable. */}
          {creada.total > 0 && (
            <div style={{ marginTop: 6 }}>
              <p style={{ margin: 0, fontWeight: 600, color: "var(--alerta)" }}>
                {creada.total === 1 ? "1 fecha quedó afuera:" : `${creada.total} fechas quedaron afuera:`}
              </p>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {creada.grupos.map((g) => (
                  <li key={g.motivo} className="tenue" style={{ marginBottom: 3 }}>
                    {g.fechas.join(", ")}
                    {g.ocultas > 0 && ` y ${g.ocultas} más`} — {g.motivo}.
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Crear una serie escribe medio centenar de filas y tarda unos segundos. El botón avisa
          que está trabajando y se deshabilita: sin eso la pantalla queda igual después de apretar,
          y el segundo click por las dudas crea la serie dos veces. */}
      <p style={{ marginTop: 14, marginBottom: 0 }}>
        <BotonEnviar enviando="Creando turno…">Crear turno</BotonEnviar>
      </p>
    </form>
  );
}
