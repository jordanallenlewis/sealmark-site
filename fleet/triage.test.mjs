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
