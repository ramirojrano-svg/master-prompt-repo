// src/lib/permisos.ts — ÚNICA fuente de verdad de los permisos (§6.2). Sin defaults permisivos.
// La matriz es explícita (sin spreads que hereden de más). `puede()` es fail-closed ante un rol
// o permiso desconocido. Los alcances finos ("solo hoy", "±7 días", "contrato vigente") viven en
// la server action; acá está el gate grueso por rol.

// Dos roles de centro y nada más: ADMIN (owner) y PROFESIONAL (inquilino_titular).
//
// Había tres más —gestor, recepción y el staff del profesional— pensados para un centro con
// mostrador. Este no lo tiene: los profesionales se agendan solos y la administración la lleva el
// dueño. Un rol que nadie usa no es gratis: aparece en cada matriz, en cada test y en cada
// pantalla que muestra "quién puede qué", y el día que alguien lo asigna hereda permisos que
// nadie volvió a mirar.
//
// `soporte_plataforma` NO es un usuario del centro: es el acceso de solo lectura de quien mantiene
// la app, con consentimiento y expiración. Se queda porque no ocupa lugar en la operación diaria y
// sacarlo eliminaría un control que existe para poder mirar sin poder tocar.
export type Rol = "owner" | "inquilino_titular" | "soporte_plataforma";

/** Cómo se llama cada rol en pantalla. */
export const ETIQUETA_ROL: Record<Rol, string> = {
  owner: "Administrador",
  inquilino_titular: "Profesional",
  soporte_plataforma: "Soporte",
};

export type Permiso =
  | "agenda.ver.identidad" // ver de QUIÉN es cada reserva
  | "agenda.ver.disponibilidad" // solo libre/ocupado
  | "reserva.crear.propia"
  | "perfil.propio.editar" // su nombre, su titulo y su foto
  | "reserva.crear.ajena"
  | "reserva.editar.propia"
  | "reserva.editar.ajena"
  | "reserva.forzar_solape"
  | "bloqueo.crear"
  | "sala.administrar"
  | "inquilino.administrar"
  | "tarifa.administrar"
  | "cobro.registrar"
  | "cuenta.ver.propia"
  | "cuenta.ver.todas"
  | "finanzas.ver.agregada"
  | "periodo.cerrar"
  | "acceso.codigo.ver"
  | "acceso.codigo.rotar"
  | "publica.configurar"
  | "usuarios.administrar"
  | "auditoria.ver"
  | "datos.exportar";

/**
 * El permiso en castellano, para mostrárselo a una persona.
 *
 * El registro de actividad guarda el código (`periodo.cerrar`) porque es lo que no cambia si
 * mañana se reescribe un texto. Pero una pantalla que le muestra "periodo.cerrar" al dueño del
 * centro le está pidiendo que traduzca de un vocabulario que nunca vio: la lista se vuelve
 * ilegible justo cuando hace falta leerla, que es cuando algo no cierra.
 */
export const ETIQUETA_PERMISO: Record<Permiso, string> = {
  "agenda.ver.identidad": "Ver de quién es cada reserva",
  "agenda.ver.disponibilidad": "Ver la disponibilidad",
  "reserva.crear.propia": "Agendar un turno propio",
  "perfil.propio.editar": "Editar el perfil propio",
  "reserva.crear.ajena": "Agendar un turno",
  "reserva.editar.propia": "Mover un turno propio",
  "reserva.editar.ajena": "Mover un turno",
  "reserva.forzar_solape": "Superponer dos turnos",
  "bloqueo.crear": "Bloquear un horario",
  "sala.administrar": "Administrar consultorios",
  "inquilino.administrar": "Administrar profesionales",
  "tarifa.administrar": "Cambiar precios",
  "cobro.registrar": "Registrar un cobro",
  "cuenta.ver.propia": "Ver la cuenta propia",
  "cuenta.ver.todas": "Ver las cuentas",
  "finanzas.ver.agregada": "Ver los números del centro",
  "periodo.cerrar": "Cerrar el mes",
  "acceso.codigo.ver": "Ver el código de acceso",
  "acceso.codigo.rotar": "Cambiar el código de acceso",
  "publica.configurar": "Cambiar la configuración",
  "usuarios.administrar": "Administrar accesos",
  "auditoria.ver": "Ver el registro de actividad",
  "datos.exportar": "Exportar datos",
};

const TODOS: Permiso[] = [
  "agenda.ver.identidad",
  "agenda.ver.disponibilidad",
  "reserva.crear.propia",
  "perfil.propio.editar",
  "reserva.crear.ajena",
  "reserva.editar.propia",
  "reserva.editar.ajena",
  "reserva.forzar_solape",
  "bloqueo.crear",
  "sala.administrar",
  "inquilino.administrar",
  "tarifa.administrar",
  "cobro.registrar",
  "cuenta.ver.propia",
  "cuenta.ver.todas",
  "finanzas.ver.agregada",
  "periodo.cerrar",
  "acceso.codigo.ver",
  "acceso.codigo.rotar",
  "publica.configurar",
  "usuarios.administrar",
  "auditoria.ver",
  "datos.exportar",
];

const MATRIZ: Readonly<Record<Rol, ReadonlySet<Permiso>>> = {
  // El administrador del centro: la agenda entera, los precios, la plata y los gastos.
  owner: new Set(TODOS),

  // El profesional: lo suyo y nada del de al lado. Ve disponibilidad, no identidad ajena, y no
  // alcanza ninguna pantalla de administración — ni por el menú ni escribiendo la URL.
  inquilino_titular: new Set<Permiso>([
    "agenda.ver.disponibilidad",
    "reserva.crear.propia",
    "perfil.propio.editar",
    "reserva.editar.propia",
    "cuenta.ver.propia",
    "acceso.codigo.ver",
  ]),

  // Nosotros: SOLO lectura, con consentimiento del owner y expiración (gating fuera de la matriz).
  // Nunca escribe: no hay un solo permiso de creación/administración acá.
  soporte_plataforma: new Set<Permiso>([
    "agenda.ver.identidad",
    "agenda.ver.disponibilidad",
    "cuenta.ver.todas",
    "finanzas.ver.agregada",
    "auditoria.ver",
  ]),
};

/** ¿El rol tiene el permiso? Fail-closed ante un rol o permiso desconocido. */
export function puede(rol: Rol, p: Permiso): boolean {
  return MATRIZ[rol]?.has(p) ?? false;
}

export const PERMISOS_TODOS = TODOS;
