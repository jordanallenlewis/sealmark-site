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
import { recordFailedAttempt, retestNote, retestShort, gradeUnconfirmed, unconfirmedWords } from "../web/lib/retest.mjs";

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
  assert.equal(retestShort(x), "grade not confirmed, re-test 2026-11-12: server did not start");
});

test("each failure kind has its own words, and any other one reads as failed", () => {
  const x = (kind) => ({ ...graded(), lastAttempt: { date: "2026-11-12", status: "failed", kind } });
  assert.equal(retestShort(x("timeout")), "grade not confirmed, re-test 2026-11-12: timed out");
  assert.equal(retestShort(x("sealmark-crash")), "grade not confirmed, re-test 2026-11-12: stopped on a Sealmark error");
  assert.equal(retestShort(x("other")), "grade not confirmed, re-test 2026-11-12: failed");
  assert.equal(retestShort(x("toString")), "grade not confirmed, re-test 2026-11-12: failed");
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
  assert.equal(retestShort(servers[0]), "grade not confirmed, re-test 2026-11-12: server did not start (looks like it needs a credential)");
  assert.equal(retestNote(servers[0]), "The latest re-test, on 2026-11-12, could not start the server (it looks like it needs a credential), so this grade is still the one from 2026-10-15.");
});

test("each start failure kind has hedged words; unknown, a made-up kind and a non-start failure keep the plain words", () => {
  const x = (startKind, kind = "start-fail") => ({ ...graded(), lastAttempt: { date: "2026-11-12", status: "failed", kind, ...(startKind ? { startKind } : {}) } });
  assert.match(retestShort(x("dependency-resolution")), /a dependency could not be installed/);
  assert.match(retestShort(x("missing-runtime")), /a runtime it needs is missing/);
  assert.match(retestShort(x("bad-launch")), /the launch command did not work/);
  assert.match(retestShort(x("initialize-timeout")), /did not answer in time/);
  for (const k of ["unknown", "toString", "<script>", undefined]) assert.equal(retestShort(x(k)), "grade not confirmed, re-test 2026-11-12: server did not start", String(k));
  assert.equal(retestShort(x("needs-credentials", "timeout")), "grade not confirmed, re-test 2026-11-12: timed out");
  const servers = [graded()];
  recordFailedAttempt(servers, "postgres-mcp", "2026-11-12", "start-fail", "toString");
  assert.equal("startKind" in servers[0].lastAttempt, false);
  recordFailedAttempt(servers, "postgres-mcp", "2026-11-12", "timeout", "needs-credentials");
  assert.equal("startKind" in servers[0].lastAttempt, false);
});

test("merge.mjs: a failed run's telemetry records the launch line and package name, scrubbed and cut", () => {
  const dir = scratch([graded()]);
  try {
    report(dir, "a", { id: "x-mcp", name: "x-mcp", version: "1.0.0", ecosystem: "github", launch: "npx -y github:acme/x-mcp /home/runner/work/secret ghp_abcdefghijklmnop12" }, {
      status: "failed", error: "Connection closed",
    });
    merge(dir);
    const tel = fs.readFileSync(path.join(dir, "fleet", "telemetry.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const t = tel.find((r) => r.id === "x-mcp");
    assert.equal(t.name, "x-mcp");
    assert.match(t.launch, /^npx -y github:acme\/x-mcp /);
    assert.ok(!/ghp_|\/home\/runner/.test(t.launch));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

test("merge.mjs: writes fleet/not-graded.json with new servers that failed, typed, without their error text", () => {
  const dir = scratch([graded()]);
  try {
    report(dir, "a", { id: "postgres-mcp", version: "0.3.0", ecosystem: "pypi" }, { status: "failed", error: "Connection closed" });
    report(dir, "b", { id: "brand-new", version: "1.0.0", ecosystem: "npm", isNew: true }, {
      status: "failed", error: "Connection closed (server stderr: secret-text-here)", startFailure: { kind: "needs-credentials", advice: "x" },
    });
    const days = merge(dir);
    const out = JSON.parse(fs.readFileSync(path.join(dir, "fleet", "not-graded.json"), "utf8"));
    assert.equal(out.count, 1);
    assert.deepEqual({ ...out.servers[0], lastTried: null }, { id: "brand-new", version: "1.0.0", lastTried: null, attempts: 1, reason: "needs-credentials" });
    assert.ok(days.includes(out.servers[0].lastTried));
    assert.ok(!JSON.stringify(out).includes("secret-text-here"));
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

test("merge.mjs: a failed try records the registry arguments it was started with, so the same try is not repeated", () => {
  const dir = scratch([]);
  try {
    const startFail = { status: "failed", error: "Connection closed" };
    report(dir, "a", { id: "tares", version: "0.4.0", ecosystem: "pypi", isNew: true, launch: "uvx tares==0.4.0 mcp", args: ["mcp"] }, startFail);
    report(dir, "b", { id: "bare", version: "1.0.0", ecosystem: "npm", isNew: true, launch: "npx -y bare@1.0.0" }, startFail);
    report(dir, "c", { id: "odd", version: "1.0.0", ecosystem: "npm", isNew: true, args: ["ok", 7] }, startFail);
    merge(dir);
    const hist = fs.readFileSync(path.join(dir, "fleet", "history.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(hist.find((h) => h.id === "tares").args, ["mcp"]);
    assert.equal("args" in hist.find((h) => h.id === "bare"), false);
    assert.equal("args" in hist.find((h) => h.id === "odd"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a grade is unconfirmed when a later re-test failed, and only then", () => {
  const x = { ...graded(), lastAttempt: { date: "2026-11-12", status: "failed", kind: "start-fail" } };
  assert.equal(gradeUnconfirmed(x), true);
  assert.equal(gradeUnconfirmed({ ...x, lastAttempt: { ...x.lastAttempt, date: "2026-10-15" } }), true, "same day as the grade counts, as failedSince does");
  assert.equal(gradeUnconfirmed({ ...x, lastAttempt: { ...x.lastAttempt, date: "2026-10-01" } }), false, "an attempt before the grade is history");
  assert.equal(gradeUnconfirmed(graded()), false);
  assert.equal(gradeUnconfirmed({ ...x, lastAttempt: { date: "2026-11-12", status: "ok", kind: "start-fail" } }), false);
  assert.equal(gradeUnconfirmed({ ...x, testedAt: undefined }), false);
});

test("the unconfirmed words say the grade is not confirmed, from when, and do not say it is wrong", () => {
  const x = { ...graded(), lastAttempt: { date: "2026-11-12", status: "failed", kind: "timeout" } };
  assert.equal(unconfirmedWords(x).heading, "Grade not confirmed since the re-test on 2026-11-12");
  assert.match(unconfirmedWords(x).text, /still shows what the test on 2026-10-15 found/);
  assert.match(unconfirmedWords(x).text, /not confirmed for the version the fleet tries now/);
  assert.equal(unconfirmedWords(graded()), null);
});

// ---- a stale grade whose re-tests keep failing is not shown (web/lib/retest.mjs withdrawnGrade) ----
import { firstFailureAfter, withdrawnGrade, WITHDRAW_AFTER_DAYS } from "../web/lib/retest.mjs";

const stale = (o = {}) => ({ testedAt: "2026-11-09", versionTested: "0.1.2", lastAttempt: { date: "2026-11-19", status: "failed", kind: "start-fail" }, ...o });
const HIST = [
  { id: "a", version: "0.1.5", testedAt: "2026-11-09", status: "ok", worst: "A", packs: { core: "A" } },
  { id: "a", version: "0.1.5", testedAt: "2026-11-10", status: "failed", error: "x" },
  { id: "a", version: "0.1.5", testedAt: "2026-11-19", status: "failed", error: "x" },
  { id: "b", version: "9", testedAt: "2026-11-11", status: "failed", error: "x" },
].map((r) => JSON.stringify(r)).join("\n");

test("withdrawnGrade: a grade older than 7 days with a failed re-test since is withdrawn, with the words", () => {
  const w = withdrawnGrade(stale(), "2026-11-19", firstFailureAfter(HIST, "a", "2026-11-09"));
  assert.equal(w.kind, "start-fail");
  assert.equal(w.since, "2026-11-10");
  assert.match(w.text, /version 0\.1\.2, tested on 2026-11-09/);
  assert.match(w.text, /current version, 0\.1\.5, has failed to start since 2026-11-10/);
});

test("withdrawnGrade: boundary, 5 days old stays shown, 6 days is withdrawn (the invariant is under 7)", () => {
  assert.equal(WITHDRAW_AFTER_DAYS, 6);
  assert.equal(withdrawnGrade(stale(), "2026-11-14", null), null);
  assert.notEqual(withdrawnGrade(stale(), "2026-11-15", null), null);
});

test("firstFailureAfter: the version comes from the newest failed run, not the last line in file order", () => {
  const h = [
    { id: "a", version: "2.0", testedAt: "2026-11-19", status: "failed" },
    { id: "a", version: "1.0", testedAt: "2026-11-10", status: "failed" },
  ].map((r) => JSON.stringify(r)).join("\n");
  assert.deepEqual(firstFailureAfter(h, "a", "2026-11-09"), { first: "2026-11-10", version: "2.0" });
});

test("withdrawnGrade: no failed re-test since the grade, or a failure from before it, keeps the grade", () => {
  assert.equal(withdrawnGrade(stale({ lastAttempt: null }), "2026-11-30", null), null);
  assert.equal(withdrawnGrade(stale({ lastAttempt: { date: "2026-11-01", status: "failed", kind: "start-fail" } }), "2026-11-30", null), null);
});

test("withdrawnGrade: an entry replaced by a later successful run (newer testedAt, no lastAttempt) is not nulled", () => {
  assert.equal(withdrawnGrade({ testedAt: "2026-11-18", versionTested: "0.1.5", lastAttempt: null }, "2026-11-19", null), null);
});

test("withdrawnGrade: another failure kind says it failed every re-test, not that it failed to start", () => {
  const w = withdrawnGrade(stale({ lastAttempt: { date: "2026-11-19", status: "failed", kind: "timeout" } }), "2026-11-19", null);
  assert.equal(w.kind, "timeout");
  assert.match(w.text, /failed every re-test since 2026-11-19/);
  assert.doesNotMatch(w.text, /failed to start/);
});

test("firstFailureAfter: only failed lines of that server on or after the grade", () => {
  assert.deepEqual(firstFailureAfter(HIST, "a", "2026-11-09"), { first: "2026-11-10", version: "0.1.5" });
  assert.equal(firstFailureAfter(HIST, "a", "2026-11-20"), null);
  assert.equal(firstFailureAfter(HIST, "zzz", "2026-11-01"), null);
});
