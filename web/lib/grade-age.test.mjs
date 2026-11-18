import test from "node:test";
import assert from "node:assert/strict";
import { STALE_AFTER_DAYS, ageNote, ageShort, gradeAgeDays, isStale, staleNote, staleSince } from "./grade-age.mjs";

test("grade age: whole days, stale only past the limit, silent when the date is unknown", () => {
  assert.equal(STALE_AFTER_DAYS, 10);
  assert.equal(gradeAgeDays("2026-11-07", "2026-11-17"), 10);
  assert.equal(staleNote("2026-11-07", "2026-11-17"), null, "exactly 10 days is still current");
  assert.equal(staleNote("2026-11-06", "2026-11-17"), "11 days old: waiting for its next automated re-test");
  assert.equal(staleNote("2026-11-17T09:00:00Z", "2026-11-17"), null);
  assert.equal(gradeAgeDays("2026-11-20", "2026-11-17"), 0, "a date from the future is not negative");
  for (const bad of [undefined, "", "soon"]) assert.equal(staleNote(bad, "2026-11-17"), null);
});

test("age note: today, days, then the waiting-for-re-test words past the limit; silent when unknown", () => {
  assert.equal(ageNote("2026-11-18", "2026-11-18"), "today");
  assert.equal(ageNote("2026-11-17", "2026-11-18"), "1 day ago");
  assert.equal(ageNote("2026-11-08", "2026-11-18"), "10 days ago");
  assert.equal(ageNote("2026-11-07", "2026-11-18"), "11 days old: waiting for its next automated re-test");
  assert.equal(ageNote("2026-11-20", "2026-11-18"), "today", "a clock behind the data never reads negative");
  assert.equal(ageNote(undefined, "2026-11-18"), null);
  assert.equal(ageNote("2026-11-18", "not a day"), null);
});

test("stale: past the limit only, false when unknown", () => {
  assert.equal(isStale("2026-11-08", "2026-11-18"), false);
  assert.equal(isStale("2026-11-07", "2026-11-18"), true);
  assert.equal(isStale(undefined, "2026-11-18"), false);
});

test("age short: for table rows, the re-test-due words past the limit", () => {
  assert.equal(ageShort("2026-11-16", "2026-11-18"), "2 days ago");
  assert.equal(ageShort("2026-11-18", "2026-11-18"), "today");
  assert.equal(ageShort("2026-11-06", "2026-11-18"), "12 days old, re-test due");
  assert.equal(ageShort("", "2026-11-18"), null);
});

test("stale since: only the stale mark, no day count, for a page built without the reader's clock", () => {
  assert.equal(staleSince("2026-11-08", "2026-11-18", "page"), null, "current on the build day: say nothing");
  assert.equal(staleSince("2026-11-07", "2026-11-18", "page"), "more than 10 days old: waiting for its next automated re-test");
  assert.equal(staleSince("2026-11-07", "2026-11-18", "row"), "re-test due");
  assert.equal(staleSince(undefined, "2026-11-18", "row"), null);
});
