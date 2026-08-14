// app/BaseNoLista.tsx — lo que se ve cuando la base no está en condiciones de contestar.
//
// Reemplaza el stack de Turbopack que aparecía antes. Un stack le sirve a quien escribió el
// código; a quien está instalando la app le sirve saber qué falta y qué comando lo arregla,
// que es exactamente lo que el error de Prisma no dice.

import { explicar, type Falla } from "../src/lib/db-salud.ts";
import { Logo } from "./Logo.tsx";

export function BaseNoLista({ falla }: { falla: Falla }) {
  const { titulo, porque, pasos } = explicar(falla);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px 16px" }}>
      <div style={{ width: "100%", maxWidth: 520 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}>
          <Logo alto={44} />
        </div>

        <div className="panel" style={{ padding: 26 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>{titulo}</h1>
          <p className="tenue" style={{ marginTop: 8, marginBottom: 18 }}>{porque}</p>

          <p style={{ margin: "0 0 8px", fontWeight: 600, fontSize: 13 }}>Para arreglarlo, corré:</p>
          <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8 }}>
            {pasos.map((p) => (
              <li key={p}>
                <code
                  style={{
                    background: "var(--panel-2)",
                    border: "1px solid var(--borde)",
                    borderRadius: "var(--radio-chico)",
                    padding: "3px 8px",
                    fontSize: 13,
                  }}
                >
                  {p}
                </code>
              </li>
            ))}
          </ol>

          <p className="tenue" style={{ margin: "18px 0 0", fontSize: 12 }}>
            Esto no es un problema de tu usuario ni de tu contraseña: la aplicación no puede leer
            sus datos. Cuando la base responda, recargá esta página.
          </p>
        </div>
      </div>
    </main>
  );
}
