"use client";

// app/(alta)/login/CampoClave.tsx — la contraseña, con el ojo para verla.
//
// Es el único pedazo del login que necesita JavaScript: alternar `type` entre password y text no
// se puede hacer con HTML solo. Por eso está separado en su propio componente en vez de convertir
// la pantalla entera en cliente — el formulario sigue posteando a la server action, y si esto no
// hidrata, el campo queda como un password normal y se puede entrar igual.
//
// El botón NO va adentro de un <label>, y el `tabIndex={-1}`: al tabular desde el campo se espera
// llegar a "Entrar", no a un botón de mostrar. Quien lo quiera usar, lo toca.

import { useState } from "react";

export function CampoClave() {
  const [visible, setVisible] = useState(false);

  return (
    <>
      <label htmlFor="password">Contraseña</label>
      <div style={{ position: "relative" }}>
        <input
          id="password"
          name="password"
          type={visible ? "text" : "password"}
          required
          autoComplete="current-password"
          // Espacio a la derecha para que el texto no pase por debajo del botón.
          style={{ paddingRight: 44 }}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          tabIndex={-1}
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          title={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          style={{
            position: "absolute",
            right: 4,
            top: "50%",
            transform: "translateY(-50%)",
            width: 34,
            height: 34,
            minHeight: 34,
            padding: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            color: "var(--tenue)",
            borderRadius: "50%",
          }}
        >
          {visible ? <OjoTachado /> : <Ojo />}
        </button>
      </div>
    </>
  );
}

const base = {
  width: 19,
  height: 19,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

function Ojo() {
  return (
    <svg {...base}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function OjoTachado() {
  return (
    <svg {...base}>
      <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a18 18 0 0 1-2.9 3.9M6.2 6.2A18 18 0 0 0 2 12s3.6 7 10 7a10.7 10.7 0 0 0 4.3-.86" />
      <path d="m9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </svg>
  );
}
