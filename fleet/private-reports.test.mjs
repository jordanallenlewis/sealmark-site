// node --test fleet/   Private security reports (fleet/private-reports.mjs): who may get one, the exact text, the caps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { alreadyReported, candidates, privateLimitsFrom, repoHash, reportFor, sendReports } from "./private-reports.mjs";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const entry = (repo, over = {}) => ({
  repo,
  servers: [{ id: `${repo}-s`, name: `${repo.split("/")[1]}`, version: "1.2.0", testedAt: "2026-11-15", fresh: true, stale: null, rerun: `npx -y sealmark@1.0.1 run --start "npx -y x@1.2.0"`, results: "https://sealmark.dev/results/x/",
    security: [{ id: "fs-read-escape", label: "a file outside the allowed folder was read", verdict: "fail", summary: "read ../outside.txt" }], ...over }],
});
const history = (id, n = 2) => Array.from({ length: n }, (_, i) => ({ id, version: "1.2.0", testedAt: `2026-11-0${i + 8}`, status: "ok", worst: "D", packs: {} }));
const ctx = (entries, over = {}) => {
  const byId = new Map(entries.flatMap((e) => e.servers).map((x) => [x.id, { id: x.id, versionTested: x.version }]));
  return { pvr: Object.fromEntries(entries.map((e) => [e.repo, true])), byId, ledger: { private: [] }, optout: { repos: [] }, history: entries.flatMap((e) => history(e.servers[0].id)), today: "2026-11-17", self: ["jordanallenlewis"], limits: privateLimitsFrom({}), ...over };
};

test("limits: one per run, 2 a day, 7 a week, an hour apart, by default", () => {
  assert.deepEqual(privateLimitsFrom({}), { perRun: 1, perDay: 2, perWeek: 7, gapMinutes: 60, ownerDays: 7, activeDays: 180 });
  assert.equal(privateLimitsFrom({ OWNER_PRIVATE_PER_DAY: "0" }).perDay, 0);
  assert.equal(privateLimitsFrom({ OWNER_PRIVATE_PER_DAY: "x" }).perDay, 2);
});

test("report text: private, names the finding and its fix, states the disclosure policy and the opt-out, and is exactly what is posted", () => {
  const r = reportFor(entry("acme/mcp"), { fixFor: (id) => (id === "fs-read-escape" ? "Resolve the path and refuse anything outside the root." : "") });
  assert.match(r.title, /a file outside the allowed folder was read in mcp 1\.2\.0 \(automated Sealmark test\)/);
  assert.match(r.body, /sending it privately/);
  assert.match(r.body, /- `fs-read-escape` \(failed\): read \.\.\/outside\.txt\. How to fix: Resolve the path/);
  assert.match(r.body, /14 days for a reply, and publish the finding once it is fixed or on day 90/);
  assert.match(r.body, /reply "opt out"/);
  assert.match(r.body, /sealmark\.dev\/disclosure\//);
  assert.doesNotMatch(r.body, /Claude|Anthropic|Co-authored|Agent:/i);
  assert.equal(reportFor(entry("acme/mcp"), { fixFor: () => "" }).hash.length, 16);
  assert.notEqual(reportFor(entry("acme/other")).hash, r.hash);
});

test("candidates: only a repository with private reporting on, fresh and stable, not opted out, not ours, not already reported", () => {
  const es = ["a/ok", "b/pvroff", "c/stale", "d/single", "e/optout", "jordanallenlewis/own", "g/done", "h/flaky"].map((r) => entry(r));
  es[2] = entry("c/stale", { fresh: false, stale: "grade from 2026-10-01 is older than 14 days" });
  const c = ctx(es);
  c.pvr["b/pvroff"] = false;
  c.history = c.history.filter((h) => h.id !== "d/single-s").concat(history("d/single-s", 1));
  c.history = c.history.map((h) => (h.id === "h/flaky-s" && h.testedAt === "2026-11-09" ? { ...h, worst: "B" } : h));
  c.optout = { repos: ["E/OPTOUT"] };
  c.ledger = { private: [{ h: repoHash("G/Done", "k") }] };
  c.key = "k";
  const out = candidates(es, c);
  assert.deepEqual(out.ready.map((e) => e.repo), ["a/ok"]);
  const why = Object.fromEntries(out.skipped.map((s) => [s.repo, s.why]));
  assert.match(why["b/pvroff"], /not on/);
  assert.match(why["c/stale"], /not fresh/);
  assert.match(why["d/single"], /graded once/);
  assert.equal(why["e/optout"], "opted out");
  assert.equal(why["jordanallenlewis/own"], "our own repository");
  assert.equal(why["g/done"], "already reported");
  assert.match(why["h/flaky"], /flaky/);
  assert.equal(candidates([entry("no/pvr-known")], ctx([entry("no/pvr-known")], { pvr: {} })).ready.length, 0, "unknown private reporting state is not a yes");
  assert.equal(alreadyReported({ private: [{ h: repoHash("x/y", "k") }] }, "X/Y", "k"), true);
  assert.equal(alreadyReported({ private: [{ h: repoHash("x/y", "k") }] }, "X/Y", "other"), false, "without the key the hash tells nothing");
});

test("candidates: the repository with the most findings goes first", () => {
  const two = entry("z/two");
  two.servers[0].security.push({ id: "http-auth", label: "x", verdict: "fail", summary: "y" });
  const es = [entry("a/one"), two];
  assert.deepEqual(candidates(es, ctx(es)).ready.map((e) => e.repo), ["z/two", "a/one"]);
});

test("sendReports: the per-run cap, a recorded hash only, a 403 stops and nothing after it is tried, a 422 is remembered", async () => {
  const mk = (r) => reportFor(entry(r));
  const posted = [];
  const ledger = {};
  const out = await sendReports({ ready: [mk("a/one"), mk("b/two")], ledger, now: NOW, limits: privateLimitsFrom({}), key: "k", post: async (repo, b) => posted.push([repo, b.summary]), save() {}, sleep: async () => {}, log() {} });
  assert.equal(out.sent, 1, "1 per run");
  assert.deepEqual(posted.map((p) => p[0]), ["a/one"]);
  assert.deepEqual(Object.keys(ledger.private[0]).sort(), ["at", "h", "postedAt"], "a hash, never the repository name; the intent flag is gone once sent");
  assert.doesNotMatch(JSON.stringify(ledger), /a\/one/i);
  // the same ledger a minute later: the gap holds the next one back
  const again = await sendReports({ ready: [mk("b/two")], ledger, now: NOW + 60_000, limits: privateLimitsFrom({}), post: async () => { throw new Error("must not post"); }, save() {}, sleep: async () => {}, log() {} });
  assert.deepEqual([again.sent, again.room.code], [0, "spacing"]);
  // a 403 stops the loop
  const l2 = {};
  const stop = await sendReports({ ready: [mk("a/one"), mk("b/two")], ledger: l2, now: NOW, limits: privateLimitsFrom({ OWNER_PRIVATE_PER_RUN: "5", OWNER_PRIVATE_GAP_MINUTES: "1" }), post: async () => { throw Object.assign(new Error("no"), { status: 403 }); }, save() {}, sleep: async () => {}, log() {} });
  assert.deepEqual([stop.sent, stop.stopped, l2.private], [0, "403", []]);
  // a 422 (this repository cannot take a report) is recorded so it is not tried every run, and the next one goes on
  const l3 = {};
  const posts = [];
  const rest = await sendReports({ ready: [mk("a/one"), mk("b/two")], ledger: l3, now: NOW, limits: privateLimitsFrom({ OWNER_PRIVATE_PER_RUN: "5", OWNER_PRIVATE_GAP_MINUTES: "1" }), post: async (repo) => { posts.push(repo); if (repo === "a/one") throw Object.assign(new Error("bad"), { status: 422 }); }, save() {}, sleep: async () => {}, log() {} });
  // 422 may be our own payload: the batch stops and nothing is recorded; 404 is remembered for 14 days, then retried
  assert.deepEqual([rest.sent, rest.stopped, posts, l3.private], [0, "422", ["a/one"], []]);
  const l4 = {};
  const r404 = await sendReports({ ready: [mk("a/one"), mk("b/two")], ledger: l4, now: NOW, limits: privateLimitsFrom({ OWNER_PRIVATE_PER_RUN: "5", OWNER_PRIVATE_GAP_MINUTES: "1" }), key: "k", post: async (repo) => { if (repo === "a/one") throw Object.assign(new Error("gone"), { status: 404 }); }, save() {}, sleep: async () => {}, log() {} });
  assert.deepEqual([r404.sent, l4.private.map((p) => p.failed ?? "ok")], [1, [404, "ok"]]);
  assert.equal(alreadyReported(l4, "a/one", "k", NOW + 864e5), true);
  assert.equal(alreadyReported(l4, "a/one", "k", NOW + 15 * 864e5), false, "retried after 14 days");
});

test("sendReports: a pause stops everything, caps count what was already sent", async () => {
  const mk = (r) => reportFor(entry(r));
  const paused = await sendReports({ ready: [mk("a/one")], ledger: { pause: { code: "negative-reaction", reason: "x", since: "2026-11-01T00:00:00Z", until: null } }, now: NOW, limits: privateLimitsFrom({}), post: async () => { throw new Error("must not post"); }, save() {}, sleep: async () => {}, log() {} });
  assert.deepEqual([paused.sent, paused.room.code], [0, "paused"]);
  const day = { private: [0, 1].map((i) => ({ h: `h${i}`, postedAt: new Date(NOW - (3 + i) * 3600_000).toISOString() })) };
  const capped = await sendReports({ ready: [mk("a/one")], ledger: day, now: NOW, limits: privateLimitsFrom({}), post: async () => { throw new Error("must not post"); }, save() {}, sleep: async () => {}, log() {} });
  assert.deepEqual([capped.sent, capped.room.code], [0, "cap-day"]);
});

test("sendReports: the hash is pushed before the request; a failed push sends nothing; a definite refusal takes the intent back, a timeout keeps it", async () => {
  const mk = (r) => reportFor(entry(r));
  const order = [];
  const ledger = {};
  await sendReports({ ready: [mk("a/one")], ledger, now: NOW, limits: privateLimitsFrom({}), key: "k", persist: async () => order.push(`persist:${ledger.private.length}:${ledger.private[0].intent}`), post: async () => order.push("post"), save() {}, sleep: async () => {}, log() {} });
  assert.deepEqual(order, ["persist:1:true", "post"], "the intent is on the ledger and pushed before the POST");
  const l2 = {};
  const none = await sendReports({ ready: [mk("a/one")], ledger: l2, now: NOW, limits: privateLimitsFrom({}), persist: async () => { throw new Error("push rejected"); }, post: async () => { throw new Error("must not post"); }, save() {}, sleep: async () => {}, log() {} });
  assert.deepEqual([none.sent, none.stopped, l2.private], [0, "persist", []]);
  const l3 = {};
  await sendReports({ ready: [mk("a/one")], ledger: l3, now: NOW, limits: privateLimitsFrom({}), post: async () => { throw Object.assign(new Error("denied"), { status: 403 }); }, save() {}, sleep: async () => {}, log() {} });
  assert.deepEqual(l3.private, [], "a 403 created nothing");
  const l4 = {};
  await sendReports({ ready: [mk("a/one")], ledger: l4, now: NOW, limits: privateLimitsFrom({}), post: async () => { throw new Error("socket hang up"); }, save() {}, sleep: async () => {}, log() {} });
  assert.equal(l4.private.length, 1, "a timeout may have created it: the record stays");
  assert.equal(l4.private[0].intent, true);
});
