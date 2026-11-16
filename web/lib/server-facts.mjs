// The "Package facts" block on a server page: license, latest release, and the repository's last push, open issue count
// and archived flag, from fleet/server-facts.json (written by the fleet's re-test run, fleet/server-facts.mjs).
// Plain facts read from npm, PyPI and GitHub, never a judgement: nothing here feeds a grade. Pure; covered by
// lib/server-facts.test.mjs.
import { dayWords } from "./owner-notice.mjs";

export const STALE_DAYS = 30; // an entry not refreshed for this long is not shown: it may no longer be true

const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/;
const SOURCE = { npm: "npm", pypi: "PyPI" };

/** Someone else's short text again, at render: one line, no control or format characters, at most max. */
function clean(text, max) {
  if (typeof text !== "string") return null;
  const s = text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();
  return s && s.length <= max ? s : null;
}
/** npm's special license values in plain words (npm packages only); anything else as written. Plain ASCII only. */
function licenseWords(l, source) {
  if (!l || !/^[\x20-\x7E]+$/.test(l)) return null;
  if (source !== "npm") return l;
  const file = /^SEE LICEN[CS]E IN\s+(\S+)$/i.exec(l)?.[1];
  if (file) return `in the file ${file}, as the package says`;
  if (l === "UNLICENSED") return "UNLICENSED (npm's word for no rights granted to others)";
  return l;
}
const bareVersion = (v) => String(v ?? "").replace(/^v(?=\d)/i, "");

/**
 * @param {{checkedAt?: string, source?: string, license?: string|null, licenseFrom?: string, latest?: {version?: string, date?: string|null}|null, repo?: {name?: string, pushedAt?: string|null, archived?: boolean, openIssues?: number|null}|null}|undefined} e
 * @param {{ecosystem: string, versionTested: string}} server
 * @param {{held: boolean, today: string}} o held: a security finding is under private disclosure (no repository facts)
 */
export function serverFacts(e, server, { held, today }) {
  if (!e || typeof e !== "object") return null;
  const checked = dayWords(e.checkedAt);
  if (!checked || (Date.parse(today) - Date.parse(String(e.checkedAt).slice(0, 10))) / 864e5 > STALE_DAYS) return null;

  const license = licenseWords(clean(e.license, 60), e.source);
  const v = clean(e.latest?.version, 40);
  // A repository launch starts the default branch, so which commit was graded is not a release: no comparison.
  const graded = server.ecosystem === "github" || e.source === "github" ? null : bareVersion(v) === bareVersion(server.versionTested);
  // Held: a newer release beside a withheld finding would point at the fix.
  const latest = !held && v && VERSION.test(v) ? { version: v, date: dayWords(e.latest?.date), graded } : null;
  const r = e.repo;
  const repo = !held && r && REPO.test(String(r.name ?? ""))
    ? {
        name: r.name,
        url: `https://github.com/${r.name}`,
        pushed: dayWords(r.pushedAt),
        archived: r.archived === true,
        openIssues: Number.isInteger(r.openIssues) && r.openIssues >= 0 ? r.openIssues : null,
      }
    : null;
  if (!license && !latest && !repo) return null;
  const pkg = SOURCE[e.source] ?? null;
  return {
    license,
    kind: e.source === "github" ? "project" : "package",
    licenseFrom: e.licenseFrom === "repo" && e.source !== "github" ? "repo" : "package",
    latest,
    repo,
    checked,
    from: pkg ? (repo ? `${pkg} and GitHub` : pkg) : "GitHub",
  };
}
