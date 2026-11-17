// Plain facts about each graded server's package and repository, for its results page: the license, the latest
// release and its date, and the repository's last push, open issue count and archived flag. Read from npm, PyPI and the
// GitHub API; written to fleet/server-facts.json, which the site reads at build time (web/lib/server-facts.mjs).
//
// Facts only, never a score: nothing here feeds a grade, a badge or an owner notice. fleet/notify-owners.mjs runs it
// after resolving repositories (fleet/owner-repos.json), with the workflow's own read-only token. A failed lookup keeps
// the server's last entry, dated, so the page says when it was true; the page hides an entry older than STALE_DAYS.
// Every string is someone else's data: control and format characters are removed and over-long values dropped.

export const FILE = "fleet/server-facts.json";
export const REFRESH_DAYS = 1; // an entry younger than this is not looked up again
export const MAX_LOOKUPS = 400; // servers looked up per run (the oldest entries first)
export const FETCH_MS = 15_000; // one request; a slow registry never holds the owner step
export const BUDGET_MS = 6 * 60_000; // the whole collection per run; what is left waits for the next run

const day = (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null);

/** Someone else's short text: single line, no control or format characters (bidi overrides, zero-width), at most max. */
export function clean(text, max = 60) {
  if (typeof text !== "string") return null;
  const s = text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();
  return s && s.length <= max ? s : null;
}

/** npm's license field: "MIT", {type: "MIT"}, or the legacy licenses array (one entry only; several: not shown). */
export function npmLicense(meta) {
  const ls = Array.isArray(meta?.licenses) ? meta.licenses : null;
  const l = meta?.license ?? (ls?.length === 1 ? ls[0] : null);
  return clean(typeof l === "string" ? l : l?.type, 60);
}
/** The package says something about its license, whether or not we can show it (then the repository's is no stand-in). */
export function npmNamesLicense(meta) {
  return Boolean(meta?.license || (Array.isArray(meta?.licenses) && meta.licenses.length));
}

const UNSET = /^(unknown|none|)$/i; // setuptools writes UNKNOWN for a missing field
const licenseClassifiers = (info) => (info?.classifiers ?? []).filter((c) => typeof c === "string" && c.startsWith("License ::"));

/** PyPI: the SPDX license_expression, else a one-line license field, else the License classifiers (a bare "OSI Approved" names none). */
export function pypiLicense(info) {
  const expr = clean(info?.license_expression, 60);
  if (expr) return expr;
  const field = typeof info?.license === "string" ? info.license.trim() : "";
  if (field && !/[\r\n]/.test(field) && !UNSET.test(field)) return clean(field, 60);
  const names = licenseClassifiers(info).map((c) => c.split("::").map((x) => x.trim())).filter((parts) => parts.length >= 3).map((parts) => parts.pop());
  return names.length ? clean([...new Set(names)].join(", "), 60) : null;
}
export function pypiNamesLicense(info) {
  const field = typeof info?.license === "string" ? info.license.trim() : "";
  return Boolean(clean(info?.license_expression, 1000) || (field && !UNSET.test(field)) || licenseClassifiers(info).length);
}

/** The npm dist-tag latest and its publish date, from the full packument. */
export function npmLatest(doc) {
  const v = clean(doc?.["dist-tags"]?.latest, 40);
  if (!v) return null;
  return { version: v, date: day(doc?.time?.[doc["dist-tags"].latest]) };
}

/** PyPI's current version and the first upload time of its files. */
export function pypiLatest(meta) {
  const v = clean(meta?.info?.version, 40);
  if (!v) return null;
  const times = (meta?.urls ?? []).map((u) => day(u?.upload_time_iso_8601 ?? u?.upload_time)).filter(Boolean).sort();
  return { version: v, date: times[0] ?? null };
}

/** A GitHub release: its tag (a leading v dropped) and publish date. */
export function githubLatest(rel) {
  if (!rel || rel.missing || rel.draft || rel.prerelease) return null;
  const v = clean(String(rel.tag_name ?? "").replace(/^v(?=\d)/i, ""), 40);
  return v ? { version: v, date: day(rel.published_at) } : null;
}

const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

/** The repository facts from GET /repos/{repo}; null when it is missing or not a plain owner/name. */
export function repoFacts(r) {
  if (!r || r.missing || !REPO.test(String(r.full_name ?? ""))) return null;
  const spdx = clean(r.license?.spdx_id, 40);
  const issues = Number.isInteger(r.open_issues_count) && r.open_issues_count >= 0 ? r.open_issues_count : null;
  return {
    name: r.full_name,
    license: spdx && spdx !== "NOASSERTION" ? spdx : null,
    pushedAt: day(r.pushed_at),
    archived: r.archived === true,
    openIssues: issues,
  };
}

const KEYWORD = /^[a-z0-9][a-z0-9 ._+-]{0,39}$/;
export const MAX_KEYWORDS = 20;

/**
 * What a package declares it is about, for the site's topic pages (web/lib/topics.mjs): its own keywords (npm keywords,
 * PyPI keywords) and its repository's GitHub topics, lower-cased, plain and short, at most MAX_KEYWORDS. Someone else's
 * words, used only to match the site's fixed topic terms; never shown, never a score. Null when it declares none.
 */
export function about(...keywordLists) {
  const kw = [];
  for (const list of keywordLists) {
    const items = Array.isArray(list) ? list : typeof list === "string" ? list.split(list.includes(",") ? "," : /\s+/) : [];
    for (const k of items) {
      const v = clean(typeof k === "string" ? k.toLowerCase() : null, 40);
      if (v && KEYWORD.test(v) && !kw.includes(v) && kw.length < MAX_KEYWORDS) kw.push(v);
    }
  }
  return kw.length ? { keywords: kw } : null;
}

const npmDocUrl = (name) => `https://registry.npmjs.org/${String(name).replace("/", "%2F")}`;
const pypiUrl = (name) => `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;

async function getJson(fetchFn, url) {
  const res = await fetchFn(url, { headers: { accept: "application/json", "user-agent": "sealmark-fleet" }, signal: AbortSignal.timeout(FETCH_MS) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

/** GitHub GET with its own timeout and token: {missing: true} on 404; an error with .status otherwise. */
export function githubGetter(fetchFn, token) {
  return async (path) => {
    const res = await fetchFn(`https://api.github.com${path}`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "sealmark-fleet", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    if (res.status === 404) return { missing: true };
    if (!res.ok) { const e = new Error(`GitHub GET ${path}: ${res.status}`); e.status = res.status; throw e; }
    return res.json();
  };
}

/**
 * One server's facts. Throws on any failed lookup (the caller keeps the last entry): a half-read entry would say a
 * repository has no license when the lookup only failed.
 *   api(path): GitHub GET, {missing: true} on 404, throws otherwise.
 */
export async function lookup(server, repo, { fetchFn, api, today }) {
  const out = { checkedAt: today, source: server.ecosystem, license: null, latest: null, repo: null };
  let named = false; // the package states a license (even one we cannot show): the repository's is then no stand-in
  let kw = null;
  if (server.ecosystem === "npm") {
    const doc = await getJson(fetchFn, npmDocUrl(server.name));
    const meta = doc?.versions?.[doc?.["dist-tags"]?.latest] ?? doc;
    out.latest = npmLatest(doc);
    out.license = npmLicense(meta);
    named = npmNamesLicense(meta);
    kw = meta?.keywords ?? doc?.keywords;
  } else if (server.ecosystem === "pypi") {
    const meta = await getJson(fetchFn, pypiUrl(server.name));
    out.latest = pypiLatest(meta);
    out.license = pypiLicense(meta?.info);
    named = pypiNamesLicense(meta?.info);
    kw = meta?.info?.keywords;
  } else if (server.ecosystem !== "github") {
    throw new Error(`unknown ecosystem ${server.ecosystem}`);
  }
  let topics = null;
  if (repo) {
    const r = await api(`/repos/${repo}`);
    out.repo = repoFacts(r);
    if (out.repo && Array.isArray(r.topics)) topics = r.topics; // GitHub topics are always a list; anything else is ignored
    if (server.ecosystem === "github" && out.repo) out.latest = githubLatest(await api(`/repos/${repo}/releases/latest`));
  }
  if (!out.license && !named && out.repo?.license) { out.license = out.repo.license; out.licenseFrom = "repo"; }
  if (out.repo) delete out.repo.license;
  const a = about(kw, topics);
  if (a) out.about = a;
  return out;
}

const age = (from, today) => (Date.parse(today) - Date.parse(from)) / 864e5;

/**
 * The new file: every server in results gets looked up when its entry is missing or REFRESH_DAYS old (oldest first, at
 * most max); failures keep the old entry; servers no longer in results are dropped. Never throws.
 *   repos: fleet/owner-repos.json (id -> {repo}); previous: the last file
 */
export async function collect({ servers, repos, previous, today, fetchFn, api, max = MAX_LOOKUPS, budgetMs = BUDGET_MS, clock = Date.now, sleep = async () => {}, log = () => {} }) {
  const start = clock();
  const old = previous?.servers ?? {};
  const keep = {};
  const due = [];
  for (const x of servers) {
    const e = old[x.id];
    if (e) keep[x.id] = e;
    if (!e || !day(e.checkedAt) || age(e.checkedAt, today) >= REFRESH_DAYS) due.push(x);
  }
  due.sort((a, b) => String(old[a.id]?.checkedAt ?? "").localeCompare(String(old[b.id]?.checkedAt ?? "")));
  let ok = 0, failed = 0;
  let tried = 0, stop = null;
  for (const x of due.slice(0, max)) {
    if (clock() - start > budgetMs) { stop = "time budget used"; break; }
    tried += 1;
    try { keep[x.id] = await lookup(x, repos[x.id]?.repo ?? null, { fetchFn, api, today }); ok += 1; }
    catch (e) {
      failed += 1;
      log(`facts lookup failed for ${x.id}: ${String(e.message ?? e).slice(0, 120)}`);
      if (e.status === 403 || e.status === 429) { stop = `GitHub said ${e.status} (rate limit?)`; break; }
    }
    await sleep(100);
  }
  log(`facts: ${ok} looked up, ${failed} failed, ${due.length - tried} left for the next run${stop ? ` (stopped: ${stop})` : ""}, ${Object.keys(keep).length} servers`);
  return { servers: Object.fromEntries(Object.entries(keep).sort(([a], [b]) => a.localeCompare(b))) };
}
