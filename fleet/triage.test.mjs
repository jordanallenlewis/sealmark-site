// triage.mjs splits the start-failure cluster by the typed kind the CLI reports.
// Run from the repository root: node --test fleet/triage.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TRIAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "triage.mjs");

test("the start-fail cluster lists how many servers fall in each typed kind, and how many are untyped", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sealmark-triage-"));
  try {
    fs.mkdirSync(path.join(dir, "fleet"));
    const rec = (id, extra) => JSON.stringify({ id, status: "failed", failClass: "start-fail", errorSig: "Connection closed", ...extra });
    const ok = (id) => JSON.stringify({ id, status: "ok", ruleHits: [] });
    const lines = [
      ...Array.from({ length: 6 }, (_, i) => rec("c" + i, { startKind: "needs-credentials" })),
      ...Array.from({ length: 3 }, (_, i) => rec("m" + i, { startKind: "missing-runtime" })),
      ...Array.from({ length: 2 }, (_, i) => rec("u" + i, {})),
      ...Array.from({ length: 12 }, (_, i) => ok("ok" + i)),
    ];
    fs.writeFileSync(path.join(dir, "fleet", "telemetry.jsonl"), lines.join("\n") + "\n");
    execFileSync(process.execPath, [TRIAGE], { cwd: dir, encoding: "utf8" });
    const t = JSON.parse(fs.readFileSync(path.join(dir, "fleet", "triage.json"), "utf8"));
    const c = t.clusters.find((x) => x.key === "hardening:start-fail");
    assert.ok(c, "cluster present");
    assert.equal(c.count, 11);
    assert.match(c.detail, /needs-credentials: 6/);
    assert.match(c.detail, /missing-runtime: 3/);
    assert.match(c.detail, /untyped \(older CLI or no kind\): 2/);
    assert.ok(!/should report the reason as a typed result/.test(c.detail), "the old 'should be typed' ask is gone");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A grade drop on the same id@version is only a Sealmark regression when the server's tool surface is unchanged:
// a bridge to a remote endpoint (sealmark#24, atmy-mcp) can gain tools without a new package version.
const runTriage = (lines) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sealmark-triage-"));
  try {
    fs.mkdirSync(path.join(dir, "fleet"));
    fs.writeFileSync(path.join(dir, "fleet", "telemetry.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const stdout = execFileSync(process.execPath, [TRIAGE], { cwd: dir, encoding: "utf8" });
    return { triage: JSON.parse(fs.readFileSync(path.join(dir, "fleet", "triage.json"), "utf8")), summary: fs.readFileSync(path.join(dir, "fleet", "triage-summary.md"), "utf8"), stdout };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
const graded = (id, sealmark, worst, toolCount) => ({ id, status: "ok", serverVersion: "1.1.0", sealmark, worst, ruleHits: [], ...(toolCount === undefined ? {} : { toolCount }) });

test("a grade drop with a changed tool count is a server change, not a grade-drop regression", () => {
  const { triage, summary } = runTriage([graded("bridge", "1.0.0", "B", 11), graded("bridge", "1.0.1", "C", 12)]);
  assert.equal(triage.clusters.find((c) => c.key === "regression:grade-drop"), undefined);
  assert.deepEqual(triage.surfaceChanged, ["bridge"]);
  assert.match(summary, /gained tools.*bridge \(11 to 12 tools, B to C\)/);
});

test("a grade drop with the same tool count is still a grade-drop regression", () => {
  const { triage } = runTriage([graded("steady", "1.0.0", "B", 11), graded("steady", "1.0.1", "C", 11)]);
  const c = triage.clusters.find((x) => x.key === "regression:grade-drop");
  assert.ok(c, "cluster present");
  assert.deepEqual(c.servers, ["steady"]);
  assert.deepEqual(triage.surfaceChanged, []);
});

test("a grade drop where either result lacks a tool count stays a grade-drop regression (no evidence of a server change)", () => {
  const { triage } = runTriage([graded("old", "1.0.0", "B"), graded("old", "1.0.1", "C", 12)]);
  const c = triage.clusters.find((x) => x.key === "regression:grade-drop");
  assert.ok(c, "cluster present");
  assert.deepEqual(c.servers, ["old"]);
});

test("fewer or zero tools on a newer Sealmark stays a grade-drop regression (a tool-listing bug looks the same)", () => {
  const { triage } = runTriage([graded("shrunk", "1.0.0", "B", 12), graded("shrunk", "1.0.1", "C", 6), graded("empty", "1.0.0", "A", 2), graded("empty", "1.0.1", "F", 0)]);
  const c = triage.clusters.find((x) => x.key === "regression:grade-drop");
  assert.ok(c, "cluster present");
  assert.deepEqual(c.servers.sort(), ["empty", "shrunk"]);
  assert.deepEqual(triage.surfaceChanged, []);
});

test("one window keeps a real regression and a server change apart; a changed surface with no drop is in neither", () => {
  const { triage, summary } = runTriage([
    graded("steady", "1.0.0", "B", 4), graded("steady", "1.0.1", "D", 4),
    graded("bridge", "1.0.0", "B", 11), graded("bridge", "1.0.1", "C", 12),
    graded("grew-fine", "1.0.0", "B", 3), graded("grew-fine", "1.0.1", "A", 5),
  ]);
  assert.deepEqual(triage.clusters.find((x) => x.key === "regression:grade-drop").servers, ["steady"]);
  assert.deepEqual(triage.surfaceChanged, ["bridge"]);
  assert.ok(!summary.includes("grew-fine"));
});
