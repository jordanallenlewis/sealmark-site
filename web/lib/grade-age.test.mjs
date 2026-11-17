import test from "node:test";
import assert from "node:assert/strict";
import { STALE_AFTER_DAYS, gradeAgeDays, staleNote } from "./grade-age.mjs";

test("grade age: whole days, stale only past the limit, silent when the date is unknown", () => {
  assert.equal(STALE_AFTER_DAYS, 10);
  assert.equal(gradeAgeDays("2026-11-07", "2026-11-17"), 10);
  assert.equal(staleNote("2026-11-07", "2026-11-17"), null, "exactly 10 days is still current");
  assert.equal(staleNote("2026-11-06", "2026-11-17"), "11 days old: waiting for its next automated re-test");
  assert.equal(staleNote("2026-11-17T09:00:00Z", "2026-11-17"), null);
  assert.equal(gradeAgeDays("2026-11-20", "2026-11-17"), 0, "a date from the future is not negative");
  for (const bad of [undefined, "", "soon"]) assert.equal(staleNote(bad, "2026-11-17"), null);
});
