// The "Not graded yet" list on /results/ (data: fleet/not-graded.json, written by fleet/not-graded.mjs).
// Run from web/: node --test lib/not-graded.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REASONS } from "../../fleet/not-graded.mjs";
import { REASON_TEXT, reasonRows } from "./not-graded.mjs";

test("every reason the fleet can write has a label and a meaning", () => {
  for (const r of REASONS) {
    assert.ok(REASON_TEXT[r]?.label, r);
    assert.ok(REASON_TEXT[r]?.meaning, r);
  }
});

test("reasonRows orders reasons by count, then by label, and drops empty or unknown keys", () => {
  const rows = reasonRows({ unknown: 3, "needs-credentials": 5, "bad-launch": 3, "made-up": 9, "missing-runtime": 0 });
  assert.deepEqual(rows.map((r) => [r.reason, r.count]), [["needs-credentials", 5], ["unknown", 3], ["bad-launch", 3]]);
  assert.equal(rows[0].label, REASON_TEXT["needs-credentials"].label);
});

test("no label or meaning calls the list a grade or blames the server for our own failure", () => {
  for (const [r, t] of Object.entries(REASON_TEXT)) {
    assert.doesNotMatch(`${t.label} ${t.meaning}`, /\bgrade[sd]?\b|\bfail(?:s|ed)? (?:the|a) /i, r);
  }
  assert.match(REASON_TEXT["harness-error"].meaning, /ours/);
});

test("the committed list matches its own counts and lists no graded server", () => {
  const data = JSON.parse(readFileSync(new URL("../../fleet/not-graded.json", import.meta.url), "utf8"));
  const graded = new Set(JSON.parse(readFileSync(new URL("../content/data/server-results.json", import.meta.url), "utf8")).servers.map((s) => s.id));
  assert.equal(data.count, data.servers.length);
  assert.equal(Object.values(data.byReason).reduce((a, b) => a + b, 0), data.count);
  for (const s of data.servers) {
    assert.ok(!graded.has(s.id), s.id);
    assert.ok(REASONS.includes(s.reason), s.reason);
  }
});
