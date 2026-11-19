// A re-test that fails leaves the server's last grade in place. This records that failed attempt on the entry
// (fleet/merge.mjs) and words it next to the grade it did not replace (results pages), so an old grade never reads
// as current. Pure functions, no I/O: covered by fleet/retest.test.mjs.

/** @typedef {{ date: string, status: "failed", kind: string, startKind?: string }} LastAttempt */

// failClass values from fleet/merge.mjs that get their own words; anything else (other, no-report) is stored as "other".
/** @type {Record<string, { note: string, short: string }>} */
const WORDS = {
  "start-fail": { note: "could not start the server", short: "server did not start" },
  timeout: { note: "timed out", short: "timed out" },
  "sealmark-crash": { note: "stopped on a Sealmark error", short: "stopped on a Sealmark error" },
};
const FAILED = { note: "failed", short: "failed" };

// The CLI's typed start failure (sealmark 1.0.1 `startFailure.kind`). The kind comes from heuristics on the error text,
// so the words say "looks like", never "is". `unknown` and anything else keep the plain words.
/** @type {Record<string, { note: string, short: string }>} */
const START_WORDS = {
  "needs-credentials": { note: "could not start the server (it looks like it needs a credential)", short: "server did not start (looks like it needs a credential)" },
  "missing-runtime": { note: "could not start the server (a runtime it needs is missing)", short: "server did not start (a runtime it needs is missing)" },
  "dependency-resolution": { note: "could not start the server (a dependency could not be installed)", short: "server did not start (a dependency could not be installed)" },
  "bad-launch": { note: "could not start the server (the launch command did not work)", short: "server did not start (the launch command did not work)" },
  "initialize-timeout": { note: "could not start the server (it did not answer in time)", short: "server did not start (it did not answer in time)" },
};
const has = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);

/**
 * Marks the graded entry for `id` with a failed attempt and keeps its grade. A server with no entry gets none.
 * A successful re-test replaces the whole entry, which clears the mark.
 * @param {Array<{ id: string, lastAttempt?: LastAttempt | null }>} servers
 * @param {string} id
 * @param {string} date YYYY-MM-DD
 * @param {string | undefined} kind failClass from fleet/merge.mjs
 * @param {string | undefined} [startKind] the CLI's typed start failure kind; kept only for a start-fail
 * @returns {boolean} whether an entry was marked
 */
export function recordFailedAttempt(servers, id, date, kind, startKind) {
  const entry = servers.find((s) => s.id === id);
  if (!entry) return false;
  const k = kind && Object.prototype.hasOwnProperty.call(WORDS, kind) ? kind : "other";
  entry.lastAttempt = { date, status: "failed", kind: k, ...(k === "start-fail" && has(START_WORDS, startKind) ? { startKind } : {}) };
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
const what = (a) => (a.kind === "start-fail" && has(START_WORDS, a.startKind) ? START_WORDS[a.startKind] : Object.prototype.hasOwnProperty.call(WORDS, a.kind) ? WORDS[a.kind] : FAILED);

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
  return a ? `grade not confirmed, re-test ${a.date}: ${what(a).short}` : null;
}

/**
 * Whether the published grade has a failed re-test after it (the grade is kept, but it is no longer confirmed).
 * @param {{ testedAt?: string, lastAttempt?: LastAttempt | null }} server
 */
export function gradeUnconfirmed(server) {
  return failedSince(server) !== null;
}

/**
 * The words the server page puts beside a grade whose latest re-test failed, or null. They say what is known (the grade
 * is from an earlier run, the later run failed) and never that the grade is wrong.
 * @param {{ testedAt?: string, lastAttempt?: LastAttempt | null }} server
 * @returns {{ heading: string, text: string } | null}
 */
export function unconfirmedWords(server) {
  const a = failedSince(server);
  if (!a) return null;
  return {
    heading: `Grade not confirmed since the re-test on ${a.date}`,
    text: `The re-test on ${a.date} ${what(a).note}. This grade still shows what the test on ${server.testedAt} found; it is not confirmed for the version the fleet tries now.`,
  };
}

/** A grade this many days old or older, whose re-tests keep failing, is no longer shown (withdrawnGrade). The health invariant is "oldest grade < 7 days"; builds only run with the fleet deploy (~6 h), so the cut is a day early. */
export const WITHDRAW_AFTER_DAYS = 6;

const DAY_MS = 86400000;
const dayNumber = (d) => Date.parse(`${d}T00:00:00Z`) / DAY_MS;

/**
 * The first failed run after the grade, and the version of the newest failed run, from fleet/history.jsonl text.
 * Only failed lines on or after `testedAt`; a successful line after the grade means the grade would be newer anyway.
 * @param {string} historyText fleet/history.jsonl
 * @param {string} id
 * @param {string} testedAt YYYY-MM-DD of the grade
 * @returns {{ first: string, version: string } | null}
 */
export function firstFailureAfter(historyText, id, testedAt) {
  let first = null;
  let version = "";
  let newest = null;
  for (const line of historyText.split("\n")) {
    if (!line.includes(`"${id}"`)) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.id !== id || r.status !== "failed" || typeof r.testedAt !== "string" || r.testedAt < testedAt) continue;
    if (first === null || r.testedAt < first) first = r.testedAt;
    if (newest === null || r.testedAt >= newest) { newest = r.testedAt; version = r.version ?? ""; }
  }
  return first === null ? null : { first, version };
}

/**
 * The rule that keeps a stale grade off the site: when the latest re-test failed (failedSince) and the grade is more
 * WITHDRAW_AFTER_DAYS or more old on `today`, there is no current grade. Returns the reason the pages and the API print
 * in its place, or null (the grade stays). A later successful run replaces the entry, so it never reaches here.
 * The old grade stays in the history and in `lastGrade`.
 * @param {{ testedAt?: string, versionTested?: string, lastAttempt?: LastAttempt | null }} server
 * @param {string} today YYYY-MM-DD, the build date
 * @param {{ first: string, version: string } | null} failure firstFailureAfter(...)
 * @returns {{ kind: string, text: string, since: string } | null}
 */
export function withdrawnGrade(server, today, failure) {
  const a = failedSince(server);
  if (!a || !server.testedAt) return null;
  if (dayNumber(today) - dayNumber(server.testedAt) < WITHDRAW_AFTER_DAYS) return null;
  const since = failure?.first ?? a.date;
  const current = failure?.version ? `The current version, ${failure.version}, ` : "The current version ";
  const kind = Object.prototype.hasOwnProperty.call(WORDS, a.kind) ? a.kind : "failed";
  const what_ = a.kind === "start-fail" ? `has failed to start since ${since}` : `has failed every re-test since ${since} (${what(a).note})`;
  return {
    kind,
    since,
    text: `There is no current grade. The last grade was from version ${server.versionTested}, tested on ${server.testedAt}. ${current}${what_}, so Sealmark cannot grade it now. The earlier grade stays in this server's history.`,
  };
}
