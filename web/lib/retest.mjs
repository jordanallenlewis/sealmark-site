// A re-test that fails leaves the server's last grade in place. This records that failed attempt on the entry
// (fleet/merge.mjs) and words it next to the grade it did not replace (results pages), so an old grade never reads
// as current. Pure functions, no I/O: covered by fleet/retest.test.mjs.

/** @typedef {{ date: string, status: "failed", kind: string }} LastAttempt */

// failClass values from fleet/merge.mjs that get their own words; anything else (other, no-report) is stored as "other".
/** @type {Record<string, { note: string, short: string }>} */
const WORDS = {
  "start-fail": { note: "could not start the server", short: "server did not start" },
  timeout: { note: "timed out", short: "timed out" },
  "sealmark-crash": { note: "stopped on a Sealmark error", short: "stopped on a Sealmark error" },
};
const FAILED = { note: "failed", short: "failed" };

/**
 * Marks the graded entry for `id` with a failed attempt and keeps its grade. A server with no entry gets none.
 * A successful re-test replaces the whole entry, which clears the mark.
 * @param {Array<{ id: string, lastAttempt?: LastAttempt | null }>} servers
 * @param {string} id
 * @param {string} date YYYY-MM-DD
 * @param {string | undefined} kind failClass from fleet/merge.mjs
 * @returns {boolean} whether an entry was marked
 */
export function recordFailedAttempt(servers, id, date, kind) {
  const entry = servers.find((s) => s.id === id);
  if (!entry) return false;
  entry.lastAttempt = { date, status: "failed", kind: kind && Object.prototype.hasOwnProperty.call(WORDS, kind) ? kind : "other" };
  return true;
}

/**
 * The failed attempt that is newer than (or as new as) the grade, or null.
 * @param {{ testedAt?: string, lastAttempt?: LastAttempt | null }} server
 */
export function failedSince(server) {
  const a = server.lastAttempt;
  if (!a || a.status !== "failed" || typeof a.date !== "string" || !a.date || !server.testedAt) return null;
  if (a.date < server.testedAt) return null;
  return a;
}

/** @param {LastAttempt} a */
const what = (a) => (Object.prototype.hasOwnProperty.call(WORDS, a.kind) ? WORDS[a.kind] : FAILED);

/**
 * One sentence for the server page, or null.
 * @param {{ testedAt?: string, lastAttempt?: LastAttempt | null }} server
 * @returns {string | null}
 */
export function retestNote(server) {
  const a = failedSince(server);
  if (!a) return null;
  return `The latest re-test, on ${a.date}, ${what(a).note}, so this grade is still the one from ${server.testedAt}.`;
}

/**
 * A few words for the results table, or null.
 * @param {{ testedAt?: string, lastAttempt?: LastAttempt | null }} server
 * @returns {string | null}
 */
export function retestShort(server) {
  const a = failedSince(server);
  return a ? `re-test ${a.date}: ${what(a).short}` : null;
}
