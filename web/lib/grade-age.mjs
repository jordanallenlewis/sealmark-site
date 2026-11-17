// How old a grade is, in whole days, and whether the page should say it is waiting for a re-test. The fleet re-tests every
// grade within a few days; one older than STALE_AFTER_DAYS has missed its re-test (a failed run, a queue), and a page that
// only prints a date lets the reader take it for current. Pure: callers pass today (UTC, YYYY-MM-DD).
export const STALE_AFTER_DAYS = 10;

/** @returns {number | null} whole days from testedAt to today, or null when either is not a date */
export function gradeAgeDays(testedAt, today) {
  const a = Date.parse(String(testedAt ?? "").slice(0, 10));
  const b = Date.parse(String(today ?? "").slice(0, 10));
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 864e5)) : null;
}

/** Words for the page, or null when the grade is current (or the age is unknown: say nothing rather than guess). */
export function staleNote(testedAt, today) {
  const days = gradeAgeDays(testedAt, today);
  return days != null && days > STALE_AFTER_DAYS ? `${days} days old: waiting for its next automated re-test` : null;
}
