// app/page.tsx — la raíz va DERECHO al login.
//
// Acá había una portada con el logo, una frase y un botón "Entrar". Sobraba: en una instalación de
// un solo centro, el primer contacto con la app es siempre iniciar sesión, y esa portada era una
// pantalla de más entre el usuario y lo que venía a hacer. El botón "Entrar" existía porque cerrar
// sesión dejaba acá y no había ninguna puerta a la vista; ahora la puerta ES esta pantalla.
//
// Es un redirect del SERVIDOR y no una página que se redibuja: el navegador nunca llega a pintar
// la portada, así que no hay parpadeo.
//
// El alta pública de centros (/alta) sigue existiendo y sigue apagada por default; quien la
// encienda llega por su URL. No hace falta una portada solo para enlazarla.

import { redirect } from "next/navigation";

export default function Home() {
  redirect("/login");
}
