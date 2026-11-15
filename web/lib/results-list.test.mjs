// node --test lib/   (npm test in web/)
// Next.js writes every prop of a client component into the page. The /results/ table is a client component, so what
// listRow() returns is public: these tests fail if a redacted or withheld field can reach it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LIST_FIELDS, listRow } from "./results-list.mjs";
import { redactedChecks } from "./disclosure.mjs";

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const results = json("../content/data/server-results.json");
const disclosure = json("../content/data/disclosure.json");

// A server whose every field carries a marker, so any leak is a string match.
const MARK = (k) => `LEAK-${k}-9f3a`;
const probe = {
  id: "p", name: "p", ecosystem: "npm", versionTested: "1.0.0", testedAt: "2026-11-01T00:00:00Z", toolCount: 3,
  sealmark: { version: MARK("sealmark"), methodology: MARK("methodology") }, standard: true, configHash: MARK("configHash"),
  launch: MARK("launch"), transport: MARK("transport"),
  packs: [{ id: "net", status: "graded", letter: "D", points: 1, scored: 2, pct: 3, provisional: true, capped: true, criticalFails: [MARK("criticalFails")], reason: MARK("reason") }],
  checks: [{ id: "net-x", pack: "net", label: MARK("label"), critical: true, advisory: false, verdict: "fail", summary: MARK("summary") }],
  coverage: { level: "low", validCalls: 1, toolsCalledValid: 1, toolsTotal: 3, extra: MARK("coverage") },
  badge: { eligible: false, reason: MARK("badge") }, notCovered: [MARK("notCovered")], warnings: [MARK("warnings")],
  lastAttempt: { date: "2026-11-02", status: "failed", kind: "start-fail", startKind: "bad-launch", detail: MARK("attempt") },
};

test("no marker from any non-allowlisted field reaches the row", () => {
  assert.doesNotMatch(JSON.stringify(listRow(probe)), /LEAK-/);
});

test("a row has only the allowlisted keys, even for a field the data file gains later", () => {
  const row = listRow({ ...probe, privateNote: "x", findings: ["y"] });
  assert.deepEqual(Object.keys(row).filter((k) => !LIST_FIELDS.includes(k)), []);
  assert.deepEqual(Object.keys(row.packs[0]).sort(), ["id", "letter", "provisional", "status"]);
});

test("real data: no row carries a check, a launch line, a summary, a critical-fail list or a redacted text", () => {
  const today = new Date().toISOString().slice(0, 10);
  for (const x of results.servers) {
    const body = JSON.stringify(listRow(x));
    for (const k of ["checks", "launch", "summary", "criticalFails", "configHash", "reason", "warnings", "notCovered"]) assert.ok(!body.includes(`"${k}"`), `${x.id}: key ${k} in the row`);
    if (x.launch) assert.ok(!body.includes(JSON.stringify(x.launch).slice(1, -1)), `${x.id}: launch line in the row`);
    const red = redactedChecks(x, disclosure.findings, today);
    for (const c of x.checks) if (c.summary && (red.has(c.id) || c.critical)) assert.ok(!body.includes(JSON.stringify(c.summary).slice(1, -1)), `${x.id}/${c.id}: summary in the row`);
  }
});

test("the table still gets what it draws: grades, packs, coverage and the failed-retest mark", () => {
  const x = results.servers.find((s) => s.packs.some((p) => p.status === "graded"));
  const row = listRow(x);
  assert.deepEqual(row.packs.map((p) => [p.id, p.letter, p.provisional]), x.packs.map((p) => [p.id, p.letter, p.provisional]));
  assert.equal(row.name, x.name);
  assert.equal(row.versionTested, x.versionTested);
});
