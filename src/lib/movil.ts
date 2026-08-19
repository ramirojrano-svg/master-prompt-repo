// src/lib/movil.ts — ¿el pedido viene de un teléfono?
//
// Sirve para UNA cosa: elegir con qué vista abre la agenda. En un monitor el día es lo natural
// —se ve la grilla horaria completa—; en un teléfono no entra, y lo que se busca parado en la
// recepción es "qué hay este mes".
//
// Se decide en el SERVIDOR, mirando el user-agent, y no en el navegador con el ancho de pantalla.
// Con CSS o JavaScript de cliente la página se pintaría primero en una vista y saltaría a la otra:
// el parpadeo se ve, y encima carga dos veces los datos.
//
// El user-agent no es una fuente perfecta —se puede falsear, y hay tabletas que mienten—, pero acá
// eso no rompe nada: lo único que está en juego es qué vista aparece primero. Quien quiera la otra
// la elige y la URL manda.

/** Los teléfonos (y tabletas) que importan hoy. Deliberadamente corta: no es una biblioteca de
 *  detección, es la pregunta "¿esto es una pantalla chica de mano?". */
const MOVIL = /Android|iPhone|iPad|iPod|Windows Phone|BlackBerry|Opera Mini|IEMobile|Mobile Safari/i;

export function esMovil(userAgent: string | null | undefined): boolean {
  return Boolean(userAgent && MOVIL.test(userAgent));
}
