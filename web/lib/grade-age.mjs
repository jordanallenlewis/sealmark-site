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

/** Past the limit: the grade has missed its re-test. False when the age is unknown. */
export function isStale(testedAt, today) {
  const days = gradeAgeDays(testedAt, today);
  return days != null && days > STALE_AFTER_DAYS;
}

/** The age in words for any grade ("today", "3 days ago"), the stale words past the limit, null when unknown. */
export function ageNote(testedAt, today) {
  const days = gradeAgeDays(testedAt, today);
  if (days == null) return null;
  if (days > STALE_AFTER_DAYS) return staleNote(testedAt, today);
  return days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}

/** The age for a table row: "today", "3 days ago", "12 days old, re-test due"; null when unknown. */
export function ageShort(testedAt, today) {
  const days = gradeAgeDays(testedAt, today);
  if (days == null) return null;
  return days > STALE_AFTER_DAYS ? `${days} days old, re-test due` : ageNote(testedAt, today);
}

/**
 * The words a static page can carry without a clock (the server render and readers without JavaScript): only the stale
 * mark, without a day count, because a grade past the limit on the build day stays past it until the next build.
 * @param {"page" | "row"} form
 */
export function staleSince(testedAt, builtOn, form) {
  if (!isStale(testedAt, builtOn)) return null;
  return form === "row" ? "re-test due" : `more than ${STALE_AFTER_DAYS} days old: waiting for its next automated re-test`;
}
