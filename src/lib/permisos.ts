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

const TODOS: Permiso[] = [
  "agenda.ver.identidad",
  "agenda.ver.disponibilidad",
  "reserva.crear.propia",
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
