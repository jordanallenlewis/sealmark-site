// The only server fields the /results/ table may hand to a client component. Next.js writes every prop of a client
// component into the page, so the list is an allowlist: a field added to the data file never reaches the page until it
// is named here and lib/results-list.test.mjs allows it. Pure function, no I/O.
import { gradeChange, worstLetter } from "./results-view.mjs";

export const LIST_FIELDS = ["id", "name", "ecosystem", "versionTested", "toolCount", "coverage", "packs", "lastAttempt", "gradeWithdrawn"];
/** Fields computed here, never copied from the data file: the test day and the last grade change (public on /results/history/). */
export const DERIVED_FIELDS = ["testedOn", "change"];
const PACK_FIELDS = ["id", "status", "letter", "provisional"];
const COVERAGE_FIELDS = ["level", "toolsTotal"];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/**
 * @param {any} x a server entry from server-results.json
 * @param {Array<{ date: string, status: string, worst?: string, version?: string, sealmark?: string }>} [runs] its grade history (lib/history.ts), for the change line
 */
export function listRow(x, runs) {
  const row = pick(x, LIST_FIELDS);
  row.packs = (x.packs ?? []).map((p) => pick(p, PACK_FIELDS));
  if (x.coverage) row.coverage = pick(x.coverage, COVERAGE_FIELDS);
  if (x.lastAttempt) row.lastAttempt = pick(x.lastAttempt, ["date", "status", "kind", "startKind"]);
  // No current grade (lib/retest.mjs withdrawnGrade): the old area letters go with it, the page and the history keep them.
  if (x.gradeWithdrawn) { row.gradeWithdrawn = pick(x.gradeWithdrawn, ["kind", "since"]); row.packs = []; }
  const day = typeof x.testedAt === "string" ? x.testedAt.slice(0, 10) : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) row.testedOn = day;
  const change = gradeChange(runs, worstLetter(x));
  if (change) row.change = change;
  return row;
}
