// src/lib/plata/mp-firma.ts — validación de la firma del webhook de Mercado Pago (§5.7.3).
// FAIL-CLOSED: sin MP_WEBHOOK_SECRET configurado, NINGUNA notificación es válida. El manifest es
// literal: `id:<data.id en minúsculas>;request-id:<x-request-id>;ts:<ts>;` (cada segmento se
// omite si su valor está ausente), HMAC-SHA256 con el secret, comparación timingSafeEqual. Más
// frescura: se rechaza un ts de más de 5 minutos (anti-replay).

import { createHmac, timingSafeEqual } from "node:crypto";

const VENTANA_MS = 5 * 60 * 1000;

/** Parsea el header x-signature de MP: 'ts=1700000000,v1=abcdef...'. */
function parseXSignature(x: string): { ts: string; v1: string } | null {
  let ts: string | undefined;
  let v1: string | undefined;
  for (const parte of x.split(",")) {
    const [k, ...resto] = parte.split("=");
    const v = resto.join("=").trim();
    if (k?.trim() === "ts") ts = v;
    else if (k?.trim() === "v1") v1 = v;
  }
  return ts && v1 ? { ts, v1 } : null;
}

function igualSegura(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function firmaWebhookValida(a: {
  dataId: string;
  requestId: string;
  xSignature: string | null;
  secret: string | undefined;
  ahoraMs: number;
}): boolean {
  if (!a.secret) return false; // fail-closed: sin secret nada es válido
  if (!a.xSignature) return false;
  const p = parseXSignature(a.xSignature);
  if (!p) return false;

  // frescura (anti-replay): ts en segundos, dentro de ±5 min
  const tsMs = Number(p.ts) * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(a.ahoraMs - tsMs) > VENTANA_MS) return false;

  const segs: string[] = [];
  if (a.dataId) segs.push(`id:${a.dataId.toLowerCase()};`);
  if (a.requestId) segs.push(`request-id:${a.requestId};`);
  segs.push(`ts:${p.ts};`);
  const manifest = segs.join("");

  const esperado = createHmac("sha256", a.secret).update(manifest).digest("hex");
  return igualSegura(esperado, p.v1);
}
