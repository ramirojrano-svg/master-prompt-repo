// app/manifest.ts — lo que convierte la página en algo que se agrega a la pantalla de inicio.
//
// Sin esto, "Agregar a pantalla principal" guarda un acceso directo que abre el navegador con su
// barra de direcciones arriba: se ve que es una página, no una app. Con el manifiesto abre en
// pantalla completa, con el nombre y el logo del centro.
//
// Es un archivo de Next: se sirve solo en /manifest.webmanifest y se enlaza en el <head> sin que
// haya que acordarse de nada.

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EMOAPP — Espacio Montes de Oca",
    // El que se lee DEBAJO del ícono en la pantalla de inicio. Corto a propósito: el teléfono
    // corta lo que no entra, y "EMOAPP — Espacio…" no dice más que "EMOAPP".
    short_name: "EMOAPP",
    description: "Agenda, profesionales y facturación de Espacio Montes de Oca.",
    // Arranca en el login. La raíz redirige ahí igual, pero apuntar derecho evita el salto.
    start_url: "/login",
    scope: "/",
    // `standalone` es lo que saca la barra del navegador. No `fullscreen`: eso esconde también la
    // hora y la batería, que en una recepción se miran todo el tiempo.
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4f9fb", // el color de la pantalla mientras carga
    theme_color: "#f4f9fb",
    lang: "es-AR",
    dir: "ltr",
    // Dos juegos distintos, y compartir un archivo entre los dos era el error de antes.
    //
    //  · `any` va TRANSPARENTE y con el logo lo más grande que entra. Es el que usa la barra de
    //    tareas del escritorio, donde un fondo blanco se ve como un recuadro pegado al lado de
    //    íconos que no lo tienen.
    //  · `maskable` va con fondo y con margen: Android lo recorta con la forma que use el
    //    teléfono, así que el dibujo tiene que llegar al borde y el logo quedar dentro del 80%
    //    central. Transparente, ese recorte dejaría ver el fondo del launcher.
    //
    // Los tres se generan desde public/logo.png con `node scripts/iconos.mjs`.
    icons: [
      { src: "/icono-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icono-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icono-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
