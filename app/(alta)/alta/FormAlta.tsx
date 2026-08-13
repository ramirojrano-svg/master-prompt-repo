"use client";
// app/(alta)/alta/FormAlta.tsx — formulario de alta del centro (onboarding paso 1, §6.12).
// El país DERIVA la zona: se elige país y el reloj muestra la hora resultante EN VIVO, antes
// de guardar. La server action revalida todo del lado del servidor (el form es solo la UI).

import { useState } from "react";
import { PAISES, type Pais } from "../../../src/dominio/paises.ts";
import { RelojDeSede } from "../RelojDeSede.tsx";
import { crearCentro } from "./acciones.ts";
import type { SalidaAlta } from "./tipos.ts";

const OPCIONES = Object.keys(PAISES) as Pais[];
const NOMBRE_PAIS: Record<Pais, string> = { AR: "Argentina", UY: "Uruguay", CL: "Chile", MX: "México" };

export function FormAlta() {
  const [pais, setPais] = useState<Pais>("AR");
  const [estado, setEstado] = useState<SalidaAlta | null>(null);
  const [enviando, setEnviando] = useState(false);

  const tz = PAISES[pais].tz;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    const datos = new FormData(e.currentTarget);
    setEstado(await crearCentro(Object.fromEntries(datos.entries())));
    setEnviando(false);
  }

  if (estado?.ok) {
    return (
      <div className="panel">
        <h2>Listo, tu centro está creado</h2>
        <p>
          La zona horaria quedó en <strong>{estado.zonaHoraria}</strong>. Si la hora que ves abajo no es la de tu
          centro, cambiala antes de cargar salas: después no se corrige solo.
        </p>
        <RelojDeSede tz={estado.zonaHoraria} />
        <p className="tenue">Próximo paso: cargar tu primera sala.</p>
      </div>
    );
  }

  return (
    <form className="panel" onSubmit={onSubmit}>
      <h2>Creá tu centro</h2>

      <label htmlFor="pais">País</label>
      <select id="pais" name="pais" value={pais} onChange={(e) => setPais(e.target.value as Pais)}>
        {OPCIONES.map((p) => (
          <option key={p} value={p}>
            {NOMBRE_PAIS[p]}
          </option>
        ))}
      </select>
      {/* El reloj de verificación: se ve ANTES de guardar. */}
      <RelojDeSede tz={tz} />

      <label htmlFor="nombreOperador">Nombre del centro</label>
      <input id="nombreOperador" name="nombreOperador" required placeholder="Espacio Montes de Oca" />

      <label htmlFor="slug">Dirección web (slug)</label>
      <input id="slug" name="slug" required pattern="[a-z0-9-]+" placeholder="espacio-moca" />

      <label htmlFor="nombreSede">Nombre de la sede</label>
      <input id="nombreSede" name="nombreSede" required placeholder="Sede Montes de Oca" />

      <label htmlFor="direccion">Dirección</label>
      <input id="direccion" name="direccion" placeholder="Av. Montes de Oca 1234, CABA" />

      <label htmlFor="nombreUsuario">Tu nombre</label>
      <input id="nombreUsuario" name="nombreUsuario" required />

      <label htmlFor="email">Tu email</label>
      <input id="email" name="email" type="email" required />

      <label htmlFor="password">Contraseña</label>
      <input id="password" name="password" type="password" required minLength={8} />

      {estado && !estado.ok && <p className="error">{estado.mensaje}</p>}

      <p style={{ marginTop: 18 }}>
        <button type="submit" disabled={enviando}>
          {enviando ? "Creando…" : "Crear centro"}
        </button>
      </p>
    </form>
  );
}
