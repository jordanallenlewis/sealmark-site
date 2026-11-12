// node --test "worker/*.test.mjs"   (from web/) The visit counter (worker/visits.mjs) through the Worker's fetch and
// scheduled handlers, on SQLite built from worker/migrations (node:sqlite standing in for D1). No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { cleanPath, cleanTag, refHost } from "./visits.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "sealmark-visits-"));
for (const f of ["index.js", "notify-core.mjs", "visits.mjs"]) copyFileSync(join(here, f), join(tmp, f));
writeFileSync(join(tmp, "grades.json"), "{}");
writeFileSync(join(tmp, "package.json"), JSON.stringify({ type: "module" }));
const { default: worker } = await import(pathToFileURL(join(tmp, "index.js")).href);

function d1() {
  const db = new DatabaseSync(":memory:");
  const dir = join(here, "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(join(dir, f), "utf8"));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  return { db, prepare: (sql) => stmt(sql), batch: async (l) => Promise.all(l.map((s) => s.run())) };
}
const makeEnv = (over = {}) => ({ DB: d1(), VISITS_TOKEN: "owner-token", NOTIFY_LIVE: "0", ...over });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36";
const beacon = (env, body, { origin = "https://sealmark.dev", ua = UA } = {}) =>
  worker.fetch(new Request("https://sealmark.dev/api/visit", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "text/plain", "user-agent": ua, ...(origin ? { origin } : {}) } }), env);
const report = (env, token = "owner-token", q = "") =>
  worker.fetch(new Request(`https://sealmark.dev/api/visits${q}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }), env);
const rows = (env) => env.DB.db.prepare("SELECT path, landing, ref_host, utm_source, utm_medium, utm_campaign FROM visits ORDER BY id").all().map((r) => ({ ...r }));

test("a landing keeps the referring host and UTM; a later page keeps only the path", async () => {
  const env = makeEnv();
  assert.equal((await beacon(env, { path: "/results/?x=1#a", landing: true, referrer: "https://www.linkedin.com/feed/some/post?id=9", utm_source: "LinkedIn", utm_medium: "social", utm_campaign: "featured" })).status, 204);
  assert.equal((await beacon(env, { path: "/docs/", landing: false, referrer: "https://evil.example/", utm_source: "x" })).status, 204);
  assert.deepEqual(rows(env), [
    { path: "/results/", landing: 1, ref_host: "www.linkedin.com", utm_source: "linkedin", utm_medium: "social", utm_campaign: "featured" },
    { path: "/docs/", landing: 0, ref_host: "", utm_source: "", utm_medium: "", utm_campaign: "" },
  ]);
  const cols = env.DB.db.prepare("SELECT name FROM pragma_table_info('visits')").all().map((c) => c.name);
  assert.deepEqual(cols.filter((c) => /ip|agent|ua|country|visitor|session/i.test(c)), [], "nothing that identifies a person");
});

test("other origins, crawlers and junk are not recorded", async () => {
  const env = makeEnv();
  assert.equal((await beacon(env, { path: "/", landing: true }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await beacon(env, { path: "/", landing: true }, { origin: null })).status, 403);
  assert.equal((await beacon(env, { path: "/", landing: true }, { ua: "Googlebot/2.1" })).status, 204);
  assert.equal((await beacon(env, { path: "https://x.example/", landing: true })).status, 400);
  assert.equal((await beacon(env, { path: "//x.example/", landing: true })).status, 400);
  assert.equal(rows(env).length, 0);
});

test("the owner report needs the token and sums sources, referrers and pages", async () => {
  const env = makeEnv();
  await beacon(env, { path: "/", landing: true, utm_source: "linkedin", utm_medium: "social", utm_campaign: "featured" });
  await beacon(env, { path: "/", landing: true, utm_source: "linkedin", utm_medium: "social", utm_campaign: "featured" });
  await beacon(env, { path: "/docs/", landing: true, referrer: "https://news.ycombinator.com/item?id=1" });
  await beacon(env, { path: "/", landing: true, referrer: "https://sealmark.dev/docs/" });
  await beacon(env, { path: "/results/", landing: false });
  assert.equal((await report(env, "")).status, 401);
  assert.equal((await report(env, "wrong")).status, 401);
  assert.equal((await report(makeEnv({ VISITS_TOKEN: undefined }))).status, 503);
  const r = await report(env, "owner-token", "?days=7");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.days, 7);
  assert.equal(body.pageviews, 5);
  assert.equal(body.visits, 4);
  assert.equal(body.direct, 1, "our own host as referrer is a direct visit");
  assert.deepEqual(body.sources, [{ source: "linkedin", medium: "social", campaign: "featured", visits: 2 }]);
  assert.deepEqual(body.referrers, [{ host: "news.ycombinator.com", visits: 1 }]);
  assert.equal(body.pages[0].path, "/");
  assert.equal(body.recent.length, 4);
});

test("the hourly tick deletes rows past the retention window", async () => {
  const env = makeEnv();
  env.DB.db.prepare("INSERT INTO visits (at, path, landing) VALUES ('2020-01-01T00:00Z', '/', 1)").run();
  await beacon(env, { path: "/", landing: true });
  const waits = [];
  await worker.scheduled({}, env, { waitUntil: (p) => waits.push(p.catch(() => {})) });
  await Promise.all(waits);
  assert.equal(rows(env).length, 1);
});

test("cleaning helpers", () => {
  assert.equal(cleanTag("Event 2026-11-15!"), "event-2026-11-15");
  assert.equal(cleanTag("x".repeat(100)).length, 64);
  assert.equal(cleanPath("/a?b#c"), "/a");
  assert.equal(cleanPath("javascript:alert(1)"), "");
  assert.equal(refHost("https://WWW.Sealmark.dev/x"), "");
  assert.equal(refHost("android-app://com.slack/"), "");
  assert.equal(refHost("not a url"), "");
});
