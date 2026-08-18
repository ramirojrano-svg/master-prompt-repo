// src/lib/alta-abierta.ts — ¿cualquiera puede crear un centro desde internet?
//
// El alta era una server action PÚBLICA y sin sesión: entrando a /alta cualquiera se daba de alta
// como `owner` de un centro propio. Para una instalación de un solo centro eso no es una función,
// es una puerta abierta — y era además el primer paso de una toma de cuenta entre centros (ver el
// comentario de `restablecer` en servicios/config/accesos.ts).
//
// Queda apagada por default y se prende con ALTA_ABIERTA=true. Se lee `process.env` directo y no
// `env()` a propósito: `env()` valida el entorno entero y tira si falta cualquier otra variable, y
// esto tiene que poder contestar "cerrado" incluso cuando algo más está mal configurado.
//
// Fail-closed: cualquier valor que no sea exactamente "true" deja el alta cerrada. Un
// ALTA_ABIERTA=1 o =si mal puesto no abre nada.
export function altaAbierta(): boolean {
  return process.env.ALTA_ABIERTA === "true";
}
