// src/servicios/plata/periodo-trabajo.ts — con qué mes abre Cierre de mes.
//
// Abre en el MES EN CURSO, siempre.
//
// Antes abría en el mes que viene. La idea era acompañar cómo cobra el centro —a mes entrante: a
// fin de agosto se manda lo que se va a pagar por septiembre—, así el mes que hay que cerrar ya
// estaba puesto. En la práctica salió al revés: la pantalla se abre muchas más veces para mirar el
// mes que se está trabajando que para cerrar el que viene, y cada una de esas veces caía en un mes
// futuro con la lista casi vacía, obligando a volver una flecha para atrás. Un default que hay que
// corregir a mano casi siempre no es un default.
//
// El mes en curso es el que uno tiene en la cabeza cuando abre la pantalla. Para cerrar el que
// viene está la flecha, y es un acto deliberado que se hace una vez por mes.
//
// Que sea un módulo aparte y no dos líneas adentro de la página no es ceremonia: es EL lugar donde
// se decide con qué mes abre, y ya cambió de criterio una vez.

import { esPeriodoValido, type Periodo } from "../../dominio/reporte.ts";

/**
 * El período con el que abrir la pantalla.
 *
 * `pedido` es lo que vino por la URL: si es un 'YYYY-MM' válido manda él, siempre — la flecha del
 * mes tiene que poder llevar a cualquier mes, incluido uno vacío, si eso es lo que se pidió.
 */
export function periodoDeTrabajo(a: { hoy: Periodo; pedido?: string }): Periodo {
  if (a.pedido && esPeriodoValido(a.pedido)) return a.pedido;
  return a.hoy;
}
