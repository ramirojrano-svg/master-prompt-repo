"use client";
// app/panel/[slug]/MenuLateral.tsx — el menú del panel, en una columna a la izquierda que se oculta.
//
// Antes los accesos vivían en la barra de arriba, como pastillas. El problema era el ancho: la
// barra ya lleva logo, título, la navegación del mes y la tuerca, y cada pantalla nueva empujaba a
// la siguiente hasta que en un portátil los últimos accesos quedaban fuera de la pantalla. En una
// columna el menú crece hacia abajo, que es espacio que sobra, y entra completo.
//
// Es cliente por dos razones, y las dos son necesarias:
//   · La pantalla actual se saca del pathname. El menú vive en el layout, y un layout no recibe
//     qué página está abajo — antes cada pantalla se lo pasaba a mano (`actual="salas"`), que es
//     justo lo que había que repetir en ocho archivos y se olvidaba en el noveno.
//   · Ocultarlo es estado del navegador, y se recuerda: quien lo cierra no quiere volver a
//     cerrarlo en cada pantalla.
//
// Colapsa a una franja fina en vez de desaparecer del todo: si se fuera entero no quedaría de
// dónde agarrarlo para traerlo de vuelta.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { puede, type Rol } from "../../../src/lib/permisos.ts";
import {
  IconoCalendario,
  IconoConsultorio,
  IconoGasto,
  IconoLista,
  IconoMetrica,
  IconoPrecio,
  IconoProfesional,
} from "../../Iconos.tsx";

const CLAVE = "emoapp:menu-oculto";

/** Ícono del botón que abre y cierra. Tres rayas: es lo que todo el mundo ya sabe apretar. */
function IconoMenu({ tam = 18 }: { tam?: number }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function MenuLateral({ slug, rol }: { slug: string; rol: Rol }) {
  const [oculto, setOculto] = useState(false);
  const pathname = usePathname();

  // El valor guardado se lee DESPUÉS de montar, no al construir el estado: en el servidor no hay
  // localStorage, y arrancar distinto de lo que el servidor pintó rompe la hidratación.
  useEffect(() => {
    setOculto(window.localStorage.getItem(CLAVE) === "1");
  }, []);

  function alternar() {
    setOculto((v) => {
      const nuevo = !v;
      // En modo incógnito o con el almacenamiento bloqueado esto tira. Que no se pueda RECORDAR la
      // preferencia no es motivo para que el botón deje de funcionar.
      try {
        window.localStorage.setItem(CLAVE, nuevo ? "1" : "0");
      } catch {}
      return nuevo;
    });
  }

  // Qué pantalla es la actual. Se compara el tramo que sigue al slug y no el pathname entero,
  // porque las pantallas con detalle (…/inquilinos/abc) tienen que marcar igual su sección.
  const raiz = `/panel/${slug}`;
  const resto = pathname.startsWith(raiz) ? pathname.slice(raiz.length).replace(/^\//, "") : "";
  const seccion = resto.split("/")[0] || "agenda";

  // Calendario y Mis reservas son la navegación del PROFESIONAL, y se deciden por el rol, no por
  // `puede()`: el administrador también tiene `reserva.crear.propia` (puede todo) y sin embargo no
  // debe ver "Mis reservas" — para él "lo mío" no significa nada, mira a cada uno desde
  // Profesionales.
  const esProfesional = rol === "inquilino_titular";

  const accesos: { id: string; href: string; texto: string; icono: ReactNode; mostrar: boolean }[] = [
    { id: "agenda", href: raiz, texto: "Calendario", icono: <IconoCalendario />, mostrar: esProfesional },
    { id: "salas", href: `${raiz}/salas`, texto: "Consultorios", icono: <IconoConsultorio />, mostrar: puede(rol, "sala.administrar") },
    { id: "inquilinos", href: `${raiz}/inquilinos`, texto: "Profesionales", icono: <IconoProfesional />, mostrar: puede(rol, "inquilino.administrar") },
    { id: "tarifas", href: `${raiz}/tarifas`, texto: "Precios", icono: <IconoPrecio />, mostrar: puede(rol, "tarifa.administrar") },
    // Gastos va ANTES de Métricas: se carga durante el mes, y Métricas es la lectura que lo usa.
    { id: "gastos", href: `${raiz}/gastos`, texto: "Gastos", icono: <IconoGasto />, mostrar: puede(rol, "finanzas.ver.agregada") },
    { id: "reportes", href: `${raiz}/reportes`, texto: "Métricas", icono: <IconoMetrica />, mostrar: puede(rol, "finanzas.ver.agregada") },
    { id: "mis-reservas", href: `${raiz}/mis-reservas`, texto: "Mis reservas", icono: <IconoLista />, mostrar: esProfesional },
  ];

  return (
    <nav className="menu-lateral" data-oculto={oculto ? "si" : undefined} aria-label="Secciones del panel">
      <button
        type="button"
        className="menu-alternar"
        onClick={alternar}
        aria-expanded={!oculto}
        // El nombre dice qué VA A PASAR al apretarlo, que es lo que necesita quien no ve el ícono.
        aria-label={oculto ? "Mostrar el menú" : "Ocultar el menú"}
        title={oculto ? "Mostrar el menú" : "Ocultar el menú"}
      >
        <IconoMenu />
      </button>

      {accesos
        .filter((a) => a.mostrar)
        .map((a) => (
          <Link
            key={a.id}
            href={a.href}
            className="item-lateral"
            aria-current={seccion === a.id ? "page" : undefined}
            // Colapsado no se lee el texto: el globito del navegador es lo único que queda para
            // saber a dónde va cada ícono.
            title={oculto ? a.texto : undefined}
          >
            {a.icono}
            <span>{a.texto}</span>
          </Link>
        ))}
    </nav>
  );
}
