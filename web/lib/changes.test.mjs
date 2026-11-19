// node --test lib/   (npm test in web/)
// "Since the last run" on a results page: what differs between the run the page shows and the graded run before it.
// The page states facts from fleet/history.jsonl (and tool counts from fleet/telemetry.jsonl); it never says why a grade moved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { changeSinceLast, toolCountsFrom } from "./changes.mjs";

const run = (date, version, packs, extra = {}) => ({ date, version, sealmark: "1.0.1", status: "ok", packs, ...extra });
const failed = (date) => ({ date, version: "", status: "failed", packs: {} });

test("no earlier graded run: nothing to compare", () => {
  assert.equal(changeSinceLast([run("2026-11-14", "1.0.0", { core: "A" })], "2026-11-14"), null);
  assert.equal(changeSinceLast([failed("2026-11-10"), run("2026-11-14", "1.0.0", { core: "A" })], "2026-11-14"), null);
  assert.equal(changeSinceLast([], "2026-11-14"), null);
});

test("the page's run must be a graded run in the history, or nothing is said", () => {
  const runs = [run("2026-11-09", "1.0.0", { core: "B" }), run("2026-11-12", "1.0.1", { core: "A" })];
  // The page shows a result the history does not hold (a hand round, or a same-day failed re-test replaced it).
  assert.equal(changeSinceLast(runs, "2026-11-14"), null);
  assert.equal(changeSinceLast([...runs, failed("2026-11-14")], "2026-11-14"), null);
});

test("compares with the latest graded run before the page's run, skipping failed starts and counting them", () => {
  const runs = [
    run("2026-11-01", "0.9.0", { core: "C" }),
    run("2026-11-05", "1.0.0", { core: "B" }),
    failed("2026-11-08"),
    failed("2026-11-10"),
    run("2026-11-14", "1.0.0", { core: "B" }),
    failed("2026-11-15"),
  ];
  const c = changeSinceLast(runs, "2026-11-14");
  assert.equal(c.from.date, "2026-11-05");
  assert.equal(c.to.date, "2026-11-14");
  assert.equal(c.failedBetween, 2);
  assert.deepEqual(c.items, []);
  assert.equal(c.gradeChanged, false);
});

test("grade flips up and down, areas graded for the first time and areas no longer graded", () => {
  const c = changeSinceLast(
    [run("2026-11-05", "1.0.0", { core: "B", db: "F", fs: "A" }), run("2026-11-14", "1.0.0", { core: "A", db: "D", net: "C" })],
    "2026-11-14",
  );
  assert.deepEqual(c.items, [
    { kind: "grade", pack: "core", from: "B", to: "A", dir: "up" },
    { kind: "grade", pack: "db", from: "F", to: "D", dir: "up" },
    { kind: "gone", pack: "fs", from: "A" },
    { kind: "new", pack: "net", to: "C" },
  ]);
  assert.equal(c.gradeChanged, true);
  const down = changeSinceLast([run("2026-11-05", "1.0.0", { core: "A" }), run("2026-11-14", "1.0.0", { core: "D" })], "2026-11-14");
  assert.deepEqual(down.items, [{ kind: "grade", pack: "core", from: "A", to: "D", dir: "down" }]);
});

test("server version and Sealmark version changes; an unknown Sealmark version on the older run is not a change", () => {
  const c = changeSinceLast(
    [run("2026-11-05", "1.0.0", { core: "A" }, { sealmark: "1.0.0" }), run("2026-11-14", "1.1.0", { core: "A" }, { sealmark: "1.0.1" })],
    "2026-11-14",
  );
  assert.deepEqual(c.items, [
    { kind: "version", from: "1.0.0", to: "1.1.0" },
    { kind: "sealmark", from: "1.0.0", to: "1.0.1" },
  ]);
  assert.equal(c.gradeChanged, false);
  // Grade moves come first, so a version line never reads as the reason for them.
  const both = changeSinceLast(
    [run("2026-11-05", "1.0.0", { core: "A" }, { sealmark: "1.0.0" }), run("2026-11-14", "1.0.0", { core: "B" }, { sealmark: "1.0.1" })],
    "2026-11-14", { "2026-11-05": 3, "2026-11-14": 4 },
  );
  assert.deepEqual(both.items.map((i) => i.kind), ["grade", "sealmark", "tools"]);
  const old = changeSinceLast(
    [run("2026-11-05", "1.0.0", { core: "A" }, { sealmark: undefined }), run("2026-11-14", "1.0.0", { core: "A" })],
    "2026-11-14",
  );
  assert.deepEqual(old.items, []);
  assert.equal(old.from.sealmark, undefined);
});

test("tool count change only when both runs recorded one; a drop is flagged so the page never calls it a server change", () => {
  const runs = [run("2026-11-05", "1.0.0", { core: "A" }), run("2026-11-14", "1.0.0", { core: "A" })];
  const up = changeSinceLast(runs, "2026-11-14", { "2026-11-05": 11, "2026-11-14": 12 });
  assert.deepEqual(up.items, [{ kind: "tools", from: 11, to: 12, dir: "up" }]);
  const drop = changeSinceLast(runs, "2026-11-14", { "2026-11-05": 12, "2026-11-14": 3 });
  assert.deepEqual(drop.items, [{ kind: "tools", from: 12, to: 3, dir: "down" }]);
  assert.deepEqual(changeSinceLast(runs, "2026-11-14", { "2026-11-14": 3 }).items, []);
  assert.deepEqual(changeSinceLast(runs, "2026-11-14", { "2026-11-05": 3, "2026-11-14": 3 }).items, []);
});

test("toolCountsFrom takes a count only from telemetry lines of the same run as the history line, and only when they agree", () => {
  const runs = [
    { date: "2026-11-05", version: "1.2.0", sealmark: "1.0.0", status: "ok", packs: { core: "A" } },
    { date: "2026-11-06", version: "1.3.0", sealmark: "1.0.1", status: "ok", packs: { core: "B" } },
    { date: "2026-11-07", version: "1.3.0", sealmark: "1.0.1", status: "ok", packs: { core: "B" } },
    { date: "2026-11-08", version: "1.3.0", sealmark: "1.0.1", status: "ok", packs: { core: "B" } },
  ];
  const lines = [
    // 11-05: the matching run, then a backfilled line of an older version written later that day: the older one is ignored.
    { id: "a", testedAt: "2026-11-05", serverVersion: "1.2.0", sealmark: "1.0.0", status: "ok", packs: { core: "A" }, toolCount: 5 },
    { id: "a", testedAt: "2026-11-05", serverVersion: "0.9.0", sealmark: "1.0.0", status: "ok", packs: { core: "A" }, toolCount: 2 },
    // 11-06: two lines of the same run that disagree: no count.
    { id: "a", testedAt: "2026-11-06", serverVersion: "1.3.0", sealmark: "1.0.1", status: "ok", packs: { core: "B" }, toolCount: 7 },
    { id: "a", testedAt: "2026-11-06", serverVersion: "1.3.0", sealmark: "1.0.1", status: "ok", packs: { core: "B" }, toolCount: 8 },
    // 11-07: same version, different grades: not the same run.
    { id: "a", testedAt: "2026-11-07", serverVersion: "1.3.0", sealmark: "1.0.1", status: "ok", packs: { core: "C" }, toolCount: 9 },
    // 11-08: a failed line and another server's line are ignored.
    { id: "a", testedAt: "2026-11-08", status: "failed" },
    { id: "a", testedAt: "2026-11-08", serverVersion: "1.3.0", sealmark: "1.0.1", status: "ok", packs: { core: "B" }, toolCount: 7 },
    { id: "b", testedAt: "2026-11-08", serverVersion: "1.3.0", sealmark: "1.0.1", status: "ok", packs: { core: "B" }, toolCount: 99 },
  ].map((o) => JSON.stringify(o)).join("\n");
  assert.deepEqual(toolCountsFrom(lines + "\n\n", "a", runs), { "2026-11-05": 5, "2026-11-08": 7 });
});

test("real data: every graded server whose page run is in the history yields a well-formed comparison", () => {
  const results = JSON.parse(readFileSync(new URL("../content/data/server-results.json", import.meta.url), "utf8")).servers;
  const history = readFileSync(new URL("../../fleet/history.jsonl", import.meta.url), "utf8");
  const byId = new Map();
  for (const line of history.split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    const days = byId.get(r.id) ?? new Map();
    days.set(r.testedAt, { date: r.testedAt, version: r.version ?? "", sealmark: r.sealmark, status: r.status === "ok" ? "ok" : "failed", packs: r.packs ?? {} });
    byId.set(r.id, days);
  }
  const telemetry = readFileSync(new URL("../../fleet/telemetry.jsonl", import.meta.url), "utf8");
  const tele = telemetry.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  let compared = 0;
  for (const x of results) {
    const runs = [...(byId.get(x.id)?.values() ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    const counts = toolCountsFrom(telemetry, x.id, runs);
    const c = changeSinceLast(runs, x.testedAt, counts);
    if (!c) continue;
    compared += 1;
    // The history run the block compares from is the run the page shows: same version and the same graded areas.
    const shown = runs.find((r) => r.date === x.testedAt);
    assert.equal(shown.version, x.versionTested ?? "", `${x.id} version`);
    const graded = Object.fromEntries(x.packs.filter((p) => p.status === "graded" && p.letter).map((p) => [p.id, p.letter]));
    assert.deepEqual(shown.packs, graded, `${x.id} packs`);
    // Every tool count used comes from a telemetry line of that very run (same version, Sealmark version and grades).
    for (const [date, n] of Object.entries(counts)) {
      const r = runs.find((v) => v.date === date);
      const same = tele.filter((t) => t.id === x.id && t.testedAt === date && t.status === "ok" && t.serverVersion === r.version && t.sealmark === r.sealmark && JSON.stringify(t.packs) === JSON.stringify(r.packs));
      assert.ok(same.length > 0 && same.every((t) => t.toolCount === n), `${x.id} ${date} tool count ${n}`);
    }
    assert.ok(c.from.date < c.to.date, x.id);
    for (const it of c.items) assert.ok(["version", "sealmark", "grade", "new", "gone", "tools"].includes(it.kind), `${x.id} ${it.kind}`);
  }
  assert.ok(compared > 50, `only ${compared} servers compared`);
});
