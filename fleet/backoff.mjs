// A tracked server whose re-test keeps failing at the same version is tried again once every few days, not on every run:
// each try costs a runner job and adds nothing (callmcp-server failed 38 times at 0.1.5 between 11-10 and 11-17).
// A new version, a changed launch line or a forced run still tries at once. Pure; fleet/backoff.test.mjs.
export const BACKOFF_FAILS = 2; // failures at this version in the window before the server waits
export const BACKOFF_DAYS = 3;

/** history: parsed lines of fleet/history.jsonl. True when `id` at `version` failed BACKOFF_FAILS times within BACKOFF_DAYS and has no later ok line. */
export function backedOff(history, id, version, today, { fails = BACKOFF_FAILS, days = BACKOFF_DAYS } = {}) {
  const mine = history.filter((h) => h.id === id && h.version === version);
  const lastOk = mine.filter((h) => h.status === "ok").map((h) => h.testedAt).sort().at(-1) ?? "";
  const recent = mine.filter((h) => h.status === "failed" && h.testedAt > lastOk && (Date.parse(today) - Date.parse(h.testedAt)) / 864e5 <= days);
  return recent.length >= fails;
}
