"use client";
// app/panel/[slug]/BotonEnviar.tsx — el botón de enviar de un formulario, que avisa mientras trabaja.
//
// Crear un turno suelto es rápido; crear una serie ("todos los martes") escribe medio centenar de
// filas contra una base que está en otro continente, y eso tarda unos segundos. Sin señal, la
// pantalla queda idéntica después de apretar: la reacción natural es apretar de nuevo, y ahí uno
// se pregunta si acaba de crear la serie dos veces.
//
// Se usa `useFormStatus` en vez de un `useState` propio porque el estado lo tiene el formulario,
// no el botón: el hook lee si la acción del <form> padre está en vuelo, sin que nadie tenga que
// acordarse de prenderlo y apagarlo. Por eso este componente tiene que ser HIJO del <form> — desde
// afuera el hook devuelve siempre `false`.
//
// El botón queda deshabilitado mientras tanto, que es la mitad importante: el aviso explica, pero
// lo que de verdad evita el turno duplicado es que el segundo click no llegue a ninguna parte.

import { useFormStatus } from "react-dom";

export function BotonEnviar({ children, enviando }: { children: React.ReactNode; enviando: string }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
      {pending && <span className="girito" aria-hidden="true" />}
      {pending ? enviando : children}
    </button>
  );
}
