// node --test lib/   (npm test in web/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { API_BASE, changesDoc, openapiDoc, serverDoc, serverPath, serverSummary, serversDoc } from "./api.mjs";
import { redactedChecks } from "./disclosure.mjs";

const SITE = "https://sealmark.dev";
const pack = (id, letter, extra = {}) => ({ id, status: letter ? "graded" : "na", letter, points: 1, scored: 1, pct: 100, provisional: false, capped: false, criticalFails: [], reason: letter ? null : "no target", ...extra });
const check = (id, packId, verdict, extra = {}) => ({ id, pack: packId, label: id, critical: false, advisory: false, verdict, summary: `${id} said ${verdict}`, ...extra });
const server = (over = {}) => ({
  id: "srv", name: "@x/srv", ecosystem: "npm", versionTested: "1.2.3", testedAt: "2026-11-14",
  sealmark: { version: "1.0.1", methodology: "0.3-draft" }, standard: true, configHash: "sha256:abc", launch: "npx -y @x/srv@1.2.3 --dsn {dsn}",
  transport: "stdio", toolCount: 2, coverage: { level: "covered", validCalls: 3, toolsCalledValid: 2, toolsTotal: 2 },
  packs: [pack("core", "A"), pack("db", "F", { criticalFails: ["mutating-sql"] }), pack("fs", null)],
  checks: [
    check("protocol", "core", "pass"),
    check("secret-echo", "core", "pass", { critical: true }),
    check("read-only", "db", "pass"),
    check("mutating-sql", "db", "fail", { critical: true }),
    check("db-rowcap", "db", "pass"),
  ],
  notCovered: ["duckdb"], warnings: ["internal"], automated: true,
  ...over,
});

test("summary carries the page's grade, graded areas only, and absolute links", () => {
  const s = serverSummary(server(), { letter: "F", provisional: false }, SITE);
  assert.equal(s.grade, "F");
  assert.deepEqual(s.packs, { core: "A", db: "F" });
  assert.equal(s.page, "https://sealmark.dev/results/srv/");
  assert.equal(s.json, `https://sealmark.dev${API_BASE}/servers/srv.json`);
  assert.equal(s.lastAttemptFailed, null);
  assert.equal(serverSummary(server(), null, SITE).grade, null);
  assert.equal(serverSummary(server({ lastAttempt: { date: "2026-11-15", status: "failed", kind: "timeout" } }), null, SITE).lastAttemptFailed, "2026-11-15");
});

test("a server with no private finding shows every summary, the start command and the repeat command", () => {
  const d = serverDoc(server(), { letter: "F", provisional: false }, new Map(), [], SITE);
  assert.ok(d.checks.every((c) => typeof c.summary === "string" && c.disclosure === null));
  assert.equal(d.launch, "npx -y @x/srv@1.2.3 --dsn {dsn}");
  assert.match(d.reproduce, /^npx -y sealmark@1\.0\.1 run --start /);
  assert.equal(d.packDetails.length, 3);
  assert.equal(d.packDetails[2].reason, "no target");
  assert.equal(d.docs, undefined);
  assert.equal(d.warnings, undefined, "internal warnings are not on the page, so not in the API");
});

test("a private finding hides its summary, its security siblings in the same area, launch and repeat command", () => {
  const x = server();
  const redactions = redactedChecks(x, {}, "2026-11-15"); // no entry: pending-report, redacted
  assert.ok(redactions.has("mutating-sql"));
  const d = serverDoc(x, { letter: "F", provisional: false }, redactions, [], SITE);
  const by = Object.fromEntries(d.checks.map((c) => [c.id, c]));
  assert.equal(by["mutating-sql"].summary, null);
  assert.equal(by["mutating-sql"].disclosure.status, "pending-report");
  assert.equal(by["mutating-sql"].verdict, "fail", "the verdict stays, as on the page");
  assert.equal(by["read-only"].summary, null, "security sibling in the same area is held back");
  assert.equal(by["read-only"].disclosure.status, "held-with-sibling");
  assert.equal(by["db-rowcap"].summary, "db-rowcap said pass", "a public check keeps its evidence");
  assert.equal(by["secret-echo"].summary, "secret-echo said pass", "another area is not held");
  assert.equal(d.launch, null);
  assert.equal(d.reproduce, null);
  const text = JSON.stringify(d);
  assert.ok(!text.includes("mutating-sql said fail") && !text.includes("--dsn"), "nothing redacted leaks anywhere in the document");
});

test("a reported finding past its publish date is public again", () => {
  const x = server();
  const r = redactedChecks(x, { "srv/mutating-sql": { status: "reported", reportedAt: "2026-01-01" } }, "2026-11-15");
  const d = serverDoc(x, null, r, [], SITE);
  assert.equal(d.checks.find((c) => c.id === "mutating-sql").summary, "mutating-sql said fail");
  assert.ok(d.reproduce);
});

test("history runs are copied with the worst letter as grade", () => {
  const d = serverDoc(server(), null, new Map(), [{ date: "2026-11-01", version: "1.0.0", status: "failed", packs: {} }, { date: "2026-11-02", version: "1.0.0", sealmark: "1.0.1", status: "ok", worst: "B", packs: { core: "B" } }], SITE);
  assert.deepEqual(d.history.map((r) => [r.date, r.status, r.grade, r.sealmark]), [["2026-11-01", "failed", null, null], ["2026-11-02", "ok", "B", "1.0.1"]]);
});

test("changes: only between successful runs, failed runs skipped, per-area diff, newest first, limit", () => {
  const run = (date, worst, packs, status = "ok", version = "1") => ({ date, version, status, worst, packs });
  const h = [
    { id: "a", name: "a", linked: true, runs: [run("2026-11-01", "A", { core: "A" }), run("2026-11-02", undefined, {}, "failed"), run("2026-11-03", "A", { core: "A" }), run("2026-11-05", "C", { core: "A", fs: "C" }, "ok", "2")] },
    { id: "b", name: "b", linked: false, runs: [run("2026-11-04", "B", { core: "B" }), run("2026-11-06", "A", { core: "A" })] },
    { id: "c", name: "c", linked: true, runs: [run("2026-11-04", "A", { core: "A" })] },
  ];
  const d = changesDoc(h, SITE, "2026-11-15T00:00:00Z");
  assert.equal(d.total, 2);
  assert.deepEqual(d.changes.map((c) => [c.date, c.id, c.from, c.to]), [["2026-11-06", "b", "B", "A"], ["2026-11-05", "a", "A", "C"]]);
  assert.deepEqual(d.changes[1].packs, { fs: { from: null, to: "C" } });
  assert.equal(d.changes[1].previousVersion, "1");
  assert.equal(d.changes[0].page, null, "a server without a results page links nowhere");
  assert.equal(d.changes[1].page, "https://sealmark.dev/results/a/");
  const one = changesDoc(h, SITE, "x", 1);
  assert.equal(one.count, 1);
  assert.equal(one.total, 2);
});

test("changes: an area letter that moves while the worst grade stays is still a change", () => {
  const d = changesDoc([{ id: "a", name: "a", linked: true, runs: [{ date: "1", version: "1", status: "ok", worst: "D", packs: { core: "A", db: "D" } }, { date: "2", version: "1", status: "ok", worst: "D", packs: { core: "B", db: "D" } }] }], SITE, "x");
  assert.equal(d.total, 1);
  assert.deepEqual(d.changes[0].packs, { core: { from: "A", to: "B" } });
});

test("list document counts its servers", () => {
  const d = serversDoc([serverSummary(server(), null, SITE)], { methodology: "0.3-draft", generatedAt: "t" });
  assert.equal(d.count, 1);
  assert.equal(d.version, "v1");
});

test("OpenAPI document is 3.1, points at /data/v1 and describes the four files", () => {
  const o = openapiDoc(SITE, "1.0.1");
  assert.equal(o.openapi, "3.1.0");
  assert.equal(o.servers[0].url, "https://sealmark.dev/data/v1");
  assert.deepEqual(Object.keys(o.paths), ["/servers.json", "/servers/{id}.json", "/changes.json", "/openapi.json"]);
  for (const ref of JSON.stringify(o).match(/#\/components\/schemas\/\w+/g)) assert.ok(o.components.schemas[ref.split("/").pop()], ref);
  assert.equal(serverPath("srv"), "/data/v1/servers/srv.json");
});
