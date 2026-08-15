// src/lib/permisos.test.ts — la matriz de permisos (§6.2 / §6.17). El test que más plata salva.
import { test } from "node:test";
import assert from "node:assert/strict";
import { puede, type Permiso, type Rol } from "./permisos.ts";

// Celdas críticas de la matriz, declaradas a mano (no generadas del propio módulo).
const ESPERADO: { rol: Rol; permiso: Permiso; puede: boolean }[] = [
  // El administrador puede todo lo del centro.
  { rol: "owner", permiso: "periodo.cerrar", puede: true },
  { rol: "owner", permiso: "tarifa.administrar", puede: true },
  { rol: "owner", permiso: "reserva.forzar_solape", puede: true },
  { rol: "owner", permiso: "finanzas.ver.agregada", puede: true },
  { rol: "owner", permiso: "sala.administrar", puede: true },
  { rol: "owner", permiso: "cobro.registrar", puede: true },
  // El profesional: lo suyo, nada del de al lado. Estas cinco negaciones son las que dejan las
  // pantallas de administración fuera de su alcance — el menú las esconde, pero el que manda es
  // el permiso: sin esto, escribir la URL a mano alcanzaría.
  { rol: "inquilino_titular", permiso: "cuenta.ver.propia", puede: true },
  { rol: "inquilino_titular", permiso: "reserva.crear.propia", puede: true },
  { rol: "inquilino_titular", permiso: "reserva.editar.propia", puede: true },
  { rol: "inquilino_titular", permiso: "agenda.ver.identidad", puede: false },
  { rol: "inquilino_titular", permiso: "reserva.crear.ajena", puede: false },
  { rol: "inquilino_titular", permiso: "cobro.registrar", puede: false },
  { rol: "inquilino_titular", permiso: "sala.administrar", puede: false },
  { rol: "inquilino_titular", permiso: "inquilino.administrar", puede: false },
  { rol: "inquilino_titular", permiso: "tarifa.administrar", puede: false },
  { rol: "inquilino_titular", permiso: "finanzas.ver.agregada", puede: false },
  { rol: "inquilino_titular", permiso: "cuenta.ver.todas", puede: false },
  // soporte: lee, nunca escribe
  { rol: "soporte_plataforma", permiso: "auditoria.ver", puede: true },
  { rol: "soporte_plataforma", permiso: "sala.administrar", puede: false },
  { rol: "soporte_plataforma", permiso: "reserva.crear.propia", puede: false },
];

test("cada celda crítica de la matriz coincide con lo declarado", () => {
  for (const c of ESPERADO) {
    assert.equal(puede(c.rol, c.permiso), c.puede, `${c.rol} × ${c.permiso} debería ser ${c.puede}`);
  }
});

test("fail-closed ante un rol desconocido", () => {
  assert.equal(puede("root" as Rol, "periodo.cerrar"), false);
});

test("ningún rol de inquilino administra nada", () => {
  for (const rol of ["inquilino_titular", "inquilino_staff"] as Rol[]) {
    for (const p of ["sala.administrar", "inquilino.administrar", "tarifa.administrar", "usuarios.administrar", "periodo.cerrar"] as Permiso[]) {
      assert.equal(puede(rol, p), false, `${rol} no puede ${p}`);
    }
  }
});
