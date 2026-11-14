// Unit tests for web/lib/retest.mjs (a failed re-test is recorded on the entry and shown next to the grade it did not
// replace), plus fleet/merge.mjs end to end on a scratch folder.
// Run from the repository root: node --test fleet/retest.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordFailedAttempt, retestNote, retestShort } from "../web/lib/retest.mjs";

const graded = () => ({
  id: "postgres-mcp",
  name: "postgres-mcp",
  testedAt: "2026-10-15",
  sealmark: { version: "0.2.2", methodology: "0.2" },
  packs: [{ id: "core", status: "graded", letter: "A" }, { id: "db", status: "graded", letter: "D" }],
});

test("a failed re-test of a graded server records the attempt and keeps the grade", () => {
  const servers = [graded()];
  const before = structuredClone(servers[0]);
  assert.equal(recordFailedAttempt(servers, "postgres-mcp", "2026-11-12", "start-fail"), true);
  assert.deepEqual(servers[0].lastAttempt, { date: "2026-11-12", status: "failed", kind: "start-fail" });
  const { lastAttempt, ...rest } = servers[0];
  assert.deepEqual(rest, before);
});

test("a later failure replaces the earlier attempt", () => {
  const servers = [graded()];
  recordFailedAttempt(servers, "postgres-mcp", "2026-11-11", "timeout");
  recordFailedAttempt(servers, "postgres-mcp", "2026-11-12", "start-fail");
  assert.deepEqual(servers[0].lastAttempt, { date: "2026-11-12", status: "failed", kind: "start-fail" });
});

test("a server that has never been graded gets no entry", () => {
  const servers = [graded()];
  assert.equal(recordFailedAttempt(servers, "brand-new", "2026-11-12", "start-fail"), false);
  assert.equal(servers.length, 1);
  assert.equal(recordFailedAttempt([], "brand-new", "2026-11-12", "start-fail"), false);
});

test("an unknown kind is stored as other", () => {
  for (const kind of [undefined, "no-report", "toString", "other"]) {
    const servers = [graded()];
    recordFailedAttempt(servers, "postgres-mcp", "2026-11-12", kind);
    assert.equal(servers[0].lastAttempt.kind, "other");
  }
});

test("the note says when the re-test failed, why, and how old the grade is", () => {
  const x = { ...graded(), lastAttempt: { date: "2026-11-12", status: "failed", kind: "start-fail" } };
  assert.equal(retestNote(x), "The latest re-test, on 2026-11-12, could not start the server, so this grade is still the one from 2026-10-15.");
  assert.equal(retestShort(x), "re-test 2026-11-12: server did not start");
});

test("each failure kind has its own words, and any other one reads as failed", () => {
  const x = (kind) => ({ ...graded(), lastAttempt: { date: "2026-11-12", status: "failed", kind } });
  assert.equal(retestShort(x("timeout")), "re-test 2026-11-12: timed out");
  assert.equal(retestShort(x("sealmark-crash")), "re-test 2026-11-12: stopped on a Sealmark error");
  assert.equal(retestShort(x("other")), "re-test 2026-11-12: failed");
  assert.equal(retestShort(x("toString")), "re-test 2026-11-12: failed");
  assert.equal(retestNote(x("other")), "The latest re-test, on 2026-11-12, failed, so this grade is still the one from 2026-10-15.");
  assert.equal(retestNote(x("timeout")), "The latest re-test, on 2026-11-12, timed out, so this grade is still the one from 2026-10-15.");
});

test("no note without a failed attempt, or when the attempt is older than the grade", () => {
  assert.equal(retestNote(graded()), null);
  assert.equal(retestShort(graded()), null);
  assert.equal(retestNote({ ...graded(), lastAttempt: null }), null);
  const stale = { ...graded(), testedAt: "2026-11-12", lastAttempt: { date: "2026-11-01", status: "failed", kind: "timeout" } };
  assert.equal(retestNote(stale), null);
  assert.equal(retestShort(stale), null);
  const garbled = { ...graded(), lastAttempt: { status: "failed", kind: "timeout" } };
  assert.equal(retestNote(garbled), null);
});

test("a typed start failure is stored with the attempt and worded in its own terms", () => {
  const servers = [graded()];
  recordFailedAttempt(servers, "postgres-mcp", "2026-11-12", "start-fail", "needs-credentials");
  assert.deepEqual(servers[0].lastAttempt, { date: "2026-11-12", status: "failed", kind: "start-fail", startKind: "needs-credentials" });
  assert.equal(retestShort(servers[0]), "re-test 2026-11-12: server did not start (looks like it needs a credential)");
  assert.equal(retestNote(servers[0]), "The latest re-test, on 2026-11-12, could not start the server (it looks like it needs a credential), so this grade is still the one from 2026-10-15.");
});

test("each start failure kind has hedged words; unknown, a made-up kind and a non-start failure keep the plain words", () => {
  const x = (startKind, kind = "start-fail") => ({ ...graded(), lastAttempt: { date: "2026-11-12", status: "failed", kind, ...(startKind ? { startKind } : {}) } });
  assert.match(retestShort(x("dependency-resolution")), /a dependency could not be installed/);
  assert.match(retestShort(x("missing-runtime")), /a runtime it needs is missing/);
  assert.match(retestShort(x("bad-launch")), /the launch command did not work/);
  assert.match(retestShort(x("initialize-timeout")), /did not answer in time/);
  for (const k of ["unknown", "toString", "<script>", undefined]) assert.equal(retestShort(x(k)), "re-test 2026-11-12: server did not start", String(k));
  assert.equal(retestShort(x("needs-credentials", "timeout")), "re-test 2026-11-12: timed out");
  const servers = [graded()];
  recordFailedAttempt(servers, "postgres-mcp", "2026-11-12", "start-fail", "toString");
  assert.equal("startKind" in servers[0].lastAttempt, false);
  recordFailedAttempt(servers, "postgres-mcp", "2026-11-12", "timeout", "needs-credentials");
  assert.equal("startKind" in servers[0].lastAttempt, false);
});

test("merge.mjs: the CLI's typed start failure lands on the entry and in the telemetry, never its advice text", () => {
  const dir = scratch([graded()]);
  try {
    report(dir, "a", { id: "postgres-mcp", version: "0.3.0", ecosystem: "pypi" }, {
      status: "failed", error: "could not start or talk to the server: MCP error -32000: Connection closed",
      sealmark: { version: "1.0.1", methodology: "0.3-draft" },
      startFailure: { kind: "needs-credentials", advice: "give it a key" },
    });
    report(dir, "b", { id: "other", version: "1.0.0", ecosystem: "npm" }, {
      status: "failed", error: "Connection closed", startFailure: { kind: "<made up>", advice: "x" },
    });
    merge(dir);
    const [x] = results(dir);
    assert.equal(x.lastAttempt.startKind, "needs-credentials");
    const tel = fs.readFileSync(path.join(dir, "fleet", "telemetry.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(tel.find((t) => t.id === "postgres-mcp").startKind, "needs-credentials");
    assert.equal(tel.find((t) => t.id === "other").startKind, undefined);
    assert.ok(!JSON.stringify(tel).includes("give it a key"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// End to end: merge.mjs works on paths relative to its working directory, so run it in a scratch folder.
const MERGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "merge.mjs");

function scratch(servers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sealmark-merge-"));
  fs.mkdirSync(path.join(dir, "web", "content", "data"), { recursive: true });
  fs.mkdirSync(path.join(dir, "fleet"));
  fs.writeFileSync(path.join(dir, "web", "content", "data", "server-results.json"), JSON.stringify({ servers }));
  return dir;
}
function report(dir, folder, meta, sealmark) {
  const d = path.join(dir, "reports", folder);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "meta.json"), JSON.stringify(meta));
  if (sealmark) fs.writeFileSync(path.join(d, "sealmark.json"), JSON.stringify(sealmark));
}
// merge.mjs reads the date itself: take it before and after, so a run across midnight UTC still passes.
const utcDay = () => new Date().toISOString().slice(0, 10);
function merge(dir) {
  const before = utcDay();
  execFileSync(process.execPath, [MERGE, "reports"], { cwd: dir, encoding: "utf8" });
  return [before, utcDay()];
}
const results = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "web", "content", "data", "server-results.json"), "utf8")).servers;

test("merge.mjs: a start failure marks the graded entry, a new server that fails gets none", () => {
  const dir = scratch([graded()]);
  try {
    const startFail = { status: "failed", error: "could not start or talk to the server: MCP error -32000: Connection closed" };
    report(dir, "a", { id: "postgres-mcp", version: "0.3.0", ecosystem: "pypi" }, startFail);
    report(dir, "b", { id: "brand-new", version: "1.0.0", ecosystem: "npm", isNew: true }, startFail);
    report(dir, "c", { id: "no-report-server", version: "1.0.0", ecosystem: "npm" }, null);
    const days = merge(dir);
    const [x, ...others] = results(dir);
    assert.ok(days.includes(x.lastAttempt.date));
    assert.deepEqual({ ...x.lastAttempt, date: null }, { date: null, status: "failed", kind: "start-fail" });
    assert.equal(x.testedAt, "2026-10-15");
    assert.deepEqual(x.packs, graded().packs);
    assert.deepEqual(others, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("merge.mjs: a graded server whose re-test left no report is marked too", () => {
  const dir = scratch([graded()]);
  try {
    report(dir, "a", { id: "postgres-mcp", version: "0.3.0", ecosystem: "pypi" }, null);
    merge(dir);
    const [x] = results(dir);
    assert.equal(x.lastAttempt.kind, "other");
    assert.equal(x.testedAt, "2026-10-15");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("merge.mjs: a successful re-test replaces the entry and clears the failed attempt", () => {
  const dir = scratch([{ ...graded(), lastAttempt: { date: "2026-11-12", status: "failed", kind: "start-fail" } }]);
  try {
    report(dir, "a", { id: "postgres-mcp", name: "postgres-mcp", version: "0.3.1", ecosystem: "pypi", launch: "uvx postgres-mcp==0.3.1" }, {
      status: "ok",
      startedAt: "2026-11-13T05:00:00Z",
      sealmark: { version: "1.0.0", methodology: "0.3-draft" },
      server: { name: "postgres-mcp", tools: [] },
      packs: { core: { status: "graded", grade: { letter: "B", points: 3, scored: 4, pct: 0.75 } } },
      checks: [],
    });
    merge(dir);
    const [x] = results(dir);
    assert.equal(x.lastAttempt, undefined);
    assert.equal(x.testedAt, "2026-11-13");
    assert.equal(x.packs[0].letter, "B");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
