"use client";

// app/error.tsx — cuando se cae una pantalla de afuera del panel, decir algo.
//
// Es la MISMA pantalla que la del panel, puesta en la raíz. Sin esto, un fallo en /login o en
// /olvide caía en la de Next: genérica, en inglés y justo en las dos pantallas que ve alguien
// que todavía no entró — o sea, la peor primera impresión posible.
//
// Sin esto, cualquier error del servidor deja la pantalla en blanco de Next: "This page couldn't
// load" y un número abajo de todo. Ese número NO es decoración —es la única forma de encontrar el
// error en los registros del servidor— pero nadie lo sabe, así que se reporta como "tira error" y
// hay que adivinar.
//
// Esta pantalla hace tres cosas: dice que el problema es del servidor y no de lo que el usuario
// hizo, pone el número donde se lee, y explica dónde buscarlo. No muestra el mensaje del error:
// en producción Next lo censura a propósito, porque un stack puede filtrar nombres de tablas y
// rutas internas.

import Link from "next/link";

export default function ErrorPanel({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ maxWidth: 520, margin: "72px auto", padding: "0 16px" }}>
      <div className="panel" style={{ padding: 26, borderLeft: "4px solid var(--error)" }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Se cayó esta pantalla</h1>
        <p className="tenue" style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.5 }}>
          Es un problema del servidor, no de lo que estabas haciendo. Tus datos están intactos: una
          pantalla que no carga no llegó a guardar nada.
        </p>

        {error.digest && (
          <>
            <p className="tenue" style={{ margin: "16px 0 4px", fontSize: 13 }}>
              Número del error
            </p>
            <code style={{ display: "block", fontSize: 15, fontWeight: 600, wordBreak: "break-all" }}>{error.digest}</code>
            <p className="tenue" style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.5 }}>
              Con ese número se encuentra qué pasó exactamente: en Vercel, entrá al proyecto →{" "}
              <b>Logs</b> y buscalo. Ahí está el error de verdad, con el archivo y la línea.
            </p>
          </>
        )}

        <p style={{ marginTop: 22, marginBottom: 0, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {/* `reset` reintenta el render sin recargar la página entera: si fue algo pasajero —la
              base tardando de más— alcanza con esto. */}
          <button type="button" onClick={() => reset()}>
            Reintentar
          </button>
          <Link href="/login" className="btn-suave" style={{ padding: "9px 18px" }}>
            Volver a entrar
          </Link>
        </p>
      </div>
    </main>
  );
}
