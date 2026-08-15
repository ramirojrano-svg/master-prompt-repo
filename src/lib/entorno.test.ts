// src/lib/entorno.test.ts — la precedencia de los .env, clavada.
//
// El caso que motivó estos tests es real y costó caro: un `.env` copiado de `.env.example` —con
// una DATABASE_URL de ejemplo, sin contraseña— le ganaba al `.env.local` de verdad. Los dos
// archivos se veían perfectos abiertos uno al lado del otro. La app apuntaba a una base sin
// contraseña y el login contestaba "email o contraseña incorrectos".
//
// La causa era delegar la precedencia en `process.loadEnvFile`, que en unas versiones de Node
// pisa lo ya definido y en otras no. Estos tests no dependen de esa versión: fijan el orden.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cargarEnv, parsearEnv } from "./entorno.ts";

/** Un directorio con los .env pedidos, y el entorno restaurado al salir. */
function conArchivos(archivos: Record<string, string>, prueba: (raiz: string) => void): void {
  const raiz = mkdtempSync(join(tmpdir(), "emoapp-env-"));
  for (const [nombre, contenido] of Object.entries(archivos)) writeFileSync(join(raiz, nombre), contenido);
  const previo = { ...process.env };
  try {
    prueba(raiz);
  } finally {
    // Restaurar por mutación: otros módulos ya capturaron la referencia a process.env.
    for (const k of Object.keys(process.env)) if (!(k in previo)) delete process.env[k];
    Object.assign(process.env, previo);
  }
}

test(".env.local le gana a .env — el caso que rompió la instalación", () => {
  conArchivos(
    {
      ".env.local": 'DATABASE_URL="postgresql://postgres:secreta@127.0.0.1:55432/motor"\n',
      // Una copia de .env.example olvidada en la raíz: valores de ejemplo, sin contraseña.
      ".env": 'DATABASE_URL="postgresql://postgres@127.0.0.1:55432/motor"\n',
    },
    (raiz) => {
      delete process.env.DATABASE_URL;
      cargarEnv(raiz);
      assert.equal(process.env.DATABASE_URL, "postgresql://postgres:secreta@127.0.0.1:55432/motor");
    },
  );
});

test("el entorno real le gana a los dos archivos (los tests apuntan a motor_test así)", () => {
  conArchivos({ ".env.local": "DATABASE_URL=del-archivo\n", ".env": "DATABASE_URL=del-env\n" }, (raiz) => {
    process.env.DATABASE_URL = "postgresql://postgres@127.0.0.1:55432/motor_test";
    cargarEnv(raiz);
    assert.equal(process.env.DATABASE_URL, "postgresql://postgres@127.0.0.1:55432/motor_test");
  });
});

test("una variable que solo está en .env se carga igual", () => {
  // .env.local gana donde las dos definen la clave, pero no anula al otro archivo entero.
  conArchivos({ ".env.local": "A=local\n", ".env": "A=plano\nB=solo-en-env\n" }, (raiz) => {
    delete process.env.A;
    delete process.env.B;
    cargarEnv(raiz);
    assert.equal(process.env.A, "local");
    assert.equal(process.env.B, "solo-en-env");
  });
});

test("que falten los archivos no es un error (en prod las variables van en el entorno)", () => {
  conArchivos({}, (raiz) => {
    assert.doesNotThrow(() => cargarEnv(raiz));
  });
});

test("comillas, export, comentarios y líneas vacías", () => {
  const m = parsearEnv(
    ['# un comentario', '', 'DOBLES="con dobles"', "SIMPLES='con simples'", "export EXPORTADA=si", "PELADA=sin-comillas"].join("\n"),
  );
  assert.equal(m.get("DOBLES"), "con dobles");
  assert.equal(m.get("SIMPLES"), "con simples");
  assert.equal(m.get("EXPORTADA"), "si");
  assert.equal(m.get("PELADA"), "sin-comillas");
  assert.equal(m.size, 4, "el comentario y la línea vacía no son variables");
});

test("el \\r de un archivo guardado en Windows no se cuela en el valor", () => {
  // Es el carácter que más daño hace y menos se ve: pegado al final de una URL la parte, y el
  // archivo abierto en un editor se ve idéntico a uno sano.
  const m = parsearEnv('DATABASE_URL="postgresql://postgres:x@127.0.0.1:55432/motor"\r\nOTRA=valor\r\n');
  assert.equal(m.get("DATABASE_URL"), "postgresql://postgres:x@127.0.0.1:55432/motor");
  assert.equal(m.get("OTRA"), "valor");
});

test("un valor con = adentro no se corta (las URLs y los secretos los tienen)", () => {
  // AUTH_SECRET en base64 termina en '=' constantemente.
  const m = parsearEnv("AUTH_SECRET=wYOKHiJJbFhjG3tmEMkzhUoGgSIr5J+4XxYZGpNZFQO=\n");
  assert.equal(m.get("AUTH_SECRET"), "wYOKHiJJbFhjG3tmEMkzhUoGgSIr5J+4XxYZGpNZFQO=");
});

test("dentro de un archivo, la primera aparición gana", () => {
  assert.equal(parsearEnv("A=primera\nA=segunda\n").get("A"), "primera");
});

test("una línea sin = o sin clave se ignora en vez de romper todo", () => {
  const m = parsearEnv("basura sin igual\n=sin-clave\nBUENA=si\n");
  assert.equal(m.get("BUENA"), "si");
  assert.equal(m.size, 1);
});
