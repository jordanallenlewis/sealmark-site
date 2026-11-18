import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CADENCE_DAYS, fleetCadence, scheduledHours } from "./fleet-cadence.mjs";

const line = (at, extra = { event: "schedule" }) => JSON.stringify({ at, ...extra });
const hand = (at) => line(at, { event: "workflow_dispatch" });

test("cadence: runs in the window ending at the last run, median and longest gap in whole hours", () => {
  const text = [
    line("2026-11-01T00:00:00Z"), // outside the 14-day window ending 2026-11-18T12:00Z
    line("2026-11-17T00:00:00Z"),
    line("2026-11-17T06:00:00Z"),
    line("2026-11-17T20:00:00Z"),
    line("2026-11-18T12:00:00Z"),
  ].join("\n");
  const c = fleetCadence(text);
  assert.equal(CADENCE_DAYS, 14);
  assert.equal(c.runs, 4);
  assert.equal(c.lastAt, "2026-11-18T12:00:00Z");
  assert.equal(c.from, "2026-11-04");
  assert.equal(c.to, "2026-11-18");
  assert.deepEqual(c.gapsH, [6, 14, 16]);
  assert.equal(c.medianGapH, 14);
  assert.equal(c.longestGapH, 16);
});

test("cadence: order-free, duplicates and bad lines dropped, an even count takes the mean of the middle two", () => {
  const text = ["{oops", "", line("2026-11-18T10:00:00Z"), line("2026-11-18T00:00:00Z"), line("2026-11-18T00:00:00Z"), line("soon"), JSON.stringify({ at: 5 }), line("2026-11-18T03:00:00Z"), line("2026-11-18T12:00:00Z")].join("\n");
  const c = fleetCadence(text);
  assert.equal(c.runs, 4);
  assert.deepEqual(c.gapsH, [3, 7, 2]);
  assert.equal(c.medianGapH, 3, "sorted gaps 2,3,7: median 3");
  const even = fleetCadence([line("2026-11-18T00:00:00Z"), line("2026-11-18T02:00:00Z"), line("2026-11-18T06:00:00Z"), line("2026-11-18T12:00:00Z"), line("2026-11-18T21:00:00Z")].join("\n"));
  assert.deepEqual(even.gapsH, [2, 4, 6, 9]);
  assert.equal(even.medianGapH, 5);
});

test("cadence: gaps between scheduled runs only; runs by hand and unknown triggers are counted, not gapped", () => {
  const c = fleetCadence([line("2026-11-18T00:00:00Z"), hand("2026-11-18T01:00:00Z"), hand("2026-11-18T01:10:00Z"), line("2026-11-18T03:00:00Z", {}), line("2026-11-18T09:00:00Z")].join("\n"));
  assert.equal(c.runs, 5);
  assert.equal(c.scheduled, 2);
  assert.equal(c.byHand, 3);
  assert.deepEqual(c.gapsH, [9]);
  assert.equal(c.lastAt, "2026-11-18T09:00:00Z");
  const handOnly = fleetCadence([hand("2026-11-18T01:00:00Z"), hand("2026-11-18T05:00:00Z")].join("\n"));
  assert.equal(handOnly.scheduled, 0);
  assert.equal(handOnly.medianGapH, null);
});

test("cadence: silent when there is too little to say", () => {
  assert.equal(fleetCadence(""), null);
  assert.equal(fleetCadence(undefined), null);
  const one = fleetCadence(line("2026-11-18T12:00:00Z"));
  assert.equal(one.runs, 1);
  assert.equal(one.medianGapH, null, "one run has no gap");
  assert.equal(one.longestGapH, null);
});

test("scheduled hours: only a plain every-N-hours cron line, else null", () => {
  assert.equal(scheduledHours("on:\n  schedule:\n    - cron: '0 */6 * * *'\n"), 6);
  assert.equal(scheduledHours('    - cron: "15 */12 * * *"'), 12);
  assert.equal(scheduledHours("    - cron: '0 3 * * 1'"), null);
  assert.equal(scheduledHours("    - cron: '0 */6 * * *'\n    - cron: '0 */8 * * *'"), null, "two schedules: say nothing");
  assert.equal(scheduledHours(""), null);
  assert.equal(scheduledHours(undefined), null);
});

test("real data: the committed run log and fleet.yml parse", () => {
  const c = fleetCadence(readFileSync(new URL("../../fleet/runs.jsonl", import.meta.url), "utf8"));
  assert.ok(c && c.runs >= 1, "fleet/runs.jsonl has runs in its last 14 days");
  assert.ok(c.scheduled >= 1 && c.medianGapH != null, "and scheduled runs with a gap");
  assert.equal(scheduledHours(readFileSync(new URL("../../.github/workflows/fleet.yml", import.meta.url), "utf8")), 6);
});
