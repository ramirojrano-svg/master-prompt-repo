// src/lib/permisos.ts — ÚNICA fuente de verdad de los permisos (§6.2). Sin defaults permisivos.
// La matriz es explícita (sin spreads que hereden de más). `puede()` es fail-closed ante un rol
// o permiso desconocido. Los alcances finos ("solo hoy", "±7 días", "contrato vigente") viven en
// la server action; acá está el gate grueso por rol.

export type Rol =
  | "owner"
  | "gestor"
  | "recepcion"
  | "inquilino_titular"
  | "inquilino_staff"
  | "soporte_plataforma";

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
  // El único que borra el centro, cambia tarifas, cierra período y fuerza solapes.
  owner: new Set(TODOS),

  // Todo lo operativo y comercial MENOS: editar tarifas, cerrar período, forzar solape.
  gestor: new Set<Permiso>([
    "agenda.ver.identidad",
    "agenda.ver.disponibilidad",
    "reserva.crear.propia",
    "reserva.crear.ajena",
    "reserva.editar.propia",
    "reserva.editar.ajena",
    "bloqueo.crear",
    "sala.administrar",
    "inquilino.administrar",
    "cobro.registrar",
    "cuenta.ver.todas",
    "finanzas.ver.agregada",
    "acceso.codigo.ver",
    "acceso.codigo.rotar",
    "publica.configurar",
    "usuarios.administrar", // pero NO puede crear un owner: se cierra en la action de invitación
    "auditoria.ver",
    "datos.exportar",
  ]),

  // El mostrador: cobra y agenda (con alcance ±7 días / solo hoy en la action). NO ve agregados.
  recepcion: new Set<Permiso>([
    "agenda.ver.identidad",
    "agenda.ver.disponibilidad",
    "reserva.crear.propia",
    "reserva.crear.ajena",
    "reserva.editar.ajena",
    "bloqueo.crear",
    "cobro.registrar",
    "acceso.codigo.ver",
  ]),

  // El profesional: lo suyo y nada del de al lado. Disponibilidad sin identidad ajena.
  inquilino_titular: new Set<Permiso>([
    "agenda.ver.disponibilidad",
    "reserva.crear.propia",
    "reserva.editar.propia",
    "cuenta.ver.propia",
    "acceso.codigo.ver",
  ]),

  // Igual al titular MENOS todo lo que sea plata (no ve la cuenta corriente).
  inquilino_staff: new Set<Permiso>([
    "agenda.ver.disponibilidad",
    "reserva.crear.propia",
    "reserva.editar.propia",
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
