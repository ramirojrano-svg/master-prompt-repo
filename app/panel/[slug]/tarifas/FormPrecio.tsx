"use client";
// app/panel/[slug]/tarifas/FormPrecio.tsx — poner el precio por hora: a todos, a todos MENOS
// algunos, o a uno solo.
//
// El caso que faltaba es el del medio. Antes, para "8000 a todos salvo a estos tres" había que
// guardar cuatro veces —el general y después uno por uno— y entre guardado y guardado el general
// nuevo ya regía para gente a la que el operador acababa de decidir cobrarle otra cosa. Ahora es
// un solo guardado y una sola transacción.
//
// A cada excluido se le pide el precio ACÁ MISMO, y es obligatorio. La alternativa —dejarlos
// "afuera del general" sin decir cuánto pagan— los deja sin tarifa, y una reserva sin tarifa no
// genera deuda: el agujero no se ve hasta que a fin de mes el resumen viene en cero.
//
// Es de cliente por una sola razón: marcar a alguien tiene que hacer aparecer su casillero de
// precio. El envío sigue siendo un <form> con server action, sin fetch a mano.

import { useState } from "react";
import { BotonEnviar } from "../BotonEnviar.tsx";

export type OpcionProfesional = { id: string; nombre: string; estado: string };

const TODOS = "todos";
const TODOS_MENOS = "todos-menos";

export function FormPrecio({
  accion,
  inquilinos,
  mensaje,
  ok,
  aplicadas,
}: {
  accion: (formData: FormData) => Promise<void>;
  inquilinos: OpcionProfesional[];
  mensaje?: string | null;
  ok?: boolean;
  /** Cuántas reservas ya cargadas quedaron con el precio nuevo. */
  aplicadas?: number;
}) {
  // Un solo estado para el select: "todos", "todos-menos", o el id de una persona. Tener el modo
  // y el id por separado permitía que quedaran en desacuerdo (modo "uno" sin nadie elegido).
  const [seleccion, setSeleccion] = useState<string>(TODOS);
  // Los excluidos y su precio. El precio se guarda como TEXTO tal cual se tipea: convertirlo a
  // número en cada tecla no deja escribir cómodo y se come el cero de "0.50" a mitad de camino.
  const [excluidos, setExcluidos] = useState<Record<string, string>>({});

  const esTodosMenos = seleccion === TODOS_MENOS;
  const esUno = seleccion !== TODOS && seleccion !== TODOS_MENOS;
  const marcados = Object.keys(excluidos);

  function alternar(id: string) {
    setExcluidos((prev) => {
      if (id in prev) {
        const copia = { ...prev };
        delete copia[id];
        return copia;
      }
      return { ...prev, [id]: "" };
    });
  }

  return (
    <form className="panel" action={accion} style={{ marginTop: 20 }}>
      <h2 style={{ marginTop: 0, fontSize: 16 }}>Poner un precio</h2>

      {/* Lo que el servidor necesita para saber qué se le pidió. `inquilinoId` viaja vacío salvo
          que se haya elegido a una persona concreta. */}
      <input type="hidden" name="alcance" value={esTodosMenos ? TODOS_MENOS : esUno ? "uno" : TODOS} />
      <input type="hidden" name="inquilinoId" value={esUno ? seleccion : ""} />

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <div>
          <label htmlFor="alcanceSel">Profesional</label>
          <select
            id="alcanceSel"
            value={seleccion}
            onChange={(e) => {
              setSeleccion(e.target.value);
              // Al salir de "todos menos", los marcados se olvidan: dejarlos guardados y fuera de
              // la vista haría que el próximo guardado escriba precios que ya no están en pantalla.
              if (e.target.value !== TODOS_MENOS) setExcluidos({});
            }}
          >
            <option value={TODOS}>Todos</option>
            <option value={TODOS_MENOS}>Todos menos…</option>
            <optgroup label="Uno solo">
              {inquilinos.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nombre}
                  {i.estado === "activo" ? "" : " (de baja)"}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <div>
          <label htmlFor="precioHora">{esTodosMenos ? "Importe por hora (para el resto)" : "Importe por hora"}</label>
          <input id="precioHora" name="precioHora" type="number" min={0} step="0.01" required placeholder="8000" />
        </div>
      </div>

      {esTodosMenos && (
        <div style={{ marginTop: 16 }}>
          <p className="tenue" style={{ margin: "0 0 8px", fontSize: 13 }}>
            Marcá a quiénes NO les corresponde ese precio y escribí cuánto paga cada uno. El importe
            es obligatorio: sin precio propio, sus reservas no generan deuda.
          </p>
          <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--borde)", borderRadius: "var(--radio)", padding: 4 }}>
            {inquilinos.map((i) => {
              const marcado = i.id in excluidos;
              return (
                <div
                  key={i.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 8px",
                    borderRadius: 8,
                    background: marcado ? "var(--agua-clara)" : undefined,
                  }}
                >
                  <input
                    type="checkbox"
                    id={`exc-${i.id}`}
                    checked={marcado}
                    onChange={() => alternar(i.id)}
                    style={{ width: "auto", margin: 0 }}
                  />
                  <label htmlFor={`exc-${i.id}`} style={{ margin: 0, flex: 1, fontWeight: 400, cursor: "pointer" }}>
                    {i.nombre}
                    {i.estado === "activo" ? "" : <span className="tenue"> (de baja)</span>}
                  </label>
                  {marcado && (
                    <>
                      {/* Los dos campos se emiten en el MISMO orden, así el servidor los aparea por
                          posición con getAll() sin inventar un nombre distinto por persona. */}
                      <input type="hidden" name="excepcionId" value={i.id} />
                      <input
                        name="excepcionPrecio"
                        type="number"
                        min={0}
                        step="0.01"
                        required
                        placeholder="importe"
                        value={excluidos[i.id] ?? ""}
                        onChange={(e) => setExcluidos((p) => ({ ...p, [i.id]: e.target.value }))}
                        style={{ width: 130, margin: 0 }}
                        aria-label={`Importe por hora de ${i.nombre}`}
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <p className="tenue" style={{ margin: "8px 0 0", fontSize: 13 }}>
            {marcados.length === 0
              ? "Sin nadie marcado, el precio va a todos."
              : `${marcados.length} con precio propio; el resto queda con el importe de arriba.`}
          </p>
        </div>
      )}

      {mensaje && <p className="aviso-error" style={{ marginTop: 12 }}>{mensaje}</p>}
      {/* El mensaje dice qué pasó con LO YA CARGADO, no solo que se guardó. Antes decía "rige
          desde ahora en adelante" y se leía como que el cambio ya estaba hecho, cuando las
          reservas de la agenda seguían con el importe viejo. */}
      {ok && (
        <p className="aviso-ok" style={{ marginTop: 12 }}>
          Guardado.{" "}
          {aplicadas === undefined || aplicadas === 0
            ? "No había reservas ya cargadas para actualizar: rige para las que se agenden de acá en adelante."
            : `${aplicadas} ${aplicadas === 1 ? "reserva ya agendada quedó" : "reservas ya agendadas quedaron"} al precio nuevo. Lo ya usado y lo ya liquidado no se tocó.`}
        </p>
      )}

      <p style={{ marginTop: 14 }}>
        <BotonEnviar enviando="Guardando…">Guardar precio</BotonEnviar>
      </p>
    </form>
  );
}
