"use client";
// app/(alta)/RelojDeSede.tsx — el RELOJ DE VERIFICACIÓN (§4.3.3 / §6.12 paso 1).
// Es la única forma de que el operador detecte un error de zona: la grilla NO lo delata (el
// error se cancela al escribir y leer con la misma zona equivocada) y solo aparece en lo
// absoluto (ICS, recordatorio, corte del período). Por eso el alta muestra "ahora mismo son
// las HH:MM en tu centro" con la zona derivada del país.

import { useEffect, useState } from "react";
import { formatHora } from "../../src/dominio/motor/zona.ts";

export function RelojDeSede({ tz }: { tz: string }) {
  const [ahora, setAhora] = useState<Date | null>(null);

  useEffect(() => {
    // El reloj arranca en el cliente (evita mismatch de hidratación con el server).
    setAhora(new Date());
    const id = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <p className="tenue" aria-live="polite">
      {ahora ? (
        <>
          Ahora mismo son las <strong>{formatHora(ahora, tz)}</strong> en tu centro ({tz}).
        </>
      ) : (
        <>Verificando la hora de tu centro…</>
      )}
    </p>
  );
}
