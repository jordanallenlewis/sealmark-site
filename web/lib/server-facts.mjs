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

export const CLAIM_PATH = ".github/sealmark-claim.json"; // fleet/claim.mjs reads this file
const ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const fresh = (d, today) => Boolean(dayWords(d)) && (Date.parse(today) - Date.parse(String(d).slice(0, 10))) / 864e5 <= STALE_DAYS;

/**
 * The "Maintainer" block on a server page (sealmark-site#69), from the same fleet/server-facts.json entry.
 * claimed: the repository the package names says, in its claim file, that it maintains this server (re-read daily,
 * hidden after STALE_DAYS without a successful read). unclaimed: the repository may claim it, so the page shows the
 * file to commit. Null when there is no such repository, when the entry is stale, and always for a held server (its
 * page shows no repository at all). A claim is never a judgement: it changes no grade, badge or ranking.
 * @param {{checkedAt?: string, repo?: {name?: string}|null, claim?: {repo?: string, checkedAt?: string, ended?: string}, claimable?: boolean}|undefined} e
 * @param {{id: string}} server
 * @param {{held: boolean, today: string}} o
 */
export function maintainerClaim(e, server, { held, today }) {
  if (held || !e || typeof e !== "object" || !fresh(e.checkedAt, today)) return null;
  const c = e.claim;
  if (c && typeof c === "object" && !c.ended && REPO.test(String(c.repo ?? "")) && fresh(c.checkedAt, today)) {
    return { state: "claimed", repo: c.repo, url: `https://github.com/${c.repo}`, checked: dayWords(c.checkedAt) };
  }
  const name = String(e.repo?.name ?? "");
  if (e.claimable !== true || !REPO.test(name) || !ID.test(String(server.id ?? ""))) return null;
  return {
    state: "unclaimed",
    repo: name,
    url: `https://github.com/${name}`,
    path: CLAIM_PATH,
    file: JSON.stringify({ sealmark: "claim/1", servers: [server.id] }, null, 2),
  };
}
