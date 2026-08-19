// src/lib/email.test.ts — la elección de vía y lo que se escribe en el log.
//
// El envío en sí no se testea acá (hablar con Gmail desde un test es un test de Gmail), pero SÍ
// las dos decisiones que se toman sin red: por dónde sale el correo, y qué NO puede terminar en
// un log.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { emailListo, mailDeReset, sinSecretos, viaDeEmail } from "./email.ts";

const CLAVES = ["RESEND_API_KEY", "EMAIL_FROM", "SMTP_USER", "SMTP_PASS", "SMTP_HOST", "SMTP_PORT"] as const;
const original = Object.fromEntries(CLAVES.map((k) => [k, process.env[k]]));

function entorno(vars: Partial<Record<(typeof CLAVES)[number], string>>) {
  for (const k of CLAVES) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) process.env[k] = v;
}

afterEach(() => {
  for (const k of CLAVES) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

test("sin nada configurado, el envío NO está listo", () => {
  entorno({});
  assert.equal(emailListo(), false);
  assert.equal(viaDeEmail(), null);
});

test("solo con SMTP alcanza: es el centro que todavía no tiene dominio", () => {
  entorno({ SMTP_USER: "centro@gmail.com", SMTP_PASS: "abcd efgh ijkl mnop" });
  assert.equal(emailListo(), true);
  assert.equal(viaDeEmail(), "smtp");
});

test("Resend necesita las DOS variables: una clave sin remitente no sirve", () => {
  entorno({ RESEND_API_KEY: "re_x" });
  assert.equal(emailListo(), false, "sin EMAIL_FROM no hay de dónde mandar");
  entorno({ RESEND_API_KEY: "re_x", EMAIL_FROM: "EMOAPP <no-responder@centro.com>" });
  assert.equal(viaDeEmail(), "resend");
});

test("con las dos configuradas gana Resend, que es la de mejor identidad", () => {
  entorno({
    RESEND_API_KEY: "re_x",
    EMAIL_FROM: "EMOAPP <no-responder@centro.com>",
    SMTP_USER: "centro@gmail.com",
    SMTP_PASS: "abcd efgh ijkl mnop",
  });
  assert.equal(viaDeEmail(), "resend");
});

// ── Lo que no puede terminar en un log ─────────────────────────────────────

test("la contraseña de SMTP se tacha del detalle del error", () => {
  entorno({ SMTP_USER: "centro@gmail.com", SMTP_PASS: "abcd efgh ijkl mnop" });
  // Un error de SMTP real trae el diálogo entero, y ahí viaja la clave.
  const e = new Error('535 auth failed for user centro@gmail.com pass "abcd efgh ijkl mnop"');
  const limpio = sinSecretos(e);
  assert.ok(!limpio.includes("abcd efgh ijkl mnop"), "la clave NO puede quedar en el texto");
  assert.ok(limpio.includes("***"), "y se ve que hubo algo tachado");
  assert.ok(limpio.includes("535 auth failed"), "el resto del error se conserva: es para diagnosticar");
});

test("sin clave configurada no se rompe ni tacha de más", () => {
  entorno({});
  assert.equal(sinSecretos(new Error("conexión rechazada")), "conexión rechazada");
});

test("el mail lleva el enlace en las dos versiones, y el nombre va escapado", () => {
  const m = mailDeReset({ nombre: 'Ana <script>alert(1)</script>', enlace: "https://x.com/restablecer?token=abc", minutos: 60 });
  assert.ok(m.texto.includes("https://x.com/restablecer?token=abc"), "el enlace tiene que estar en el texto plano");
  assert.ok(m.html.includes("https://x.com/restablecer?token=abc"));
  assert.ok(!m.html.includes("<script>"), "el nombre lo escribe una persona: no puede inyectar HTML");
  assert.ok(m.html.includes("&lt;script&gt;"));
});
