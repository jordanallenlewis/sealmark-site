// Layout-shift guard. Serves the built static export (web/out) and loads pages at 390, 768, 1440, 1920 and 2560 px, with the /api/* calls
// answering, answering slowly, and failing. Each page is watched for 10 s after load; ANY layout-shift entry without recent input fails
// (budget 0: any shift fails). It also compares the geometry of the page's blocks at 0.5 s and at the end of the watch (10 s by default): they must be identical.
// Usage: node scripts/cls-check.mjs [--base https://sealmark.dev] [--pages /,/results/] [--widths 390,1440] [--modes ok,slow,fail] [--watch 10000] [--jobs 4]
// Without --base it serves web/out itself. Browser: Google Chrome (installed on GitHub runners) or CHROME_PATH or a Playwright Chromium.
import { chromium } from "playwright-core";
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const WIDTHS = (args.widths ?? "390,768,1440,1920,2560").split(",").map(Number);
const MODES = (args.modes ?? "ok,slow,fail").split(",");
const WATCH = Number(args.watch ?? 10000);
const JOBS = Number(args.jobs ?? 4);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "out");

// One page of each kind: home, list, a result page, docs, a compare page, status. A missing optional page is reported, not skipped silently.
const PAGES = (args.pages ?? "/,/results/,/results/3dstreet-mcp/,/docs/,/docs/concepts/grades/,/compare/,/status/,/notify/,/mcp-conformance-testing/,/disclosure/").split(",");

function findChrome() {
  if (process.env.CHROME_PATH) return { executablePath: process.env.CHROME_PATH };
  const cache = path.join(os.homedir(), ".cache", "ms-playwright");
  if (existsSync(cache)) {
    for (const d of readdirSync(cache).filter((n) => n.startsWith("chromium-"))) {
      for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"]) if (existsSync(path.join(cache, d, sub))) return { executablePath: path.join(cache, d, sub) };
    }
  }
  return { channel: "chrome" };
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain", ".xml": "application/xml" };
async function serve() {
  if (!existsSync(root)) throw new Error(`web/out is missing: run npm run build first`);
  const server = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.startsWith("/api/")) { res.writeHead(404, { "content-type": "application/json" }); return res.end('{"error":"not found"}'); }
    let f = path.join(root, p);
    if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
    try { if ((await stat(f)).isDirectory()) f = path.join(f, "index.html"); } catch { if (!path.extname(f)) f += ".html"; }
    try { const b = await readFile(f); res.writeHead(200, { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream" }); res.end(b); }
    catch { res.writeHead(404, { "content-type": "text/html" }); res.end("not found"); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const SIGNATURE = () => {
  const r = (e) => { const b = e.getBoundingClientRect(); return [e.tagName, Math.round(b.x * 10) / 10, Math.round((b.y + scrollY) * 10) / 10, Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10].join(":"); };
  return { height: document.documentElement.scrollHeight, blocks: [...document.querySelectorAll("header, nav, main, footer, section, h1, h2, table, form, img, svg")].slice(0, 200).map(r) };
};

// Blocks may differ by sub-pixel rounding (under 1 px) between two reads; anything larger is movement.
function differs(a, b) { const x = a.split(":"), y = b.split(":"); return x[0] !== y[0] || x.slice(1).some((v, i) => Math.abs(Number(v) - Number(y[i + 1])) >= 1); }

async function one(browser, base, pagePath, width, mode) {
  const open = async (reducedMotion) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, reducedMotion });
    const page = await ctx.newPage();
    await page.route("**/api/**", async (route) => {
      if (mode === "fail") return route.abort("failed");
      if (mode === "slow") await new Promise((r) => setTimeout(r, 4000));
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await page.addInitScript(() => {
      window.__cls = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls.push({ v: e.value, t: Math.round(e.startTime), src: e.sources.map((s) => `${s.node?.nodeName ?? "?"}.${String(s.node?.className ?? "").slice(0, 40)} ${Math.round(s.previousRect.y)}>${Math.round(s.currentRect.y)} h${Math.round(s.previousRect.height)}>${Math.round(s.currentRect.height)} w${Math.round(s.previousRect.width)}>${Math.round(s.currentRect.width)}`) }); }).observe({ type: "layout-shift", buffered: true });
    });
    const resp = await page.goto(base + pagePath, { waitUntil: "load" });
    return { ctx, page, status: resp?.status() ?? "no response" };
  };
  // Two loads at once. A: the page as a visitor sees it (motion on); every layout-shift entry counts. B: motion reduced from the first paint
  // (decorative autoplay moves things by design); the geometry of every block is read at 0.5 s and at the end and must not differ.
  const [A, B] = await Promise.all([open("no-preference"), open("reduce")]);
  if (A.status !== 200) { await A.ctx.close(); await B.ctx.close(); return { pagePath, width, mode, missing: A.status }; }
  await B.page.waitForTimeout(500);
  const early = await B.page.evaluate(SIGNATURE);
  await A.page.waitForTimeout(WATCH);
  const shifts = await A.page.evaluate(() => window.__cls);
  const late = await B.page.evaluate(SIGNATURE);
  await A.ctx.close(); await B.ctx.close();
  const total = shifts.reduce((a, e) => a + e.v, 0);
  const moved = Math.abs(early.height - late.height) >= 1 ? [`document height ${early.height} > ${late.height}`] : early.blocks.flatMap((b, i) => (late.blocks[i] === undefined || differs(b, late.blocks[i]) ? [`${b} > ${late.blocks[i]}`] : []));
  return { pagePath, width, mode, total, shifts, moved: moved.slice(0, 3) };
}

const external = args.base;
const served = external ? null : await serve();
const base = external ?? served.base;
const browser = await chromium.launch({ ...findChrome(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const jobs = PAGES.flatMap((p) => WIDTHS.flatMap((w) => MODES.map((m) => [p, w, m])));
const results = [];
let next = 0;
await Promise.all(Array.from({ length: JOBS }, async () => { while (next < jobs.length) { const j = jobs[next++]; results.push(await one(browser, base, ...j)); } }));
await browser.close();
served?.server.close();

let bad = 0, checked = 0;
for (const r of results.sort((a, b) => (a.pagePath + a.width + a.mode).localeCompare(b.pagePath + b.width + b.mode))) {
  if (r.missing) { bad++; console.log(`FAIL ${r.pagePath} @${r.width} ${r.mode}: HTTP ${r.missing}`); continue; }
  checked++;
  const shifted = r.total > 0;
  if (shifted || r.moved.length) { bad++; console.log(`FAIL ${r.pagePath} @${r.width} ${r.mode}: CLS ${r.total.toFixed(4)}${r.moved.length ? `; blocks moved between 0.5 s and ${WATCH / 1000} s: ${r.moved.join(" | ")}` : ""}`); for (const s of r.shifts.slice(0, 3)) console.log(`     t=${s.t}ms value=${s.v.toFixed(5)} ${s.src.slice(0, 3).join(" ; ")}`); }
}
console.log(`cls-check: ${checked} page loads watched for ${WATCH / 1000} s (${PAGES.length} pages x ${WIDTHS.length} widths x ${MODES.length} api modes), ${bad} failing`);
if (checked === 0) { console.log("cls-check: nothing was checked"); process.exit(1); }
process.exit(bad ? 1 : 0);
