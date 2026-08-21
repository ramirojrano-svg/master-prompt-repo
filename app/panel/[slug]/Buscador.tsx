"use client";

// app/panel/[slug]/Buscador.tsx — filtra una lista mientras se tipea.
//
// Antes era un form GET con botón "Buscar": había que escribir y apretar. Con 29 nombres eso son
// dos gestos para algo que se hace todo el tiempo.
//
// El filtrado sigue siendo del SERVIDOR (la consulta ya filtra por nombre y por pagador), así que
// esto no duplica la lógica: solo actualiza la URL a medida que se escribe y deja que la página se
// vuelva a pedir. La búsqueda sigue viviendo en la query, o sea que se puede recargar, compartir y
// volver con el botón de atrás — lo que se ganaría filtrando en memoria se perdería en eso.
//
// El `replace` en vez de `push` es a propósito: si cada letra dejara una entrada en el historial,
// volver atrás obligaría a apretar diez veces para salir de la pantalla.
//
// Vive en la raíz del panel y no adentro de una pantalla porque lo usan dos —Profesionales y
// Acceso a la app— y las dos hacen exactamente lo mismo: escribir en `?q=` y dejar que el
// servidor filtre. Lo único que cambia entre ellas es el texto de ayuda y qué parámetros hay que
// conservar, así que eso son props.

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Cuánto se espera después de la última tecla. Suficiente para no pedir por cada letra tipeada,
 *  corto para que se sienta inmediato. */
const ESPERA_MS = 220;

export function Buscador({
  inicial,
  placeholder = "Buscar por nombre…",
  etiqueta = "Buscar",
  ocultos = {},
}: {
  inicial: string;
  placeholder?: string;
  etiqueta?: string;
  /** Lo que el formulario de respaldo tiene que arrastrar (por ejemplo `ver=todos`). */
  ocultos?: Record<string, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // `.toString()` y no el objeto: useSearchParams devuelve una instancia NUEVA en cada render, y
  // como identidad cambiante en las dependencias del efecto lo re-dispara solo — cada vuelta pide
  // otra navegación, que provoca otro render. El bucle no se nota como error: se nota como que la
  // pantalla "se come" los clics, porque se está remontando todo el tiempo.
  const params = useSearchParams().toString();
  const [texto, setTexto] = useState(inicial);
  // El primer render no navega: si no, entrar a la pantalla dispararía una recarga al pedo.
  const montado = useRef(false);

  useEffect(() => {
    if (!montado.current) {
      montado.current = true;
      return;
    }
    const id = setTimeout(() => {
      const q = new URLSearchParams(params);
      if (texto.trim()) q.set("q", texto.trim());
      else q.delete("q");
      // Al cambiar la búsqueda se sale de cualquier edición abierta: el que estaba editando ya no
      // está necesariamente en la lista nueva, y el formulario cargado con otro nombre confunde.
      q.delete("editar");
      router.replace(`${pathname}?${q.toString()}`, { scroll: false });
    }, ESPERA_MS);
    return () => clearTimeout(id);
  }, [texto, pathname, params, router]);

  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
      <input
        type="search"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={placeholder}
        aria-label={etiqueta}
        autoComplete="off"
        style={{ flex: 1 }}
      />
      {texto && (
        <button type="button" className="btn-suave" onClick={() => setTexto("")}>
          Limpiar
        </button>
      )}
      {/* Sin JavaScript el input no filtra, así que queda el form de siempre como respaldo. */}
      <noscript>
        <form method="get" style={{ display: "flex", gap: 8 }}>
          {Object.entries(ocultos).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <input type="search" name="q" defaultValue={inicial} aria-label={etiqueta} />
          <button type="submit">Buscar</button>
        </form>
      </noscript>
    </div>
  );
}
