// evidence.mjs keeps a short, public-safe record of what each check observed (the evidence viewer on the results pages,
// site#65). Run from the repository root: node --test fleet/evidence.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEvidence, mergeEvidence, MAX_LINES, MAX_TEXT } from "./evidence.mjs";
import { CHECK_CLASS } from "./security-checks.mjs";

const publicId = Object.keys(CHECK_CLASS).find((id) => CHECK_CLASS[id] === "public");
const advisoryId = Object.keys(CHECK_CLASS).find((id) => CHECK_CLASS[id] === "advisory");
const privateId = Object.keys(CHECK_CLASS).find((id) => CHECK_CLASS[id] === "private");

const line = (n = 1) => ({ probe: `probe ${n}`, outcome: `outcome ${n}`, verifiedBy: "protocol", tool: "read_file", args: { path: "/x" }, excerpt: "raw reply", code: "x.y", role: "support" });
const report = (checks) => ({ startedAt: "2026-11-16T10:00:00Z", sealmark: { version: "1.0.1" }, config: { hash: "sha256:d13e7893a0acffff" }, checks });

test("a public check keeps probe, outcome, how it was verified and the tool; never args, excerpts, codes or roles", () => {
  const out = checkEvidence(report([{ id: publicId, verdict: "pass", evidence: [line()] }]));
  assert.deepEqual(out, {
    testedAt: "2026-11-16", sealmark: "1.0.1", configHash: "sha256:d13e7893a0ac",
    checks: { [publicId]: { total: 1, lines: [{ probe: "probe 1", outcome: "outcome 1", by: "protocol", tool: "read_file" }] } },
  });
});

test("security checks, advisory checks, critical results and unknown ids keep no evidence (fail closed)", () => {
  const out = checkEvidence(report([
    { id: privateId, verdict: "pass", evidence: [line()] },
    { id: publicId, critical: true, verdict: "pass", evidence: [line()] },
    { id: "a-check-a-newer-cli-adds", verdict: "pass", evidence: [line()] },
    { id: advisoryId, advisory: true, verdict: "fail", evidence: [line()] },
    { id: publicId, verdict: "fail", evidence: [line()] },
  ]));
  assert.deepEqual(Object.keys(out.checks), [publicId]);
});

test("a server the site would hold keeps nothing: an unknown or private id flagged advisory still counts as a finding", () => {
  const pub = { id: publicId, verdict: "pass", evidence: [line()] };
  assert.equal(checkEvidence(report([pub, { id: "some-new-candidate", advisory: true, verdict: "fail", evidence: [] }])), undefined);
  assert.equal(checkEvidence(report([pub, { id: privateId, advisory: true, verdict: "part", summary: "x", evidence: [] }])), undefined);
  assert.ok(checkEvidence(report([pub, { id: advisoryId, advisory: true, verdict: "fail", evidence: [] }])));
});

test("the Sealmark version is kept only when it looks like a version", () => {
  const pub = [{ id: publicId, verdict: "pass", evidence: [line()] }];
  assert.equal(checkEvidence({ ...report(pub), sealmark: { version: "1.0.1-beta.2" } }).sealmark, "1.0.1-beta.2");
  assert.equal(checkEvidence({ ...report(pub), sealmark: { version: "<script>" } }).sealmark, null);
  assert.equal(checkEvidence({ ...report(pub), sealmark: { version: 7 } }).sealmark, null);
});

test("a server with any security finding keeps no evidence at all, on any check", () => {
  const pub = { id: publicId, verdict: "pass", evidence: [line()] };
  assert.equal(checkEvidence(report([pub, { id: privateId, verdict: "fail", evidence: [] }])), undefined);
  assert.ok(checkEvidence(report([pub, { id: privateId, verdict: "pass", evidence: [] }])));
});

test("long lists keep the first lines and the total; long text is cut and marked", () => {
  const out = checkEvidence(report([{ id: publicId, verdict: "pass", evidence: Array.from({ length: MAX_LINES + 4 }, (_, i) => line(i)) }]));
  assert.equal(out.checks[publicId].lines.length, MAX_LINES);
  assert.equal(out.checks[publicId].total, MAX_LINES + 4);
  const long = checkEvidence(report([{ id: publicId, verdict: "pass", evidence: [{ probe: "p", outcome: "word ".repeat(MAX_TEXT), verifiedBy: "response" }] }]));
  const o = long.checks[publicId].lines[0].outcome;
  assert.equal(o.length, MAX_TEXT + 1);
  assert.ok(o.endsWith("…"));
});

test("control, bidi and zero-width characters are removed and whitespace collapsed; odd tools and sources are dropped", () => {
  const out = checkEvidence(report([{ id: publicId, verdict: "pass", evidence: [{ probe: "a\u202eb\u200bc\n\n d\u0007", outcome: "ok", verifiedBy: "made-up", tool: "x\u202ey" }] }]));
  assert.deepEqual(out.checks[publicId].lines[0], { probe: "abc d", outcome: "ok" });
});

test("tokens and runner paths are scrubbed again, after the CLI's own redaction", () => {
  const out = checkEvidence(report([{ id: publicId, verdict: "pass", evidence: [{ probe: "read /home/runner/work/x/secret.txt", outcome: "got ghp_abcdefghijklmnopqrstuvwxyz and sk-abcdefghijkl", verifiedBy: "response" }] }]));
  const l = out.checks[publicId].lines[0];
  assert.equal(l.probe, "read <path>");
  assert.equal(l.outcome, "got <secret> and <secret>");
});

test("checks with no usable evidence are left out; a report with none gives undefined; malformed input never throws", () => {
  assert.equal(checkEvidence(report([{ id: publicId, verdict: "pass", evidence: [] }])), undefined);
  assert.equal(checkEvidence(report([{ id: publicId, verdict: "pass", evidence: [{ probe: "", outcome: "" }, null, 3] }])), undefined);
  assert.equal(checkEvidence(null), undefined);
  assert.equal(checkEvidence({ checks: "x" }), undefined);
});

test("mergeEvidence replaces a server's record, deletes it when the new run keeps none or the server left the results, and sorts ids", () => {
  const rec = { testedAt: "2026-11-16", sealmark: "1.0.1", configHash: "h", checks: {} };
  const all = { zeta: rec, alpha: { ...rec, testedAt: "2026-11-01" }, gone: rec };
  const after = mergeEvidence(all, [["alpha", rec], ["zeta", undefined], ["mid", rec], ["notinresults", rec]], new Set(["alpha", "zeta", "mid"]));
  assert.deepEqual(Object.keys(after), ["alpha", "mid"]);
  assert.equal(after.alpha.testedAt, "2026-11-16");
  assert.equal(mergeEvidence(all, [["__proto__", rec]], new Set(["__proto__"])).__proto__, Object.prototype);
});
