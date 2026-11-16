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

const day = (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null);

/** Someone else's short text: single line, no control or format characters (bidi overrides, zero-width), at most max. */
export function clean(text, max = 60) {
  if (typeof text !== "string") return null;
  const s = text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();
  return s && s.length <= max ? s : null;
}

/** npm's license field: "MIT", {type: "MIT"}, or the legacy licenses array. */
export function npmLicense(meta) {
  const l = meta?.license ?? (Array.isArray(meta?.licenses) ? meta.licenses[0] : null);
  return clean(typeof l === "string" ? l : l?.type, 40);
}

/** PyPI: the SPDX license_expression, else a short license field, else the last License classifier. */
export function pypiLicense(info) {
  const expr = clean(info?.license_expression, 40);
  if (expr) return expr;
  const raw = typeof info?.license === "string" && !/[\r\n]/.test(info.license.trim()) ? clean(info.license, 40) : null;
  if (raw && !/^(unknown|none|other)$/i.test(raw)) return raw;
  const cls = (info?.classifiers ?? []).filter((c) => typeof c === "string" && c.startsWith("License ::")).pop();
  const last = cls ? cls.split("::").pop() : null;
  return last && !/^\s*other\/proprietary license\s*$/i.test(last) ? clean(last, 40) : null;
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

const npmDocUrl = (name) => `https://registry.npmjs.org/${String(name).replace("/", "%2F")}`;
const pypiUrl = (name) => `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;

async function getJson(fetchFn, url) {
  const res = await fetchFn(url, { headers: { accept: "application/json", "user-agent": "sealmark-fleet" } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

/**
 * One server's facts. Throws on any failed lookup (the caller keeps the last entry): a half-read entry would say a
 * repository has no license when the lookup only failed.
 *   api(path): GitHub GET, {missing: true} on 404, throws otherwise.
 */
export async function lookup(server, repo, { fetchFn, api, today }) {
  const out = { checkedAt: today, source: server.ecosystem, license: null, latest: null, repo: null };
  if (server.ecosystem === "npm") {
    const doc = await getJson(fetchFn, npmDocUrl(server.name));
    out.latest = npmLatest(doc);
    out.license = npmLicense(doc?.versions?.[doc?.["dist-tags"]?.latest] ?? doc);
  } else if (server.ecosystem === "pypi") {
    const meta = await getJson(fetchFn, pypiUrl(server.name));
    out.latest = pypiLatest(meta);
    out.license = pypiLicense(meta?.info);
  } else if (server.ecosystem !== "github") {
    throw new Error(`unknown ecosystem ${server.ecosystem}`);
  }
  if (repo) {
    out.repo = repoFacts(await api(`/repos/${repo}`));
    if (server.ecosystem === "github" && out.repo) out.latest = githubLatest(await api(`/repos/${repo}/releases/latest`));
  }
  if (!out.license && out.repo?.license) { out.license = out.repo.license; out.licenseFrom = "repo"; }
  if (out.repo) delete out.repo.license;
  return out;
}

const age = (from, today) => (Date.parse(today) - Date.parse(from)) / 864e5;

/**
 * The new file: every server in results gets looked up when its entry is missing or REFRESH_DAYS old (oldest first, at
 * most max); failures keep the old entry; servers no longer in results are dropped. Never throws.
 *   repos: fleet/owner-repos.json (id -> {repo}); previous: the last file
 */
export async function collect({ servers, repos, previous, today, fetchFn, api, max = MAX_LOOKUPS, sleep = async () => {}, log = () => {} }) {
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
  for (const x of due.slice(0, max)) {
    try { keep[x.id] = await lookup(x, repos[x.id]?.repo ?? null, { fetchFn, api, today }); ok += 1; }
    catch (e) { failed += 1; log(`facts lookup failed for ${x.id}: ${String(e.message ?? e).slice(0, 120)}`); }
    await sleep(100);
  }
  log(`facts: ${ok} looked up, ${failed} failed, ${Math.max(0, due.length - max)} left for the next run, ${Object.keys(keep).length} servers`);
  return { servers: Object.fromEntries(Object.entries(keep).sort(([a], [b]) => a.localeCompare(b))) };
}
