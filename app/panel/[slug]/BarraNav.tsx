// app/panel/[slug]/BarraNav.tsx — los accesos del centro, iguales en TODAS las pantallas.
//
// Antes cada pantalla interior (Consultorios, Profesionales, Precios, Métricas) tenía como única
// salida un "‹ Agenda" abajo a la izquierda: para pasar de Consultorios a Precios había que
// volver a la agenda y salir de nuevo. Ahora los cuatro accesos viajan en la barra superior, así
// que desde cualquier pantalla se llega a cualquier otra en un click, y la que estás mirando
// queda marcada (`aria-current`), que también es lo que la hace legible para un lector de
// pantalla.
//
// El filtro por permiso vive acá y no en cada página: si un rol no administra precios, el acceso
// no existe en ninguna barra, y no hay que acordarse de repetir el chequeo en cinco archivos.

import Link from "next/link";
import { puede, type Rol } from "../../../src/lib/permisos.ts";
import { IconoConsultorio, IconoGasto, IconoLista, IconoMetrica, IconoPrecio, IconoProfesional } from "../../Iconos.tsx";

/** Qué pantalla es la actual, para marcarla. `agenda` = ninguna de las cuatro. */
export type Seccion = "agenda" | "salas" | "inquilinos" | "tarifas" | "gastos" | "reportes" | "mis-reservas";

export function BarraNav({ slug, rol, actual }: { slug: string; rol: Rol; actual: Seccion }) {
  const accesos = [
    { id: "salas", permiso: "sala.administrar", texto: "Consultorios", icono: <IconoConsultorio /> },
    { id: "inquilinos", permiso: "inquilino.administrar", texto: "Profesionales", icono: <IconoProfesional /> },
    { id: "tarifas", permiso: "tarifa.administrar", texto: "Precios", icono: <IconoPrecio /> },
    // Gastos va ANTES de Métricas: se carga durante el mes, y Métricas es la lectura que lo usa.
    { id: "gastos", permiso: "finanzas.ver.agregada", texto: "Gastos", icono: <IconoGasto /> },
    // Métricas y Negocio eran dos accesos a la misma pregunta partida al medio: uno mostraba lo
    // facturado y el otro lo que quedaba. Ahora es una pantalla sola — el resultado arriba, el
    // detalle que lo explica abajo.
    { id: "reportes", permiso: "finanzas.ver.agregada", texto: "Métricas", icono: <IconoMetrica /> },
    // El único acceso del PROFESIONAL: la administración no lo ve porque para ella "lo mío" no
    // significa nada — mira la ficha de cada uno desde Profesionales.
    { id: "mis-reservas", permiso: "reserva.crear.propia", texto: "Mis reservas", icono: <IconoLista /> },
  ] as const;

  return (
    <nav className="oculta-mobile" style={{ display: "flex", gap: 8 }}>
      {accesos
        .filter((a) => puede(rol, a.permiso))
        .map((a) => (
          <Link
            key={a.id}
            href={`/panel/${slug}/${a.id}`}
            className="pastilla"
            aria-current={actual === a.id ? "page" : undefined}
          >
            {a.icono}
            {a.texto}
          </Link>
        ))}
    </nav>
  );
}
