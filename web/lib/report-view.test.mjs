// node --test lib/   (npm test in web/)
// Shareable report links (sealmark#33): the viewer reads a JSON report in the browser. These tests pin what it accepts, what
// it refuses, how much it keeps, and the fragment encoding the CLI's `share` command writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { MAX_CHECKS, MAX_INPUT, MAX_TEXT, fragmentBytes, parseReport, toBase64Url } from "./report-view.mjs";

const run = (over = {}) => ({
  sealmark: { version: "1.0.1", methodology: "0.3-draft" },
  server: { name: "demo", version: "2.0.0", command: "node demo.js", transport: "stdio", tools: ["a"] },
  startedAt: "2026-11-20T10:00:00.000Z",
  durationMs: 4200,
  packs: { core: { status: "graded", grade: { pack: "core", points: 9, scored: 10, pct: 90, raw: "B", letter: "B", capped: false, provisional: false, criticalFails: [], excluded: [] } }, db: { status: "na", reason: "no database tool" } },
  checks: [{ id: "core.errors", pack: "core", label: "Errors are errors", critical: true, scope: "server: bad input", verdict: "pass", summary: "ok", evidence: [{ probe: "call a with {}", outcome: "isError true", verifiedBy: "response", tool: "a" }] }],
  notCovered: ["b: no valid input"],
  config: { standard: true, hash: "sha256:abc" },
  ...over,
});

test("a single run and a { runs } file both parse", () => {
  const one = parseReport(JSON.stringify(run()));
  assert.equal(one.ok, true);
  assert.equal(one.runs.length, 1);
  const many = parseReport(JSON.stringify({ runs: [run(), run({ server: { name: "two", version: "1" } })] }));
  assert.equal(many.ok && many.runs.length, 2);
});

test("a run keeps the server, grades, checks and evidence the page shows", () => {
  const r = parseReport(JSON.stringify(run()));
  const v = r.runs[0];
  assert.equal(v.server.name, "demo");
  assert.equal(v.sealmark.version, "1.0.1");
  assert.deepEqual(v.packs.map((p) => [p.id, p.status, p.letter]), [["core", "graded", "B"], ["db", "na", null]]);
  assert.equal(v.packs[1].reason, "no database tool");
  assert.equal(v.checks[0].verdict, "pass");
  assert.equal(v.checks[0].evidence[0].probe, "call a with {}");
  assert.deepEqual(v.notCovered, ["b: no valid input"]);
  assert.equal(v.standard, true);
});

test("bad input is refused with a plain reason", () => {
  assert.match(parseReport("not json").error, /not valid JSON/);
  assert.match(parseReport("[]").error, /no Sealmark run/);
  assert.match(parseReport("{}").error, /no Sealmark run/);
  assert.match(parseReport(JSON.stringify({ packs: {}, checks: "x" })).error, /no Sealmark run/);
  assert.match(parseReport("").error, /empty/);
  assert.match(parseReport(" ".repeat(10) + "x".repeat(MAX_INPUT)).error, /too large/);
  assert.equal(parseReport(123).ok, false);
});

test("a failed run in a { runs } file is listed, not graded", () => {
  const r = parseReport(JSON.stringify({ runs: [run(), { server: "broken", error: "spawn ENOENT", sealmark: { version: "1.0.1" } }] }));
  assert.equal(r.runs.length, 1);
  assert.deepEqual(r.failed, [{ server: "broken" }]);
});

test("unknown letters and verdicts never pass through as grades", () => {
  const bad = run({ packs: { core: { status: "graded", grade: { letter: "A+<script>" } } }, checks: [{ id: "x", pack: "core", label: "L", verdict: "excellent", summary: "s", evidence: [] }] });
  const v = parseReport(JSON.stringify(bad)).runs[0];
  assert.equal(v.packs[0].letter, null);
  assert.equal(v.checks[0].verdict, "inconclusive");
});

test("text is cut to a limit and control characters are dropped", () => {
  const long = "x".repeat(MAX_TEXT + 500);
  const v = parseReport(JSON.stringify(run({ server: { name: long + "\u0007‮", version: "1", command: "c" } }))).runs[0];
  assert.ok(v.server.name.length <= MAX_TEXT + 1);
  assert.ok(!/[\u0007‮]/.test(v.server.name));
});

test("checks are capped", () => {
  const checks = Array.from({ length: MAX_CHECKS + 25 }, (_, i) => ({ id: `c${i}`, pack: "core", label: "L", verdict: "pass", summary: "s", evidence: [] }));
  const r = parseReport(JSON.stringify(run({ checks })));
  assert.equal(r.runs[0].checks.length, MAX_CHECKS);
  assert.equal(r.runs[0].checksCut, 25);
});

test("a run without a name or checks array is not a run", () => {
  assert.equal(parseReport(JSON.stringify(run({ server: null }))).ok, false);
});

test("the share fragment: base64url of raw deflate, with an r= prefix", async () => {
  const json = JSON.stringify(run());
  const frag = "r=" + toBase64Url(deflateRawSync(Buffer.from(json)));
  assert.match(frag, /^r=[A-Za-z0-9_-]+$/);
  const bytes = fragmentBytes("#" + frag);
  assert.ok(bytes instanceof Uint8Array);
  const { inflateRawSync } = await import("node:zlib");
  assert.equal(inflateRawSync(Buffer.from(bytes)).toString(), json);
});

test("fragmentBytes refuses what is not ours", () => {
  assert.equal(fragmentBytes(""), null);
  assert.equal(fragmentBytes("#"), null);
  assert.equal(fragmentBytes("#other=abc"), null);
  assert.equal(fragmentBytes("#r="), null);
  assert.equal(fragmentBytes("#r=!!!"), null);
  assert.equal(fragmentBytes("#r=" + "A".repeat(2_000_000)), null);
});
