// The only server fields the /results/ table may hand to a client component. Next.js writes every prop of a client
// component into the page, so the list is an allowlist: a field added to the data file never reaches the page until it
// is named here and lib/results-list.test.mjs allows it. Pure function, no I/O.

export const LIST_FIELDS = ["id", "name", "ecosystem", "versionTested", "toolCount", "coverage", "packs", "lastAttempt"];
const PACK_FIELDS = ["id", "status", "letter", "provisional"];
const COVERAGE_FIELDS = ["level", "toolsTotal"];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/** @param {any} x a server entry from server-results.json */
export function listRow(x) {
  const row = pick(x, LIST_FIELDS);
  row.packs = (x.packs ?? []).map((p) => pick(p, PACK_FIELDS));
  if (x.coverage) row.coverage = pick(x.coverage, COVERAGE_FIELDS);
  if (x.lastAttempt) row.lastAttempt = pick(x.lastAttempt, ["date", "status", "kind", "startKind"]);
  return row;
}
