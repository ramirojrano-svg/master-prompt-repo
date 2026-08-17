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
import type { ReactNode } from "react";
import { puede, type Rol } from "../../../src/lib/permisos.ts";
import { IconoCalendario, IconoConsultorio, IconoGasto, IconoLista, IconoMetrica, IconoPrecio, IconoProfesional } from "../../Iconos.tsx";

/** Qué pantalla es la actual, para marcarla. `agenda` = el calendario, ninguna de las interiores. */
export type Seccion = "agenda" | "salas" | "inquilinos" | "tarifas" | "gastos" | "reportes" | "mis-reservas";

export function BarraNav({ slug, rol, actual }: { slug: string; rol: Rol; actual: Seccion }) {
  // Calendario y Mis reservas son la navegación del PROFESIONAL, y se deciden por el rol, no por
  // `puede()`: el administrador también tiene `reserva.crear.propia` (puede todo) y sin embargo no
  // debe ver "Mis reservas" — para él "lo mío" no significa nada, mira a cada uno desde
  // Profesionales. Y "Calendario" es su forma de volver a la agenda desde Mis reservas, donde
  // antes solo estaba el logo; el administrador vuelve por el logo y por sus accesos.
  const esProfesional = rol === "inquilino_titular";

  const accesos: { id: Seccion; href: string; texto: string; icono: ReactNode; mostrar: boolean }[] = [
    { id: "agenda", href: `/panel/${slug}`, texto: "Calendario", icono: <IconoCalendario />, mostrar: esProfesional },
    { id: "salas", href: `/panel/${slug}/salas`, texto: "Consultorios", icono: <IconoConsultorio />, mostrar: puede(rol, "sala.administrar") },
    { id: "inquilinos", href: `/panel/${slug}/inquilinos`, texto: "Profesionales", icono: <IconoProfesional />, mostrar: puede(rol, "inquilino.administrar") },
    { id: "tarifas", href: `/panel/${slug}/tarifas`, texto: "Precios", icono: <IconoPrecio />, mostrar: puede(rol, "tarifa.administrar") },
    // Gastos va ANTES de Métricas: se carga durante el mes, y Métricas es la lectura que lo usa.
    { id: "gastos", href: `/panel/${slug}/gastos`, texto: "Gastos", icono: <IconoGasto />, mostrar: puede(rol, "finanzas.ver.agregada") },
    // Métricas y Negocio eran dos accesos a la misma pregunta partida al medio: uno mostraba lo
    // facturado y el otro lo que quedaba. Ahora es una pantalla sola — el resultado arriba, el
    // detalle que lo explica abajo.
    { id: "reportes", href: `/panel/${slug}/reportes`, texto: "Métricas", icono: <IconoMetrica />, mostrar: puede(rol, "finanzas.ver.agregada") },
    { id: "mis-reservas", href: `/panel/${slug}/mis-reservas`, texto: "Mis reservas", icono: <IconoLista />, mostrar: esProfesional },
  ];

  return (
    <nav className="oculta-mobile" style={{ display: "flex", gap: 8 }}>
      {accesos
        .filter((a) => a.mostrar)
        .map((a) => (
          <Link key={a.id} href={a.href} className="pastilla" aria-current={actual === a.id ? "page" : undefined}>
            {a.icono}
            {a.texto}
          </Link>
        ))}
    </nav>
  );
}
