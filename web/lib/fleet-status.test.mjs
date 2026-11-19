// node --test lib/   (npm test in web/)
// Fleet status page (site#59 slice 2): counts from the committed data only, dated by the data, never by the build clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STATUS_DAYS, fleetStatus } from "./fleet-status.mjs";

const srv = (id, testedAt, letter = "A") => ({ id, testedAt, packs: [{ id: "core", status: letter ? "graded" : "not-graded", letter }] });
const hist = (id, runs) => ({ id, runs: runs.map(([date, status]) => ({ date, status })) });
const NG = { count: 3, byReason: { "needs-credentials": 2, "missing-runtime": 1 } };
// The results pages' rule (lib/api-data.ts gradeOf): a lettered area, and not a server with no tools.
const hasGrade = (x) => x.toolCount !== 0 && (x.packs ?? []).some((p) => p.status === "graded");

test("counts servers, graded servers and the share graded within 10 days of the latest re-test", () => {
  const st = fleetStatus(hasGrade, [srv("a", "2026-11-18"), srv("b", "2026-11-09"), srv("c", "2026-11-08"), srv("d", "2026-11-17", null)], [], NG);
  assert.equal(st.listed, 4);
  assert.equal(st.graded, 3);
  assert.equal(st.latest, "2026-11-18");
  assert.equal(st.oldest, "2026-11-08");
  // 2026-11-09 is 9 days before the latest test, 2026-11-08 is 10: "within 10 days" means fewer than 11 whole days, as staleNote.
  assert.equal(st.fresh, 4);
  assert.equal(st.freshPct, 100);
  const later = fleetStatus(hasGrade, [srv("a", "2026-11-20"), srv("b", "2026-11-09")], [], NG);
  assert.equal(later.fresh, 1);
  assert.equal(later.freshPct, 50);
});

test("the latest date is the newest of the results and the history, never the build date", () => {
  const st = fleetStatus(hasGrade, [srv("a", "2026-11-10")], [hist("a", [["2026-11-12", "failed"]])], NG);
  assert.equal(st.latest, "2026-11-12");
});

test("re-tests by day: the last STATUS_DAYS days ending at the latest date, graded and failed counted per day, empty days kept", () => {
  const st = fleetStatus(hasGrade, [srv("a", "2026-11-18")], [
    hist("a", [["2026-11-16", "ok"], ["2026-11-18", "ok"]]),
    hist("b", [["2026-11-16", "failed"], ["2026-11-18", "ok"]]),
    hist("c", [["2026-10-01", "ok"]]),
  ], NG);
  assert.equal(st.days.length, STATUS_DAYS);
  assert.deepEqual(st.days[0], { date: "2026-11-18", graded: 2, failed: 0 });
  assert.deepEqual(st.days[1], { date: "2026-11-17", graded: 0, failed: 0 });
  assert.deepEqual(st.days[2], { date: "2026-11-16", graded: 1, failed: 1 });
  assert.equal(st.days.at(-1).date, "2026-11-05");
  assert.equal(st.retests, 4);
});

test("not graded yet: the count and the typed reasons with their text, biggest first; unknown reasons are not shown", () => {
  const st = fleetStatus(hasGrade, [srv("a", "2026-11-18")], [], { count: 4, byReason: { "needs-credentials": 2, "missing-runtime": 1, "made-up": 1 } });
  assert.equal(st.notGraded, 4);
  assert.deepEqual(st.reasons.map((r) => [r.reason, r.count]), [["needs-credentials", 2], ["missing-runtime", 1]]);
  assert.ok(st.reasons[0].label);
});

test("malformed input gives empty counts, not a throw or a made-up date", () => {
  const st = fleetStatus(hasGrade, undefined, undefined, undefined);
  assert.deepEqual([st.listed, st.graded, st.fresh, st.freshPct, st.latest, st.oldest, st.days.length, st.notGraded], [0, 0, 0, null, null, null, 0, 0]);
  const bad = fleetStatus(hasGrade, [{ id: "x", testedAt: "soon", packs: [] }, null], [{ id: "y", runs: [{ date: "nope", status: "ok" }] }], { count: "many" });
  assert.equal(bad.latest, null);
  assert.equal(bad.notGraded, 0);
});

test("real data: counts agree with the committed files", () => {
  const data = JSON.parse(readFileSync(new URL("../content/data/server-results.json", import.meta.url), "utf8"));
  const ng = JSON.parse(readFileSync(new URL("../../fleet/not-graded.json", import.meta.url), "utf8"));
  const st = fleetStatus(hasGrade, data.servers, [], ng);
  assert.equal(st.listed, data.servers.length);
  assert.equal(st.notGraded, ng.count);
  assert.ok(st.freshPct >= 0 && st.freshPct <= 100);
  assert.equal(st.reasons.reduce((n, r) => n + r.count, 0) <= ng.count, true);
});

test("graded follows the page's grade rule: a server with no tools to test has no grade even with a lettered area", () => {
  const st = fleetStatus(hasGrade, [srv("a", "2026-11-18"), { ...srv("notools", "2026-11-18", "B"), toolCount: 0 }], [], NG);
  assert.equal(st.graded, 1);
  assert.equal(st.listed, 2);
});

test("the fresh share rounds down, so it never reads 100% while a grade is out of date", () => {
  const list = Array.from({ length: 262 }, (_, i) => srv(`s${i}`, i === 0 ? "2026-11-01" : "2026-11-18"));
  assert.equal(fleetStatus(hasGrade, list, [], NG).freshPct, 99);
});

test("any run that is not ok counts as did not finish", () => {
  const st = fleetStatus(hasGrade, [srv("a", "2026-11-18")], [hist("a", [["2026-11-18", "timeout"]])], NG);
  assert.deepEqual(st.days[0], { date: "2026-11-18", graded: 0, failed: 1 });
});

test("real data with history: one count per server per day, the latest day matches the files", () => {
  const data = JSON.parse(readFileSync(new URL("../content/data/server-results.json", import.meta.url), "utf8"));
  const byId = new Map();
  for (const line of readFileSync(new URL("../../fleet/history.jsonl", import.meta.url), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    const days = byId.get(r.id) ?? new Map();
    days.set(r.testedAt, { date: r.testedAt, status: r.status === "ok" ? "ok" : "failed" });
    byId.set(r.id, days);
  }
  const hs = [...byId].map(([id, days]) => ({ id, runs: [...days.values()] }));
  const st = fleetStatus(hasGrade, data.servers, hs, { count: 0 });
  const newest = [...data.servers.map((x) => x.testedAt), ...hs.flatMap((h) => h.runs.map((r) => r.date))].sort().at(-1);
  assert.equal(st.latest, newest);
  const d0 = hs.filter((h) => h.runs.some((r) => r.date === newest)).length;
  assert.equal(st.days[0].graded + st.days[0].failed, d0);
  assert.equal(st.retests, st.days.reduce((n, d) => n + d.graded + d.failed, 0));
});
