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
  const kpi = (await page.locator("p.tenue").first().innerText()).replace(/\s+/g, " ");
  chequeo(/Ocupación .* de .*/.test(kpi), `KPI con denominador: "${kpi}"`);
  await page.screenshot({ path: `${OUT}/1-agenda-owner.png`, fullPage: true });

  // ── 2. Alta de reserva por el formulario ──────────────────────────────────
  console.log("\n[owner] alta de reserva");
  const antes = await page.locator("[aria-label]").count();
  await page.click("summary");
  const sala = await page.locator("#salaId option").first().getAttribute("value");
  await page.selectOption("#salaId", sala);
  await page.fill("#hora", "20:00");
  await page.selectOption("#duracionMin", "60");
  await Promise.all([page.waitForURL(/creada=1|error=/, { timeout: 20_000 }), page.click('button[type="submit"]')]);
  const creada = page.url().includes("creada=1");
  chequeo(creada, `reserva creada (url: ${page.url().split("?")[1]})`);
  const despues = await page.locator("[aria-label]").count();
  chequeo(despues === antes + 1, `la grilla pasó de ${antes} a ${despues} bloques`);
  await page.screenshot({ path: `${OUT}/2-reserva-creada.png`, fullPage: true });

  // ── 3. El mismo slot otra vez: mensaje honesto ────────────────────────────
  console.log("\n[owner] slot ya ocupado");
  await page.click("summary").catch(() => {});
  await page.fill("#hora", "20:00");
  await Promise.all([page.waitForURL(/creada=1|error=/, { timeout: 20_000 }), page.click('button[type="submit"]')]);
  const err = await page.locator("p.error").innerText().catch(() => "");
  chequeo(/ocupar|ocupado|otra sala|fuera de/i.test(err), `error honesto: "${err}"`);
  await page.screenshot({ path: `${OUT}/3-slot-ocupado.png`, fullPage: true });

  // ── 4. El inquilino: sin identidad ajena ni formulario ────────────────────
  console.log("\n[inquilino] privacidad");
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page2 = await ctx2.newPage();
  await entrar(page2, "maria@email.com");
  const html2 = await page2.content();
  chequeo(!/Ana Rodríguez|Carlos López|Pablo Sosa/.test(html2), "no ve nombres de otros inquilinos");
  chequeo(!/Nueva reserva/.test(html2), "no ve el formulario de alta ajena");
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

  console.log(`\n${fallos === 0 ? "TODO OK" : `${fallos} CHEQUEO(S) FALLARON`} · capturas en ${OUT}/`);
} finally {
  await browser.close();
}
process.exit(fallos === 0 ? 0 : 1);
