// src/lib/permisos.test.ts — la matriz de permisos (§6.2 / §6.17). El test que más plata salva.
import { test } from "node:test";
import assert from "node:assert/strict";
import { puede, type Permiso, type Rol } from "./permisos.ts";

// Celdas críticas de la matriz, declaradas a mano (no generadas del propio módulo).
const ESPERADO: { rol: Rol; permiso: Permiso; puede: boolean }[] = [
  // solo el owner: cerrar período, editar tarifas, forzar solape
  { rol: "owner", permiso: "periodo.cerrar", puede: true },
  { rol: "gestor", permiso: "periodo.cerrar", puede: false },
  { rol: "owner", permiso: "tarifa.administrar", puede: true },
  { rol: "gestor", permiso: "tarifa.administrar", puede: false },
  { rol: "owner", permiso: "reserva.forzar_solape", puede: true },
  { rol: "gestor", permiso: "reserva.forzar_solape", puede: false },
  // gestor sí ve finanzas agregada y administra salas
  { rol: "gestor", permiso: "finanzas.ver.agregada", puede: true },
  { rol: "gestor", permiso: "sala.administrar", puede: true },
  // recepción cobra pero NO ve finanzas agregada ni administra salas
  { rol: "recepcion", permiso: "cobro.registrar", puede: true },
  { rol: "recepcion", permiso: "finanzas.ver.agregada", puede: false },
  { rol: "recepcion", permiso: "sala.administrar", puede: false },
  { rol: "recepcion", permiso: "cuenta.ver.todas", puede: false },
  // inquilino: lo suyo, nada del de al lado
  { rol: "inquilino_titular", permiso: "cuenta.ver.propia", puede: true },
  { rol: "inquilino_titular", permiso: "reserva.crear.propia", puede: true },
  { rol: "inquilino_titular", permiso: "agenda.ver.identidad", puede: false },
  { rol: "inquilino_titular", permiso: "reserva.crear.ajena", puede: false },
  { rol: "inquilino_titular", permiso: "cobro.registrar", puede: false },
  // staff = titular menos plata
  { rol: "inquilino_staff", permiso: "reserva.crear.propia", puede: true },
  { rol: "inquilino_staff", permiso: "cuenta.ver.propia", puede: false },
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
