// src/lib/db-salud.test.ts — los códigos reales que devolvió Prisma 6.19 en esta app, no
// inventados: P2021 salió de correr el panel contra una base sin tablas, y el error sin `code`
// pero con name PrismaClientInitializationError salió de apuntar a un puerto muerto.

import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnosticar, explicar, intentar, type Falla, avisoDePooler } from "./db-salud.ts";

test("P2021 (tabla ausente) => sin-esquema, con el nombre de la tabla", () => {
  const e = { name: "PrismaClientKnownRequestError", code: "P2021", meta: { table: "public.UsuarioOperador" } };
  assert.deepEqual(diagnosticar(e), { tipo: "sin-esquema", tabla: "public.UsuarioOperador" });
});

test("P2022 (columna ausente) => esquema-viejo: la app se actualizó y la base no", () => {
  const e = { name: "PrismaClientKnownRequestError", code: "P2022", meta: { column: "Ocupacion.importeCent" } };
  assert.deepEqual(diagnosticar(e), { tipo: "esquema-viejo", columna: "Ocupacion.importeCent" });
});

test("sin `code` pero clase de inicialización => sin-conexion", () => {
  // Es la forma exacta del error cuando el host no escucha: Prisma no llega a asignar código.
  assert.deepEqual(diagnosticar({ name: "PrismaClientInitializationError" }), { tipo: "sin-conexion" });
});

test("los códigos de conexión caen todos en sin-conexion", () => {
  for (const code of ["P1000", "P1001", "P1002", "P1017", "P2024"]) {
    assert.deepEqual(diagnosticar({ code }), { tipo: "sin-conexion" }, code);
  }
});

test("cliente generado viejo: la base está bien, lo que no sabe es el código", () => {
  // Este es el error de VALIDACIÓN de Prisma, sin `code`: para el cliente el campo no existe.
  // Pasa después de un git pull que cambia el schema, porque el cliente se regenera al instalar.
  const e = {
    name: "PrismaClientValidationError",
    message: "Invalid `prisma.inquilino.create()` invocation:\n\nUnknown argument `pagador`. Available options are marked with ?.",
  };
  assert.deepEqual(diagnosticar(e), { tipo: "cliente-viejo", campo: "pagador" });
  assert.ok(explicar({ tipo: "cliente-viejo", campo: "pagador" }).pasos.some((p) => p.includes("prisma generate")));
});

test("un error de validación que NO es un campo desconocido no se confunde", () => {
  // Un dato mal formado también es PrismaClientValidationError, y ahí regenerar no arregla nada.
  assert.equal(diagnosticar({ name: "PrismaClientValidationError", message: "Argument `monto` is missing." }), null);
});

test("un error de negocio NO se confunde con un problema de base", () => {
  // P2002 es choque de unicidad: es un pedido inválido, no una base rota. Si lo tomáramos por
  // falla de infraestructura, mostraríamos "revisá la base" ante un email duplicado.
  assert.equal(diagnosticar({ name: "PrismaClientKnownRequestError", code: "P2002" }), null);
});

test("lo que no es de Prisma devuelve null (para que el caller lo re-lance)", () => {
  assert.equal(diagnosticar(new Error("cualquier cosa")), null);
  assert.equal(diagnosticar(null), null);
  assert.equal(diagnosticar("texto"), null);
  assert.equal(diagnosticar(undefined), null);
});

test("meta ausente no rompe: la falla se reporta igual, sin el nombre", () => {
  assert.deepEqual(diagnosticar({ code: "P2021" }), { tipo: "sin-esquema", tabla: null });
  assert.deepEqual(diagnosticar({ code: "P2022", meta: {} }), { tipo: "esquema-viejo", columna: null });
});

test("explicar() siempre da pasos ejecutables, en todas las fallas", () => {
  const fallas: Falla[] = [
    { tipo: "sin-conexion" },
    { tipo: "sin-esquema", tabla: null },
    { tipo: "esquema-viejo", columna: null },
  ];
  for (const f of fallas) {
    const { titulo, porque, pasos } = explicar(f);
    assert.ok(titulo.length > 0 && porque.length > 0, f.tipo);
    assert.ok(pasos.length > 0, f.tipo);
  }
});

test("intentar() devuelve el valor cuando la base anda", async () => {
  const r = await intentar(async () => 42);
  assert.deepEqual(r, { ok: true, valor: 42 });
});

test("intentar() captura la falla de base en vez de tirar la pantalla abajo", async () => {
  const r = await intentar(async () => {
    throw { name: "PrismaClientKnownRequestError", code: "P2021", meta: { table: "public.Usuario" } };
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.ok === false && r.falla, { tipo: "sin-esquema", tabla: "public.Usuario" });
});

test("intentar() RE-LANZA lo que no es de base: un redirect tiene que seguir redirigiendo", async () => {
  // Next implementa redirect() tirando un error especial. Si lo tragáramos acá, todo redirect
  // adentro de un intentar() se convertiría en una pantalla de "revisá la base".
  const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
  await assert.rejects(() => intentar(async () => { throw redirect; }), /NEXT_REDIRECT/);
});

test("avisoDePooler reconoce las tres formas de declarar un pooler", () => {
  const prod = "production";
  assert.equal(avisoDePooler("postgresql://u:p@ep-x-pooler.aws.neon.tech/db", prod), null);
  assert.equal(avisoDePooler("postgresql://u:p@db.supabase.co:6543/postgres", prod), null);
  assert.equal(avisoDePooler("postgresql://u:p@host/db?pgbouncer=true", prod), null);
});

test("avisoDePooler avisa cuando la URL es la conexión directa", () => {
  const aviso = avisoDePooler("postgresql://u:p@ep-x.aws.neon.tech/db", "production");
  assert.ok(aviso?.includes("pooler"), "tiene que nombrar el problema");
});

test("avisoDePooler no molesta fuera de producción", () => {
  // En desarrollo se apunta a un Postgres local, que no tiene ni necesita pooler.
  assert.equal(avisoDePooler("postgresql://postgres@127.0.0.1:55432/motor", "development"), null);
  assert.equal(avisoDePooler(undefined, "production"), null);
});
