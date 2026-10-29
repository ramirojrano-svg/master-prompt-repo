// src/lib/plata-entrada.ts — el único modo de leer un importe escrito por una persona.
//
// Existe porque la misma falla apareció tres veces en campos distintos, y cada vez costó plata:
// un importe tipeado como "4.500" —el punto de miles de este lado del mundo— llegaba al servidor
// tal cual y `z.coerce.number()` lo leía como 4.5. Mil veces menos, sin error, sin aviso, y se
// descubría recién al cerrar el mes.
//
// Que viva en un solo lugar es el punto: cada campo de plata nuevo usa esto, y el día que haya
// que cambiar la convención cambia una vez. Hay un test que recorre los esquemas y falla si
// aparece un `coerce.number` sobre un importe.

import { z } from "zod";
import { aPesos } from "../dominio/tarifa.ts";

/**
 * Un importe en pesos, tal como lo escribe el operador.
 *
 * Se le pasan las reglas del número —el mínimo, el máximo, si admite cero— y devuelve el esquema
 * ya envuelto en el parseo correcto. `aPesos` usa la misma convención con la que la app MUESTRA
 * plata (punto de miles, coma decimal), que es lo único que hace que lo que uno teclea y lo que ve
 * signifiquen lo mismo.
 *
 * Si el texto no es un importe, pasa el valor crudo para que el esquema lo rechace con su propio
 * mensaje, en vez de convertirlo en un NaN que se guarda.
 */
export function plataEnPesos(reglas: z.ZodNumber) {
  return z.preprocess((v) => aPesos(v) ?? v, reglas);
}
