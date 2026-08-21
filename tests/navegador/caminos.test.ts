// tests/navegador/caminos.test.ts — los seis caminos que ya se rompieron una vez.
//
// No es una suite de interfaz completa y no pretende serlo. Es una red sobre los errores que esta
// app YA tuvo, todos de la misma clase: la app responde 200 y hace lo que no se le pidió. No
// lanzan excepción, así que ninguna prueba de servidor los ve — se descubrieron mirando la
// pantalla, y volvieron a aparecer porque nada los vigilaba.
//
// Corre contra el servidor de desarrollo, que tiene que estar levantado:
//
//     npm run dev              (en una terminal)
//     npm run test:navegador   (en otra)
//
// Se saltea sola si no lo encuentra: obligar a levantar Next para correr `npm test` volvería
// lenta la suite que se corre todo el tiempo.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { chromium, devices, type Browser, type Page } from "playwright";

const BASE = process.env.URL_PRUEBA ?? "http://127.0.0.1:3000";
const CENTRO = process.env.CENTRO_PRUEBA ?? "espacio-moca";
const USUARIO = process.env.USUARIO_PRUEBA ?? "ramirojrano@gmail.com";
const CLAVE = process.env.CLAVE_PRUEBA ?? "emoapp-2026";
const EJECUTABLE = process.env.PLAYWRIGHT_CHROMIUM ?? "/opt/pw-browsers/chromium";

async function hayServidor(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

const arriba = await hayServidor();

describe("caminos de la interfaz", { skip: arriba ? false : "sin servidor en " + BASE }, () => {
  let navegador: Browser;

  before(async () => {
    navegador = await chromium.launch({ executablePath: EJECUTABLE });
  });
  after(async () => {
    await navegador?.close();
  });

  /** Una pestaña ya autenticada. Cada prueba abre la suya: compartir sesión las acopla. */
  async function entrar(movil = false): Promise<Page> {
    const ctx = await navegador.newContext(movil ? devices["Pixel 7"] : { viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/login`);
    await p.fill('input[name="email"]', USUARIO);
    await p.fill('input[type="password"]', CLAVE);
    await p.click('button[type="submit"]');
    await p.waitForURL(/\/panel\//, { timeout: 30_000 });
    return p;
  }

  test("1 · entrar deja la agenda a la vista", async () => {
    const p = await entrar();
    assert.match(p.url(), /\/panel\//);
    assert.ok(await p.locator(".barra").isVisible());
    await p.context().close();
  });

  test("2 · dos clics seguidos en la grilla abren el formulario en la hora tocada", async () => {
    // El bug: el listener que cierra burbujas hacía `open = false` sobre el DOM, React seguía
    // creyendo que estaba abierta, y el segundo clic no mostraba nada.
    const p = await entrar();
    await p.goto(`${BASE}/panel/${CENTRO}?vista=dia`);
    await p.waitForLoadState("networkidle");

    const caja = (await p.locator("[data-columna]").first().boundingBox())!;
    const x = caja.x + caja.width / 2;
    const globo = p.locator("details.crear-flotante");
    const horas: string[] = [];

    for (const dy of [40, 260, 420]) {
      await p.mouse.click(x, caja.y + dy);
      await p.waitForTimeout(1200);
      assert.equal(await globo.evaluate((d: HTMLDetailsElement) => d.open), true, `clic en ${dy}px: el globo quedó cerrado`);
      horas.push(await p.locator("#hora").inputValue());
    }
    assert.equal(new Set(horas).size, 3, `cada clic tiene que traer su hora, vinieron ${horas.join(", ")}`);
    await p.context().close();
  });

  test("3 · el globo de configuración se cierra tocando afuera", async () => {
    // Estaba montado solo en la agenda, y la tuerca vive en el layout: en el resto no cerraba.
    const p = await entrar();
    await p.goto(`${BASE}/panel/${CENTRO}/cierre`);
    await p.waitForLoadState("networkidle");

    const tuerca = p.locator("details.menu-config");
    await tuerca.locator("summary").click();
    await p.waitForTimeout(250);
    assert.equal(await tuerca.evaluate((d: HTMLDetailsElement) => d.open), true);

    await p.mouse.click(700, 520);
    await p.waitForTimeout(350);
    assert.equal(await tuerca.evaluate((d: HTMLDetailsElement) => d.open), false, "no se cerró tocando afuera");
    await p.context().close();
  });

  test("4 · el PDF de una liquidación baja y es un PDF", async () => {
    const p = await entrar();
    await p.goto(`${BASE}/panel/${CENTRO}/cierre`);
    await p.waitForLoadState("networkidle");

    const doc = p.locator('a[title^="Ver la liquidación"]').first();
    if ((await doc.count()) === 0) {
      // Sin ninguna liquidación emitida no hay nada que bajar: no es un fallo de la app.
      await p.context().close();
      return;
    }
    const r = await p.request.get(`${BASE}${await doc.getAttribute("href")}/pdf`);
    assert.equal(r.status(), 200);
    assert.equal(r.headers()["content-type"], "application/pdf");
    assert.match(r.headers()["content-disposition"] ?? "", /^attachment/);
    assert.equal((await r.body()).subarray(0, 5).toString(), "%PDF-", "el archivo no es un PDF");
    await p.context().close();
  });

  test("5 · en el celular ninguna pantalla desborda a lo ancho", async () => {
    // Un desborde horizontal rompe TODA la pantalla, no solo el elemento que se pasó: la barra
    // fija se despega del borde y el riel del menú se corre al desplazarse.
    const p = await entrar(true);
    for (const ruta of ["", "/cierre", "/inquilinos", "/tarifas", "/accesos", "/auditoria", "/gastos"]) {
      await p.goto(`${BASE}/panel/${CENTRO}${ruta}`);
      await p.waitForLoadState("networkidle");
      const m = await p.evaluate(() => ({ ancho: document.documentElement.scrollWidth, pantalla: window.innerWidth }));
      assert.ok(m.ancho <= m.pantalla, `${ruta || "/agenda"} desborda: ${m.ancho} > ${m.pantalla}`);
    }
    await p.context().close();
  });

  test("6 · en el celular se pasa de mes deslizando, y no con un gesto vertical", async () => {
    const p = await entrar(true);
    await p.goto(`${BASE}/panel/${CENTRO}?vista=mes&fecha=2026-08-15`);
    await p.waitForLoadState("networkidle");

    const caja = (await p.locator(".mes-grilla").boundingBox())!;
    const centro = { x: caja.x + caja.width / 2, y: caja.y + caja.height / 2 };

    const deslizar = async (dx: number, dy = 0) => {
      await p.evaluate(
        ([cx, cy, ddx, ddy]) => {
          const el = document.elementFromPoint(cx as number, cy as number)!;
          const toque = (x: number, y: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
          const ev = (tipo: string, x: number, y: number) =>
            el.dispatchEvent(
              new TouchEvent(tipo, {
                bubbles: true,
                cancelable: true,
                touches: tipo === "touchend" ? [] : [toque(x, y)],
                changedTouches: [toque(x, y)],
              }),
            );
          ev("touchstart", cx as number, cy as number);
          ev("touchmove", (cx as number) + (ddx as number) / 2, (cy as number) + (ddy as number) / 2);
          ev("touchend", (cx as number) + (ddx as number), (cy as number) + (ddy as number));
        },
        [centro.x, centro.y, dx, dy],
      );
      await p.waitForTimeout(900);
    };

    const mes = async () => (await p.locator(".barra").innerText()).replace(/\s+/g, " ").trim();
    const inicial = await mes();

    await deslizar(-170);
    const siguiente = await mes();
    assert.notEqual(siguiente, inicial, "deslizar a la izquierda no cambió de mes");

    await deslizar(170);
    assert.equal(await mes(), inicial, "deslizar a la derecha no volvió");

    await deslizar(-25, -190);
    assert.equal(await mes(), inicial, "un gesto vertical no puede cambiar de mes");
    await p.context().close();
  });
});
