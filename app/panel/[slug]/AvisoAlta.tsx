// app/panel/[slug]/AvisoAlta.tsx — el resultado de crear un turno o una serie, SOBRE la agenda.
//
// Por qué no vive adentro del panel de crear: ese panel se cierra solo al guardar (se pidió así, y
// está bien — con el turno hecho el formulario no tiene nada más que hacer y dejarlo abierto tapa
// la agenda que se acaba de modificar). Pero el aviso de qué fechas NO entraron también estaba
// adentro, así que se escribía y no lo veía nadie: la serie se creaba salteando los días ocupados
// EN SILENCIO, que es exactamente lo que no puede pasar (§4.9). El aviso tiene que sobrevivir al
// cierre del panel, y por eso se dibuja acá arriba.
//
// Vive en la URL (?creada=&chocaron=&dias=), así que se va solo al navegar a otro día. No hay que
// cerrarlo a mano ni se queda pegado de una operación vieja.

import type { GrupoConflicto } from "../../../src/dominio/conflictos.ts";

export function AvisoAlta({ creadas, total, grupos }: { creadas: number; total: number; grupos: GrupoConflicto[] }) {
  const hayProblemas = total > 0;
  // Que no haya entrado NINGUNO no es un aviso al pasar: es un pedido que no se cumplió.
  const nadaEntro = creadas === 0;

  return (
    <div
      role="status"
      className="panel"
      style={{
        margin: "10px 16px 0",
        padding: "12px 14px",
        borderLeft: `4px solid ${nadaEntro ? "var(--error)" : hayProblemas ? "var(--alerta)" : "var(--ok)"}`,
      }}
    >
      <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: nadaEntro ? "var(--error)" : undefined }}>
        {nadaEntro
          ? "No se creó ningún turno."
          : creadas === 1
            ? "Turno creado."
            : `${creadas} turnos creados.`}
      </p>

      {hayProblemas && (
        <>
          <p style={{ margin: "6px 0 0", fontSize: 13, fontWeight: 600, color: "var(--alerta)" }}>
            {total === 1 ? "1 fecha quedó afuera:" : `${total} fechas quedaron afuera:`}
          </p>
          <ul style={{ margin: "3px 0 0", paddingLeft: 18, fontSize: 13 }}>
            {grupos.map((g) => (
              <li key={g.motivo} className="tenue" style={{ marginBottom: 2 }}>
                {g.fechas.join(", ")}
                {g.ocultas > 0 && ` y ${g.ocultas} más`} — {g.motivo}.
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
