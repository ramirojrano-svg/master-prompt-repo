// scripts/humo.mjs — prueba de humo end-to-end con un browser real (Chromium).
// Maneja la app como la maneja el operador: login, agenda, alta de reserva, y saca capturas.
// Uso:  npm run dev  (en otra terminal)  &&  node scripts/humo.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const SLUG = process.env.SLUG ?? "espacio-moca";
const PASS = process.env.SEED_PASSWORD ?? "emoapp-2026";
const OUT = "capturas";

mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log("  ", ...a);

/**
 * Espera a que una condición del DOM se cumpla, y devuelve si se cumplió.
 *
 * Reemplaza a `waitForURL(/ok=1/)` después de una acción. Ese patrón resolvía AL INSTANTE cuando
 * la URL ya traía `ok=1` de la acción anterior, y entonces la aserción de abajo leía el DOM viejo:
 * el chequeo fallaba por una carrera y no porque la app estuviera mal. Esperar el resultado que se
 * va a afirmar sirve igual con recarga completa que con navegación del lado del cliente.
 */
async function esperar(fn, ms = 15_000) {
  const hasta = Date.now() + ms;
  do {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 200));
  } while (Date.now() < hasta);
  return false;
}

/** Abre el <details> del alta sin togglear: si ya está abierto, un click lo CERRARÍA. */
async function abrirAlta(page) {
  await page.evaluate(() => document.querySelector("details")?.setAttribute("open", ""));
}

async function entrar(page, email) {
  await page.goto(`${BASE}/login?centro=${SLUG}`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", email);
  await page.fill("#password", PASS);
  await Promise.all([page.waitForURL(/\/panel\//, { timeout: 20_000 }), page.click('button[type="submit"]')]);
}

// El entorno trae Chromium preinstalado con otra versión que la del paquete: se apunta al
// binario directamente en vez de bajar uno (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD).
const EJECUTABLE = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EJECUTABLE, args: ["--no-sandbox"] });
let fallos = 0;
const chequeo = (ok, msg) => {
  console.log(ok ? `  ✓ ${msg}` : `  ✗ ${msg}`);
  if (!ok) fallos++;
};

try {
  // ── 1. El operador ────────────────────────────────────────────────────────
  console.log("\n[owner] agenda del día");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await entrar(page, "ramirojrano@gmail.com");

  const bloques = await page.locator("[aria-label]").count();
  chequeo(bloques > 0, `la grilla muestra ${bloques} bloques`);
  const kpi = (await page.locator("#kpi").innerText()).replace(/\s+/g, " ");
  chequeo(/Ocupación .* de .*/.test(kpi), `KPI con denominador: "${kpi}"`);
  await page.screenshot({ path: `${OUT}/1-agenda-owner.png`, fullPage: true });

  // ── 2. Alta de reserva por el formulario ──────────────────────────────────
  console.log("\n[owner] alta de reserva");
  const antes = await page.locator("[aria-label]").count();
  const sala = await page.locator("#salaId option").first().getAttribute("value");
  // El script tiene que poder correrse VARIAS VECES seguidas sin reseed: se busca un hueco libre
  // en vez de clavar uno. (La primera versión clavaba 20:00 y la segunda corrida se chocaba sola.)
  const horasPosibles = Array.from({ length: 28 }, (_, k) => {
    const m = 8 * 60 + k * 30;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${m % 60 ? "30" : "00"}`;
  }).reverse(); // de la tarde para atrás: la mañana del seed está más llena
  let hora = null;
  for (const h of horasPosibles) {
    await abrirAlta(page);
    await page.selectOption("#salaId", sala);
    await page.fill("#hora", h);
    await page.selectOption("#duracionMin", "60");
    // Se espera a que la URL CAMBIE, no a que matchee /creada=1|error=/: después del primer
    // intento fallido la URL ya trae `error=`, el waitForURL resolvía al instante sin esperar la
    // navegación, y a partir de ahí el bucle leía siempre la URL vieja. Con eso, un alta que
    // funcionaba perfecto se reportaba como fallada.
    const urlPrevia = page.url();
    await Promise.all([
      page.waitForURL((u) => u.toString() !== urlPrevia, { timeout: 20_000 }),
      page.click('form button[type="submit"]'),
    ]);
    if (page.url().includes("creada=1")) { hora = h; break; }
  }
  chequeo(hora !== null, `reserva creada a las ${hora ?? "—"} (url: ${page.url().split("?")[1]})`);
  const despues = await page.locator("[aria-label]").count();
  chequeo(despues === antes + 1, `la grilla pasó de ${antes} a ${despues} bloques`);
  await page.screenshot({ path: `${OUT}/2-reserva-creada.png`, fullPage: true });

  // ── 3. El mismo slot otra vez: mensaje honesto ────────────────────────────
  console.log("\n[owner] slot ya ocupado");
  await abrirAlta(page);
  await page.selectOption("#salaId", sala);
  await page.fill("#hora", hora ?? "20:00");
  await Promise.all([page.waitForURL(/creada=1|error=/, { timeout: 20_000 }), page.click('button[type="submit"]')]);
  const err = await page.locator("p.error").innerText().catch(() => "");
  chequeo(/ocupar|ocupado|otra sala|fuera de/i.test(err), `error honesto: "${err}"`);
  await page.screenshot({ path: `${OUT}/3-slot-ocupado.png`, fullPage: true });

  // ── 3-bis. Arrastrar un turno ─────────────────────────────────────────────
  // Se disparan DragEvent de verdad en vez de mover el mouse: Chromium entra en un bucle de
  // arrastre nativo con el que Playwright se queda esperando para siempre. Los handlers que se
  // ejercitan son exactamente los mismos, y con ellos la server action y el motor.
  console.log("\n[owner] arrastrar un turno");
  await page.goto(`${BASE}/panel/${SLUG}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200); // hidratación: sin ella el arrastre no hace nada
  const arrastrables = await page.locator('.evento[draggable="true"]').count();
  chequeo(arrastrables > 0, `${arrastrables} turnos arrastrables en la grilla`);

  const etiquetaAntes = await page.locator('.evento[draggable="true"]').first().getAttribute("aria-label");
  const movido = await page.evaluate(() => {
    const blk = document.querySelector('.evento[draggable="true"]');
    const col = blk.parentElement;
    const dt = new DataTransfer();
    const rb = blk.getBoundingClientRect(), rc = col.getBoundingClientRect();
    const x = rc.left + rc.width / 2, y = rb.top + 5 + 120; // 4 filas de 30' = +2 h
    const mk = (t, cx, cy) => new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy });
    blk.dispatchEvent(mk("dragstart", rb.left + 10, rb.top + 5));
    col.dispatchEvent(mk("dragover", x, y));
    // dispatchEvent devuelve false cuando el handler llamó preventDefault, que es EXACTAMENTE lo
    // que tiene que pasar: sin ese preventDefault el navegador descarta el drop.
    return col.dispatchEvent(mk("drop", x, y)) === false;
  });
  chequeo(movido, "la grilla toma el drop (preventDefault)");
  await page.waitForTimeout(3500);

  // Se sigue al turno CONCRETO por su etiqueta, no "el primer bloque de la grilla": al moverse
  // cambia el orden y el primero pasa a ser otro turno, con lo que la comparación daría distinto
  // aunque no se hubiera movido nada.
  const aviso = await page.locator('[role="status"]').first().innerText().catch(() => "");
  const sigueEnElLugar = await page.locator(`[aria-label="${etiquetaAntes}"]`).count();
  // +120px = 4 filas de 30' = dos horas más tarde, con la misma duración.
  const masDosHoras = etiquetaAntes.replace(/(\d\d):(\d\d) – (\d\d):(\d\d)$/, (_, h1, m1, h2, m2) =>
    `${String(+h1 + 2).padStart(2, "0")}:${m1} – ${String(+h2 + 2).padStart(2, "0")}:${m2}`);
  const llegó = await page.locator(`[aria-label="${masDosHoras}"]`).count();

  if (sigueEnElLugar === 0 && llegó === 1) {
    chequeo(true, `el turno se movió dos horas: "${etiquetaAntes}" -> "${masDosHoras}"`);
  } else {
    // Rebotar es un desenlace válido (el destino puede estar ocupado), pero tiene que DECIRLO.
    // El bug que se busca acá es el tercer caso: que soltar el turno no haga nada, en silencio.
    chequeo(/ocupado|otro turno|no abre|liquidado|ausente/i.test(aviso), `rebotó diciendo por qué: "${aviso}"`);
    chequeo(sigueEnElLugar === 1, "si rebota, el turno sigue donde estaba (no se pierde)");
  }
  await page.screenshot({ path: `${OUT}/3b-arrastre.png`, fullPage: true });

  // ── 4. El inquilino: sin identidad ajena ni formulario ────────────────────
  console.log("\n[inquilino] privacidad");
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page2 = await ctx2.newPage();
  await entrar(page2, "maria@email.com");
  const html2 = await page2.content();
  chequeo(!/Ana Rodríguez|Carlos López|Pablo Sosa/.test(html2), "no ve nombres de otros inquilinos");
  chequeo(!/Crear turno/.test(html2), "no ve el formulario de alta ajena");
  const propias = await page2.locator('[aria-label*="María Gómez"]').count();
  chequeo(propias > 0, `sí ve sus propias reservas (${propias})`);
  await page2.screenshot({ path: `${OUT}/4-vista-inquilino.png`, fullPage: true });

  // ── 5. Mobile ─────────────────────────────────────────────────────────────
  console.log("\n[mobile] iPhone SE");
  const ctx3 = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  const page3 = await ctx3.newPage();
  await entrar(page3, "ramirojrano@gmail.com");
  const scrollBody = await page3.evaluate(() => document.body.scrollWidth > document.documentElement.clientWidth + 1);
  chequeo(!scrollBody, "el <body> NO scrollea horizontal (§6.5)");
  await page3.screenshot({ path: `${OUT}/5-mobile.png`, fullPage: true });


  // ── 6. ABM de salas e inquilinos (el onboarding real, §6.12) ──────────────
  console.log("\n[owner] ABM de salas");
  await page.goto(`${BASE}/panel/${SLUG}/salas`, { waitUntil: "domcontentloaded" });
  const salasAntes = await page.locator("tbody tr").count();
  const nombreSala = `Consultorio de prueba ${Date.now().toString().slice(-5)}`;
  await page.fill("#nombre", nombreSala);
  await page.fill("#desde", "09:00");
  await page.fill("#hasta", "18:00");
  await Promise.all([page.waitForURL(/ok=1|error=/, { timeout: 20_000 }), page.click('button:has-text("Crear consultorio")')]);
  const salasDespues = await page.locator("tbody tr").count();
  chequeo(salasDespues === salasAntes + 1, `salas: ${salasAntes} -> ${salasDespues}`);
  const resumen = await page.locator(`tbody tr:has-text("${nombreSala}")`).innerText();
  chequeo(/09:00-18:00/.test(resumen), `horario guardado y resumido: "${resumen.replace(/\s+/g, " ").trim()}"`);
  await page.screenshot({ path: `${OUT}/6-salas.png`, fullPage: true });

  console.log("\n[owner] archivar sala (no borrar)");
  await page.locator(`tbody tr:has-text("${nombreSala}")`).locator('button:has-text("Archivar")').click();
  const rotulada = page.locator(`tbody tr:has-text("${nombreSala}"):has-text("(archivada)")`);
  const seRotulo = await esperar(async () => (await rotulada.count()) === 1);
  const filas = await page.locator("tbody tr").count();
  chequeo(filas === salasDespues, "la sala archivada SIGUE en la lista (no se borró)");
  chequeo(seRotulo, "la sala archivada se muestra rotulada, sin desaparecer");

  console.log("\n[owner] ABM de profesionales");
  await page.goto(`${BASE}/panel/${SLUG}/inquilinos`, { waitUntil: "domcontentloaded" });
  const inqAntes = await page.locator("tbody tr").count();
  await page.fill("#nombre", `Profesional de prueba ${Date.now().toString().slice(-5)} (Nutrición)`);
  await Promise.all([page.waitForURL(/ok=1|error=/, { timeout: 20_000 }), page.click('button:has-text("Agregar")')]);
  const inqDespues = await page.locator("tbody tr").count();
  chequeo(inqDespues === inqAntes + 1, `profesionales: ${inqAntes} -> ${inqDespues}`);
  await page.screenshot({ path: `${OUT}/7-inquilinos.png`, fullPage: true });

  // ── 7. Precios (§8.8) ─────────────────────────────────────────────────────
  console.log("\n[owner] precios");
  await page.goto(`${BASE}/panel/${SLUG}/tarifas`, { waitUntil: "domcontentloaded" });
  // Solo la PRIMERA tabla (los precios cargados): la segunda es el cuadro por profesional.
  const filasPrecios = () => page.locator("table").first().locator("tbody tr").count();
  const preciosAntes = await filasPrecios();
  // Un profesional que NO tiene precio propio (el índice 1 del select; el 0 es "Todos").
  const profesional = (await page.locator("#inquilinoId option").nth(1).innerText()).trim();
  await page.selectOption("#inquilinoId", { index: 1 });
  await page.fill("#precioHora", "11000");
  await page.click('button:has-text("Guardar precio")');
  const seCargo = await esperar(async () => /11\.000/.test(await page.locator("table").last().innerText()));
  const preciosDespues = await filasPrecios();
  chequeo(preciosDespues === preciosAntes + 1, `precios vigentes: ${preciosAntes} -> ${preciosDespues} (${profesional})`);
  chequeo(seCargo, "el cuadro muestra el precio nuevo resuelto por profesional");
  await page.screenshot({ path: `${OUT}/8-precios.png`, fullPage: true });

  // Cambiar el precio no edita: cierra el anterior y crea otro. Se ve en que la lista NO crece.
  const antesDeCambiar = await filasPrecios();
  await page.selectOption("#inquilinoId", { index: 1 });
  await page.fill("#precioHora", "12500");
  await page.click('button:has-text("Guardar precio")');
  const seActualizo = await esperar(async () => /12\.500/.test(await page.locator("table").last().innerText()));
  const trasCambiar = await filasPrecios();
  chequeo(trasCambiar === antesDeCambiar, "cambiar un precio no duplica la fila vigente (cierra + crea)");
  chequeo(seActualizo, "el cuadro ya muestra el precio nuevo");

  // Dar de baja el precio de prueba: el alcance vuelve a caer en la general. Además deja la base
  // como estaba, así el script se puede correr dos veces seguidas.
  await page.locator("table").first().locator(`tbody tr:has-text("${profesional}")`).locator('button:has-text("Dar de baja")').click();
  await esperar(async () => (await filasPrecios()) === preciosAntes);
  chequeo(await filasPrecios() === preciosAntes, `dar de baja un precio lo saca de los vigentes (${preciosAntes} otra vez)`);
  chequeo(/8\.000/.test(await page.locator("table").last().innerText()), "sin precio propio, el profesional vuelve a la tarifa general");

  // ── 8. Panel de datos (§6.8) ──────────────────────────────────────────────
  console.log("\n[owner] panel de datos");
  await page.goto(`${BASE}/panel/${SLUG}/reportes`, { waitUntil: "domcontentloaded" });
  const tarjetas = await page.locator(".panel").count();
  chequeo(tarjetas >= 4, `${tarjetas} tarjetas de KPI (facturado, cobrado, deuda, ocupación)`);
  const cuerpo = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  chequeo(/Facturado en el mes/.test(cuerpo), "muestra lo facturado del mes");
  chequeo(/de .*abiertas/.test(cuerpo), "la ocupación muestra su DENOMINADOR");
  chequeo(!/no se pudieron atribuir/.test(cuerpo), "el detalle por profesional suma exacto el total");
  chequeo(/Por consultorio/.test(cuerpo), "hay corte por consultorio");
  await page.screenshot({ path: `${OUT}/9-reportes.png`, fullPage: true });

  await page.click('a[aria-label="Mes anterior"]');
  await page.waitForURL(/periodo=/, { timeout: 20_000 });
  chequeo(/Métricas de/.test(await page.locator("h1").innerText()), "se puede navegar al mes anterior");

  // El detalle por profesional: horas, días y horarios del mes (lo que pidió el operador).
  await page.goto(`${BASE}/panel/${SLUG}/reportes`, { waitUntil: "domcontentloaded" });
  await page.locator("tbody a").first().click();
  await page.waitForURL(/reportes\/[^/?]+/, { timeout: 20_000 });
  const det = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  chequeo(/Horas usadas/.test(det), "el detalle muestra las horas usadas");
  chequeo(/Qué días usa el consultorio|No usó ningún consultorio/.test(det), "muestra qué días usa el consultorio");
  chequeo(/Turno por turno|No usó ningún consultorio/.test(det), "muestra el detalle turno por turno");
  await page.screenshot({ path: `${OUT}/10-detalle-profesional.png`, fullPage: true });

  console.log("\n[recepción] no puede administrar");
  const ctx4 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page4 = await ctx4.newPage();
  await entrar(page4, "ana@email.com");
  await page4.goto(`${BASE}/panel/${SLUG}/salas`, { waitUntil: "domcontentloaded" });
  chequeo(!page4.url().includes("/salas"), `la recepción es redirigida fuera de /salas (${page4.url().split("/").pop()})`);
  await page4.goto(`${BASE}/panel/${SLUG}/tarifas`, { waitUntil: "domcontentloaded" });
  chequeo(!page4.url().includes("/tarifas"), "la recepción no entra a los precios");
  await page4.goto(`${BASE}/panel/${SLUG}/reportes`, { waitUntil: "domcontentloaded" });
  chequeo(!page4.url().includes("/reportes"), "la recepción no ve los agregados de plata (§6.2)");
  // Y la plata tampoco se le filtra por la agenda: ve quién, no cuánto.
  await page4.goto(`${BASE}/panel/${SLUG}`, { waitUntil: "domcontentloaded" });
  chequeo(!/\$\s?8\.000/.test(await page4.content()), "la recepción no ve importes en los bloques de la grilla");

  console.log(`\n${fallos === 0 ? "TODO OK" : `${fallos} CHEQUEO(S) FALLARON`} · capturas en ${OUT}/`);
} finally {
  await browser.close();
}
process.exit(fallos === 0 ? 0 : 1);
