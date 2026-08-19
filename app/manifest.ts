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
    icons: [
      // `any` y `maskable` en el mismo archivo: Android recorta el ícono con la forma que use el
      // teléfono —círculo, óvalo, cuadrado redondeado— y por eso el logo está centrado con margen,
      // dentro de la zona que ningún recorte se come.
      { src: "/icono-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icono-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icono-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icono-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
