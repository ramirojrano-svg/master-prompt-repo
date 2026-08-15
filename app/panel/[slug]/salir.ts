// app/panel/[slug]/salir.ts — cerrar sesión.
//
// Vive en su propio archivo con "use server" arriba de todo, y no adentro de la Cabecera, porque
// la Cabecera es un componente que se importa desde pantallas de servidor: mezclar la acción en
// ese archivo la convertiría en un módulo de acciones y arrastraría el resto del componente.
//
// Es una ACCIÓN (POST), no un enlace. Salir cambia estado, y un GET que cambia estado lo dispara
// solo cualquier precargador del navegador o un escáner de links: con un <a href="/salir"> basta
// que el navegador adelante la carga del enlace para desloguear al operador sin que haya tocado
// nada.

"use server";

import { signOut } from "../../../src/lib/auth.ts";

export async function cerrarSesion(): Promise<void> {
  // `redirectTo` manda al login del centro. signOut borra la cookie de sesión; el token en sí no
  // se puede "revocar" porque es un JWT, y para eso está `sessionVersion` (§9): subirla invalida
  // todas las sesiones abiertas de ese usuario. Acá alcanza con cerrar ESTA.
  await signOut({ redirectTo: "/login" });
}
