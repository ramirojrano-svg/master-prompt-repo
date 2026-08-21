"use client";

// app/panel/[slug]/liquidaciones/[liquidacionId]/Copiar.tsx — copiar el alias o el CBU de un toque.
//
// Veintidós dígitos tipeados a mano es la forma más cara de equivocarse que tiene este circuito:
// una transferencia a un CBU mal copiado no rebota con un cartel, se va a la cuenta de otro.
//
// Vuelve al ícono solo después de dos segundos en vez de quedarse en "copiado". Un botón que
// cambia para siempre no dice si el SEGUNDO toque funcionó, y uno se queda mirándolo sin saber.

import { useState } from "react";

export function Copiar({ valor, que }: { valor: string; que: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // `navigator.clipboard` no existe fuera de HTTPS y el navegador puede negar el permiso. No
      // se avisa con un cartel de error: el valor está ahí al lado para seleccionarlo a mano, y
      // un botón que a veces no anda molesta menos que una alerta.
    }
  }

  return (
    <button
      type="button"
      onClick={copiar}
      title={`Copiar ${que}`}
      aria-label={copiado ? `${que} copiado` : `Copiar ${que}`}
      className="no-imprimir"
      style={{
        border: "none", background: "none", padding: "0 0 0 8px", cursor: "pointer",
        color: copiado ? "var(--ok)" : "var(--acento)", font: "inherit", lineHeight: 1,
        verticalAlign: "middle",
      }}
    >
      {copiado ? (
        <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      )}
    </button>
  );
}
