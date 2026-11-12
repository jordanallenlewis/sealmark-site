// node --test "worker/*.test.mjs"   (from web/) The grade-alert Worker (worker/index.js) end to end: its routes and its hourly tick
// against a real SQLite database built from worker/migrations (node:sqlite standing in for D1), with a fake email
// binding. Sends nothing, needs no network. grades.json is a fixture in a temp copy of the Worker, never the real one.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { holdInconclusive } from "./notify-core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "sealmark-worker-"));
for (const f of ["index.js", "notify-core.mjs"]) copyFileSync(join(here, f), join(tmp, f));
writeFileSync(join(tmp, "grades.json"), "{}");
writeFileSync(join(tmp, "package.json"), JSON.stringify({ type: "module" }));
const { default: worker } = await import(pathToFileURL(join(tmp, "index.js")).href);
const { default: GRADES } = await import(pathToFileURL(join(tmp, "grades.json")).href, { with: { type: "json" } });

// A D1 stand-in: prepare/bind/first/all/run and an all-or-nothing batch, on an in-memory SQLite with the migrations.
function d1() {
  const db = new DatabaseSync(":memory:");
  const dir = join(here, "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(join(dir, f), "utf8"));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    runSync: () => db.prepare(sql).run(...args),
  });
  return {
    db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec("BEGIN");
      try {
        const out = list.map((s) => s.runSync());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

// The email binding: records each send; throws for addresses in `refuse` (a suppressed address, a sending limit).
function makeEnv(over = {}) {
  const sent = [];
  const refuse = new Set();
  const env = {
    NOTIFY_LIVE: "1",
    NOTIFY_SECRET: "test-secret",
    DB: d1(),
    EMAIL: {
      send: async (m) => {
        if (refuse.has(m.to)) throw new Error("recipient is suppressed");
        sent.push(m);
      },
    },
    ...over,
  };
  return { env, sent, refuse };
}

const row = (letter, { version = "1.0.0", sealmark = "1.0.0/0.3-draft", packs, inconclusive = [], failing = [] } = {}) => ({
  name: "demo", version, testedAt: "2026-11-01", sealmark, letter, packs: packs ?? [{ id: "core", letter }], inconclusive, failing, labels: {}, badge: false,
});
function setGrades(map) {
  for (const k of Object.keys(GRADES)) delete GRADES[k];
  Object.assign(GRADES, map);
}
beforeEach(() => setGrades({ s1: row("A"), s2: row("B") }));

let ipSeq = 0;
const nextIp = () => `198.51.100.${(ipSeq++ % 250) + 1}`;
function call(env, path, { method = "GET", body, headers = {} } = {}) {
  return worker.fetch(new Request(`https://sealmark.dev${path}`, { method, body, headers }), env);
}
const subscribeReq = (env, server, email, { ip = nextIp(), origin = "https://sealmark.dev", type = "application/json", body } = {}) =>
  call(env, "/api/notify/subscribe", { method: "POST", body: body ?? JSON.stringify({ server, email }), headers: { "content-type": type, ...(origin ? { origin } : {}), "cf-connecting-ip": ip } });
const confirmUrlIn = (mail) => new URL(mail.text.match(/Confirm \(the link works for 7 days\): (\S+)/)[1]);
async function tick(env) {
  const waits = [];
  await worker.scheduled({}, env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
}
async function subscribed(env, sent, server, email) {
  assert.equal((await subscribeReq(env, server, email)).status, 202);
  const u = confirmUrlIn(sent.findLast((m) => m.to === email));
  assert.equal((await call(env, u.pathname + u.search, { method: "POST" })).status, 200);
}
const status = (env, email, server = "s1") => env.DB.db.prepare("SELECT status FROM subscribers WHERE email = ? AND server_id = ?").get(email, server)?.status;
const changeMails = (sent) => sent.filter((m) => m.subject.startsWith("Sealmark: "));

test("a refused send is logged, the grade is still stored, and nobody gets the notice twice", async () => {
  const { env, sent, refuse } = makeEnv();
  await subscribed(env, sent, "s1", "bounced@example.com");
  await subscribed(env, sent, "s1", "fine@example.com");
  await subscribed(env, sent, "s2", "other@example.com");
  await tick(env); // baseline
  refuse.add("bounced@example.com");
  setGrades({ s1: row("C", { version: "1.1.0" }), s2: row("A", { version: "2.0.0" }) });
  await tick(env);
  assert.deepEqual(changeMails(sent).map((m) => m.to).sort(), ["fine@example.com", "other@example.com"], "the server after the refused send is still processed");
  assert.equal(env.DB.db.prepare("SELECT letter FROM grades WHERE server_id = 's1'").get().letter, "C");
  const d = env.DB.db.prepare("SELECT s.email, d.status, d.error FROM deliveries d JOIN subscribers s ON s.id = d.subscriber_id ORDER BY s.email").all();
  assert.deepEqual(d.map((r) => [r.email, r.status]), [["bounced@example.com", "failed"], ["fine@example.com", "sent"], ["other@example.com", "sent"]]);
  assert.match(d[0].error, /suppressed/);
  const n = env.DB.db.prepare("SELECT recipients, live FROM notices WHERE server_id = 's1'").get();
  assert.deepEqual({ ...n }, { recipients: 1, live: 1 });
  for (let i = 0; i < 3; i++) await tick(env);
  assert.equal(changeMails(sent).length, 2, "later ticks send nothing again");
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) AS n FROM notices").get().n, 2);
});

test("a delivery claimed by an interrupted run is never sent again", async () => {
  const { env, sent } = makeEnv();
  await subscribed(env, sent, "s1", "a@example.com");
  await subscribed(env, sent, "s1", "b@example.com");
  await tick(env);
  // An earlier run wrote the notice and its deliveries, claimed a@ and died mid-send; b@ was still pending.
  const at = new Date(Date.now() - 2 * 3600_000).toISOString();
  env.DB.db.prepare("INSERT INTO notices (id, server_id, letter_from, letter_to, version, failing, recipients, live, sent_at, change) VALUES (7, 's1', 'A', 'D', '1.1.0', '[]', 2, 0, ?, ?)")
    .run(at, JSON.stringify({ from: "A", to: "D", direction: "down", fixed: [], broke: [], row: { letter: "D", packs: [{ id: "core", letter: "D" }], held: [] } }));
  env.DB.db.prepare("INSERT INTO deliveries (notice_id, subscriber_id, status, updated_at) SELECT 7, id, CASE email WHEN 'a@example.com' THEN 'sending' ELSE 'pending' END, ? FROM subscribers").run(at);
  await tick(env);
  assert.deepEqual(changeMails(sent).map((m) => m.to), ["b@example.com"], "the pending one is finished, the claimed one is not resent");
  assert.deepEqual(env.DB.db.prepare("SELECT status FROM deliveries ORDER BY subscriber_id").all().map((r) => r.status), ["failed", "sent"]);
  assert.deepEqual({ ...env.DB.db.prepare("SELECT recipients, live FROM notices WHERE id = 7").get() }, { recipients: 1, live: 1 });
});

test("a refused confirm email gets the same answer as any other", async () => {
  const { env, sent, refuse } = makeEnv();
  refuse.add("suppressed@example.com");
  const a = await subscribeReq(env, "s1", "suppressed@example.com");
  const b = await subscribeReq(env, "s1", "ok@example.com");
  assert.equal(a.status, 202);
  assert.deepEqual(await a.json(), await b.json());
  assert.equal(sent.length, 1);
});

test("opening the confirm link (a mail scanner) does not confirm; the button does; bad or old links get 400", async () => {
  const { env, sent } = makeEnv();
  await subscribeReq(env, "s1", "a@example.com");
  const u = confirmUrlIn(sent[0]);
  const get = await call(env, u.pathname + u.search);
  assert.equal(get.status, 200);
  assert.match(await get.text(), /<form method="post"/);
  assert.equal(status(env, "a@example.com"), "pending");
  assert.equal((await call(env, u.pathname + u.search, { method: "POST" })).status, 200);
  assert.equal(status(env, "a@example.com"), "confirmed");

  assert.equal((await call(env, "/api/notify/confirm?t=nothex")).status, 400);
  const wrong = new URL(u);
  wrong.searchParams.set("t", "0".repeat(48));
  const bad = await call(env, wrong.pathname + wrong.search, { method: "POST" });
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /Link not valid/);

  await subscribeReq(env, "s1", "late@example.com");
  env.DB.db.prepare("UPDATE subscribers SET created_at = ? WHERE email = 'late@example.com'").run(new Date(Date.now() - 8 * 86400_000).toISOString());
  const late = confirmUrlIn(sent.at(-1));
  assert.equal((await call(env, late.pathname + late.search, { method: "POST" })).status, 400);
  assert.equal(status(env, "late@example.com"), "pending");
});

test("rate limits count normalized addresses and IPv6 /64s", async () => {
  const { env } = makeEnv();
  const variants = ["First.Last+a@gmail.com", "firstlast+b@googlemail.com", "FIRSTLAST@Gmail.com", "f.i.r.s.t.l.a.s.t@gmail.com"];
  const codes = [];
  for (const v of variants) codes.push((await subscribeReq(env, "s1", v)).status);
  assert.deepEqual(codes, [202, 202, 202, 429]);
  assert.equal((await subscribeReq(env, "s1", "first.last@example.com")).status, 202, "dots only fold for Gmail");

  const v6 = [];
  for (let i = 1; i <= 11; i++) v6.push((await subscribeReq(env, "s2", `u${i}@example.com`, { ip: `2001:db8:1:2::${i.toString(16)}` })).status);
  assert.deepEqual(v6.slice(0, 10), Array(10).fill(202));
  assert.equal(v6[10], 429, "the 11th from one /64 is refused");
  assert.equal((await subscribeReq(env, "s2", "u12@example.com", { ip: "2001:db8:1:3::1" })).status, 202, "another /64 is not");
  assert.equal((await subscribeReq(env, "s2", "u13@example.com", { ip: "2001:0db8:0001:0002:ffff:0:0:1" })).status, 429, "the same /64 written out in full");

  const keys = env.DB.db.prepare("SELECT key FROM attempts").all().map((r) => r.key);
  assert.ok(keys.every((k) => /^(ip|em):[0-9a-f]{64}$/.test(k)));
});

test("subscribe takes only JSON from a sealmark.dev page", async () => {
  const { env, sent } = makeEnv();
  const form = new URLSearchParams({ server: "s1", email: "a@example.com" }).toString();
  assert.equal((await subscribeReq(env, "s1", "a@example.com", { type: "application/x-www-form-urlencoded", body: form })).status, 415);
  assert.equal((await subscribeReq(env, "s1", "a@example.com", { type: "text/plain" })).status, 415);
  assert.equal((await subscribeReq(env, "s1", "a@example.com", { origin: "https://evil.example" })).status, 403);
  assert.equal((await subscribeReq(env, "s1", "a@example.com", { origin: null })).status, 403);
  assert.equal(sent.length, 0);
  assert.equal((await subscribeReq(env, "s1", "a@example.com", { origin: "https://www.sealmark.dev" })).status, 202);
});

test("Turnstile is off unless switched on, and then needs a token", async () => {
  const { env } = makeEnv({ NOTIFY_TURNSTILE: "1", TURNSTILE_SECRET: "x" });
  assert.equal((await subscribeReq(env, "s1", "a@example.com")).status, 403);
  const off = makeEnv();
  assert.equal((await subscribeReq(off.env, "s1", "a@example.com")).status, 202);
});

test("the tick deletes sign-ups left unconfirmed for 7 days", async () => {
  const { env, sent } = makeEnv();
  await subscribeReq(env, "s1", "old@example.com");
  await subscribeReq(env, "s1", "new@example.com");
  await subscribed(env, sent, "s1", "kept@example.com");
  const old = new Date(Date.now() - 8 * 86400_000).toISOString();
  env.DB.db.prepare("UPDATE subscribers SET created_at = ? WHERE email IN ('old@example.com', 'kept@example.com')").run(old);
  await tick(env);
  assert.equal(status(env, "old@example.com"), undefined);
  assert.equal(status(env, "new@example.com"), "pending");
  assert.equal(status(env, "kept@example.com"), "confirmed");
});

test("a mass change sends nothing and keeps the old baselines until released", async () => {
  const { env, sent } = makeEnv();
  const base = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`m${i}`, row("A")]));
  setGrades(base);
  await subscribed(env, sent, "m0", "a@example.com");
  await tick(env);
  const moved = { ...base };
  for (let i = 0; i < 5; i++) moved[`m${i}`] = row("F", { version: "9.9.9" });
  setGrades(moved);
  const errors = [];
  const orig = console.error;
  console.error = (m) => errors.push(m);
  try {
    await tick(env);
    await tick(env);
  } finally {
    console.error = orig;
  }
  assert.equal(changeMails(sent).length, 0);
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) AS n FROM grades WHERE letter = 'F'").get().n, 0, "old baselines kept");
  assert.ok(errors.some((e) => /MASS CHANGE: 5 of 20/.test(e)));

  env.NOTIFY_MASS_CHANGE = "baseline";
  await tick(env);
  assert.equal(changeMails(sent).length, 0);
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) AS n FROM grades WHERE letter = 'F'").get().n, 5, "released: new baselines, no email");

  // 4 of 20 is under the minimum of 5: sent as usual
  delete env.NOTIFY_MASS_CHANGE;
  const four = { ...moved };
  for (let i = 0; i < 4; i++) four[`m${i}`] = row("B", { version: "10.0.0" });
  setGrades(four);
  await tick(env);
  assert.equal(changeMails(sent).length, 1);
});

test("no up/down email when Sealmark's own build changed, or when nothing but the letter changed", async () => {
  const { env, sent } = makeEnv();
  await subscribed(env, sent, "s1", "a@example.com");
  await tick(env);
  setGrades({ s1: row("D", { sealmark: "1.1.0/0.4" }), s2: row("B") });
  await tick(env);
  assert.equal(changeMails(sent).length, 0);
  assert.deepEqual({ ...env.DB.db.prepare("SELECT letter, sealmark FROM grades WHERE server_id = 's1'").get() }, { letter: "D", sealmark: "1.1.0/0.4" }, "new baseline stored silently");

  setGrades({ s1: row("A", { sealmark: "1.1.0/0.4" }), s2: row("B") }); // same server version, same Sealmark
  await tick(env);
  assert.equal(changeMails(sent).length, 0);
  assert.equal(env.DB.db.prepare("SELECT letter FROM grades WHERE server_id = 's1'").get().letter, "D", "ignored, baseline kept");

  setGrades({ s1: row("A", { version: "1.2.0", sealmark: "1.1.0/0.4" }), s2: row("B") });
  await tick(env);
  assert.deepEqual(changeMails(sent).map((m) => m.subject), ["Sealmark: demo went up from D to A"]);
});

test("an area that comes back inconclusive keeps its last grade for alerts", async () => {
  const { env, sent } = makeEnv();
  const packs = [{ id: "core", letter: "A" }, { id: "net", letter: "D" }];
  setGrades({ s1: row("D", { packs }) });
  await subscribed(env, sent, "s1", "a@example.com");
  await tick(env);
  setGrades({ s1: row("A", { version: "1.1.0", packs: [{ id: "core", letter: "A" }], inconclusive: ["net"] }) });
  await tick(env);
  assert.equal(changeMails(sent).length, 0, "no 'went up' from a flaky probe");
  const g = env.DB.db.prepare("SELECT letter, packs FROM grades WHERE server_id = 's1'").get();
  assert.equal(g.letter, "D");
  assert.deepEqual(JSON.parse(g.packs).map((p) => p.id).sort(), ["core", "net"]);
  setGrades({ s1: row("D", { version: "1.2.0", packs }) });
  await tick(env);
  assert.equal(changeMails(sent).length, 0, "and no 'went down' when it is graded again");

  assert.equal(holdInconclusive({ packs }, row("A", { packs: [{ id: "core", letter: "A" }], inconclusive: ["net"] })).letter, "D");
  assert.equal(holdInconclusive({ packs }, row("A", { packs: [{ id: "core", letter: "A" }] })).letter, "A", "a pack that is n/a now is not held");
  assert.equal(holdInconclusive({ packs: [] }, row("A", { inconclusive: ["net"] })).letter, "A");
});

test("unsubscribe from all alerts: a page with a button, then every server stops", async () => {
  const { env, sent } = makeEnv();
  await subscribed(env, sent, "s1", "a@example.com");
  await subscribed(env, sent, "s2", "a@example.com");
  await subscribed(env, sent, "s2", "b@example.com");
  await tick(env);
  setGrades({ s1: row("C", { version: "2.0.0" }), s2: row("B") });
  await tick(env);
  const mail = changeMails(sent)[0];
  assert.ok(mail.headers["List-Unsubscribe"].includes("/api/notify/unsubscribe?"));
  const all = new URL(mail.text.match(/Stop all Sealmark alerts to this address: (\S+)/)[1]);
  assert.match(mail.html, /unsubscribe-all\?s=\d+&amp;t=/);

  assert.match(await (await call(env, all.pathname + all.search)).text(), /Stop all alerts/);
  assert.equal(status(env, "a@example.com", "s2"), "confirmed", "a GET changes nothing");
  const forged = all.pathname + all.search.replace(/t=[0-9a-f]+/, "t=" + "0".repeat(64));
  assert.equal((await call(env, forged, { method: "POST" })).status, 400);
  const single = new URL(mail.headers["List-Unsubscribe"].slice(1, -1));
  assert.equal((await call(env, all.pathname + single.search, { method: "POST" })).status, 400, "a one-server token does not stop all");

  assert.equal((await call(env, all.pathname + all.search, { method: "POST" })).status, 200);
  assert.equal(status(env, "a@example.com", "s1"), "unsubscribed");
  assert.equal(status(env, "a@example.com", "s2"), "unsubscribed");
  assert.equal(status(env, "b@example.com", "s2"), "confirmed");
  assert.equal((await call(env, "/api/notify/unsubscribe?s=1&t=nope")).status, 400);
});

test("the tick does nothing until migration 0002 is applied", async () => {
  const { env } = makeEnv();
  env.DB.db.exec("DROP TABLE deliveries");
  const orig = console.error;
  const errors = [];
  console.error = (m) => errors.push(m);
  try {
    await tick(env);
  } finally {
    console.error = orig;
  }
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) AS n FROM grades").get().n, 0);
  assert.ok(errors.some((e) => /migrations apply/.test(e)));
});
