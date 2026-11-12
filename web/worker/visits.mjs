// Where sealmark.dev visitors come from: one row per page view with the page, the referring site's host and the UTM
// params (D1 table `visits`, worker/migrations/0003_visits.sql). Nothing that identifies a person: no IP (not even a
// hash), no cookie or stored id, no user agent, no country. The privacy note is /privacy/ (app/privacy/page.tsx).
//   POST /api/visit    {path, landing, referrer, utm_source, utm_medium, utm_campaign} from components/VisitBeacon.tsx
//   GET  /api/visits?days=30   the owner's report, JSON. Needs `Authorization: Bearer <VISITS_TOKEN>` (a Worker secret)
// The hourly tick deletes rows older than KEEP_DAYS.
import { ORIGIN } from "./notify-core.mjs";

export const KEEP_DAYS = 365;
const ORIGINS = new Set([ORIGIN, "https://www.sealmark.dev"]);
const OWN_HOSTS = new Set(["sealmark.dev", "www.sealmark.dev"]);
// Crawlers, link previews and scripts: not visitors. The user agent is read here and never stored.
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|embedly|curl|wget|python|node-fetch|undici|go-http|java\/|okhttp|axios|monitor|uptime/i;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const none = () => new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

// UTM values follow the owner's convention (lowercase letters, digits, hyphens); anything else is lowercased and cut down.
export const cleanTag = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
export function cleanPath(v) {
  const p = String(v ?? "").split(/[?#]/)[0];
  if (!p.startsWith("/") || p.startsWith("//")) return "";
  return p.slice(0, 200);
}
// The referring site's host only (never its path or query). Our own host counts as no referrer.
export function refHost(v) {
  try {
    const u = new URL(String(v ?? ""));
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    const h = u.hostname.toLowerCase().slice(0, 100);
    return OWN_HOSTS.has(h) ? "" : h;
  } catch {
    return "";
  }
}

export async function recordVisit(request, env) {
  // Only pages on sealmark.dev (a browser always sends Origin on a POST), and never a crawler.
  if (!ORIGINS.has(request.headers.get("origin") ?? "")) return json({ ok: false }, 403);
  if (BOT.test(request.headers.get("user-agent") ?? "")) return none();
  let input;
  try {
    const text = await request.text();
    if (text.length > 2000) return json({ ok: false }, 413);
    input = JSON.parse(text);
  } catch {
    return json({ ok: false }, 400);
  }
  if (!input || typeof input !== "object") return json({ ok: false }, 400);
  const path = cleanPath(input.path);
  if (!path) return json({ ok: false }, 400);
  const landing = input.landing === true ? 1 : 0;
  const at = new Date().toISOString().slice(0, 16) + "Z";
  const row = landing
    ? [refHost(input.referrer), cleanTag(input.utm_source), cleanTag(input.utm_medium), cleanTag(input.utm_campaign)]
    : ["", "", "", ""];
  await env.DB.prepare("INSERT INTO visits (at, path, landing, ref_host, utm_source, utm_medium, utm_campaign) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(at, path, landing, ...row)
    .run();
  return none();
}

async function sha256(s) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))));
}
// Compares the two tokens' hashes, so neither the length nor the first differing character shows in the timing.
async function tokenOk(given, expected) {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function visitsReport(request, url, env) {
  if (!env.VISITS_TOKEN) return json({ ok: false, message: "VISITS_TOKEN is not set on the Worker." }, 503);
  const auth = request.headers.get("authorization") ?? "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!given || !(await tokenOk(given, env.VISITS_TOKEN))) return json({ ok: false, message: "Unauthorized." }, 401);
  const days = Math.min(KEEP_DAYS, Math.max(1, Number.parseInt(url.searchParams.get("days") ?? "30", 10) || 30));
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const q = (sql) => env.DB.prepare(sql).bind(since).all().then((r) => r.results);
  const [totals, byDay, sources, referrers, pages, recent] = await Promise.all([
    q("SELECT COUNT(*) AS pageviews, COALESCE(SUM(landing), 0) AS visits, COALESCE(SUM(landing = 1 AND ref_host = '' AND utm_source = ''), 0) AS direct FROM visits WHERE at >= ?"),
    q("SELECT substr(at, 1, 10) AS day, COUNT(*) AS pageviews, SUM(landing) AS visits FROM visits WHERE at >= ? GROUP BY day ORDER BY day"),
    q("SELECT utm_source AS source, utm_medium AS medium, utm_campaign AS campaign, COUNT(*) AS visits FROM visits WHERE at >= ? AND landing = 1 AND utm_source != '' GROUP BY 1, 2, 3 ORDER BY visits DESC LIMIT 50"),
    q("SELECT ref_host AS host, COUNT(*) AS visits FROM visits WHERE at >= ? AND landing = 1 AND ref_host != '' GROUP BY 1 ORDER BY visits DESC LIMIT 50"),
    q("SELECT path, COUNT(*) AS pageviews, SUM(landing) AS landings FROM visits WHERE at >= ? GROUP BY 1 ORDER BY pageviews DESC LIMIT 30"),
    q("SELECT at, path, ref_host AS host, utm_source AS source, utm_medium AS medium, utm_campaign AS campaign FROM visits WHERE at >= ? AND landing = 1 ORDER BY id DESC LIMIT 50"),
  ]);
  return json({
    ok: true,
    days,
    since,
    pageviews: totals[0]?.pageviews ?? 0,
    visits: totals[0]?.visits ?? 0,
    direct: totals[0]?.direct ?? 0, // landings with neither a referring site nor UTM params
    byDay,
    sources,
    referrers,
    pages,
    recent,
  });
}

export async function purgeVisits(env) {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString();
  const r = await env.DB.prepare("DELETE FROM visits WHERE at < ?").bind(cutoff).run();
  const n = Number(r?.meta?.changes ?? 0);
  if (n) console.log(`[visits] deleted ${n} rows older than ${KEEP_DAYS} days`);
}
