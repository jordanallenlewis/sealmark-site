// The /results/ table's view: search, filter, source and test-area facets, sorts, the URL state, and the
// "grade changed" line. Pure functions, no I/O, shared by the client table and the build (lib/results-list.mjs);
// covered by lib/results-view.test.mjs.

const RANK = { F: 0, D: 1, C: 2, B: 3, A: 4 };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const has = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);

/** @type {[string, string][]} filter key, button label */
export const FILTERS = [["all", "All"], ["failing", "Has a failing suite"], ["clean", "No failing suite"], ["hygiene", "Protocol only"]];
/** @type {[string, string][]} sort key, option label */
export const SORT_OPTIONS = [["best", "Best grade first"], ["worst", "Worst grade first"], ["tested", "Last graded"], ["changed", "Recent grade change"], ["name", "Name"]];
export const SORTS = SORT_OPTIONS.map(([k]) => k);
/** @type {[string, string][]} ecosystem key, label (the package registry the fleet installs from) */
export const SOURCES = [["npm", "npm"], ["pypi", "PyPI"], ["github", "GitHub"]];
/** Deeper test areas, in the order the site lists them (lib/results-shared.ts PACK_LABEL). Protocol runs on every server, so it is no facet. */
export const AREAS = ["effects", "net", "db", "sqlite", "fs", "git", "http", "exec", "custom"];

const graded = (x) => (x.packs ?? []).filter((p) => p.status === "graded" && has(RANK, p.letter));
const deep = (x) => graded(x).filter((p) => p.id !== "core");

/** The server grade (its lowest graded test-area letter), or null when nothing was graded. */
export function worstLetter(x) {
  const g = graded(x);
  return g.length ? g.reduce((a, b) => (RANK[b.letter] < RANK[a.letter] ? b : a)).letter : null;
}

/**
 * The last day the server grade moved with a new server version, from its grade history (fleet/history.jsonl via
 * lib/history.ts): the newest pair of graded runs whose worst grade differs. Failed runs say nothing about a grade and
 * are skipped. Silent when unsure (null): the history's latest grade is not the grade the page shows; that newest move
 * came with a Sealmark upgrade, an unknown Sealmark version, or no new server version (same version, same Sealmark,
 * different grade is a case for Sealmark's own accuracy checks, not a claim about the server); or a field is malformed.
 * @param {Array<{ date: string, status: string, worst?: string, version?: string, sealmark?: string }> | undefined} runs
 * @param {string | null} current the grade the results page shows
 * @returns {{ date: string, from: string, to: string, fromVersion: string } | null}
 */
export function gradeChange(runs, current) {
  if (!Array.isArray(runs) || !has(RANK, current)) return null;
  const text = (v) => typeof v === "string" && v.length > 0 && v.length <= 64;
  const ok = runs.filter((r) => r && r.status === "ok" && typeof r.date === "string" && DAY.test(r.date) && has(RANK, r.worst))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (ok.length < 2 || ok.at(-1).worst !== current) return null;
  for (let i = ok.length - 1; i > 0; i--) {
    const [a, b] = [ok[i - 1], ok[i]];
    if (a.worst === b.worst) continue;
    const sameSealmark = text(a.sealmark) && a.sealmark === b.sealmark;
    const newVersion = text(a.version) && text(b.version) && a.version !== b.version;
    return sameSealmark && newVersion ? { date: b.date, from: a.worst, to: b.worst, fromVersion: a.version } : null;
  }
  return null;
}

function keep(x, s, skip) {
  const term = s.q.trim().toLowerCase();
  if (term && !x.name.toLowerCase().includes(term) && !x.id.toLowerCase().includes(term)) return false;
  if (skip !== "source" && s.source && x.ecosystem !== s.source) return false;
  const d = deep(x);
  if (skip !== "area" && s.area && !d.some((p) => p.id === s.area)) return false;
  if (s.filter === "failing") return d.some((p) => p.letter === "D" || p.letter === "F");
  if (s.filter === "clean") return d.length > 0 && d.every((p) => p.letter !== "D" && p.letter !== "F");
  if (s.filter === "hygiene") return d.length === 0 && worstLetter(x) !== null;
  return true;
}

const rank = (x) => { const w = worstLetter(x); return w ? RANK[w] : -1; };
const byName = (a, b) => a.name.localeCompare(b.name);
const best = (a, b) => rank(b) - rank(a) || byName(a, b);
const newest = (a, b) => (b ?? "").localeCompare(a ?? ""); // missing dates sort last

const COMPARE = {
  best,
  worst: (a, b) => rank(a) - rank(b) || byName(a, b), // flip only the grade order; ties always go by name, A to Z
  name: byName,
  tested: (a, b) => newest(a.testedOn, b.testedOn) || byName(a, b),
  changed: (a, b) => newest(a.change?.date, b.change?.date) || best(a, b),
};

/** The rows the table shows for a view state, filtered and sorted (a new array). */
export function viewRows(rows, s) {
  return rows.filter((x) => keep(x, s)).sort(COMPARE[s.sort] ?? best);
}

/** How many rows each source and test-area choice would show, with every other active choice applied. */
export function facetCounts(rows, s) {
  const source = Object.fromEntries(SOURCES.map(([k]) => [k, 0]));
  const area = Object.fromEntries(AREAS.map((k) => [k, 0]));
  for (const x of rows) {
    if (keep(x, s, "source") && has(source, x.ecosystem)) source[x.ecosystem]++;
    if (keep(x, s, "area")) for (const p of deep(x)) if (has(area, p.id)) area[p.id]++;
  }
  return { source, area };
}

/** View state from the query string; unknown values fall back to the defaults. */
export function readState(p) {
  const pick = (k, allowed, def) => { const v = p.get(k); return v !== null && allowed.includes(v) ? v : def; };
  const n = Number(p.get("page"));
  return {
    q: p.get("q") ?? "",
    filter: pick("filter", FILTERS.map(([k]) => k), "all"),
    sort: pick("sort", SORTS, "best"),
    source: pick("source", SOURCES.map(([k]) => k), ""),
    area: pick("area", AREAS, ""),
    page: Number.isInteger(n) && n > 1 ? n : 1,
  };
}

/** Writes the view state into query params, leaving defaults out so the plain /results/ URL stays clean. */
export function writeState(params, s) {
  const set = (k, v, def) => (v && v !== def ? params.set(k, v) : params.delete(k));
  set("q", s.q.trim(), "");
  set("filter", s.filter, "all");
  set("sort", s.sort, "best");
  set("source", s.source, "");
  set("area", s.area, "");
  set("page", String(s.page), "1");
}
