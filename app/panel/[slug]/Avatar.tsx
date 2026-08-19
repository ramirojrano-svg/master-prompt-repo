// app/panel/[slug]/Avatar.tsx — la cara de un profesional, en un círculo.
//
// Una lista de 35 nombres es una lista de 35 renglones iguales: para encontrar a alguien hay que
// leerlos todos. Con la foto adelante se lo reconoce sin leer, que es como funciona la gente que
// trabaja en el centro — se acuerdan de la cara antes que del apellido.
//
// Quien no cargó foto NO deja un hueco: se dibujan sus iniciales sobre un color estable derivado
// del nombre. Un espacio vacío desalinea la columna y hace parecer que falta un dato; unas
// iniciales son un lugar ocupado, y encima siguen ayudando a distinguir.

import { inicialesDe } from "../../../src/dominio/perfil.ts";

/**
 * El color del círculo sale del NOMBRE, no de un azar ni del orden en la lista: así una persona
 * tiene siempre el mismo, en todas las pantallas y después de cualquier reordenamiento. Un color
 * que cambia entre visitas no ayuda a reconocer a nadie.
 */
const COLORES = ["#1a8fc1", "#3f7f8c", "#5c7382", "#2f8f6f", "#8a6d3b", "#7a5c9e", "#b06a5a"] as const;

function colorDe(nombre: string): string {
  let suma = 0;
  for (const c of nombre) suma = (suma + c.codePointAt(0)!) % 100_000;
  return COLORES[suma % COLORES.length]!;
}

export function Avatar({ nombre, foto, tam = 34 }: { nombre: string; foto?: string | null; tam?: number }) {
  const base = {
    width: tam,
    height: tam,
    minWidth: tam, // en una fila estrecha el círculo no se aplasta: sin esto queda un óvalo
    borderRadius: "50%",
    flexShrink: 0,
  } as const;

  if (foto) {
    return (
      <img
        src={foto}
        alt=""
        // alt vacío y aria-hidden: al lado va SIEMPRE el nombre en texto. Repetirlo acá le haría
        // leer dos veces lo mismo a quien usa un lector de pantalla.
        aria-hidden
        width={tam}
        height={tam}
        style={{ ...base, objectFit: "cover", border: "1px solid var(--borde)" }}
      />
    );
  }

  return (
    <span
      aria-hidden
      style={{
        ...base,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: colorDe(nombre),
        color: "#fff",
        fontSize: Math.round(tam * 0.38),
        fontWeight: 600,
        letterSpacing: "0.02em",
      }}
    >
      {inicialesDe(nombre)}
    </span>
  );
}
