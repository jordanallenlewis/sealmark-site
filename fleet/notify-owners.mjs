// Tells MCP server owners their Sealmark grade: one GitHub issue per repository, opened on the first grade, never
// again. Runs in fleet.yml after merge.mjs, as a step that may fail without stopping the commit and deploy after it.
//
//   node fleet/notify-owners.mjs            draft or file, depending on the gate below
//   node fleet/notify-owners.mjs --dry      never files; writes the drafts file even when the gate is open
//
// Gate: issues are opened only when the OWNER_ISSUES_TOKEN secret is set AND OWNER_ISSUES_LIVE is "1" (the repository
// variable, or one hand-approved batch: the fleet workflow's "file_owner_issues" input, which also sets
// OWNER_ISSUES_APPROVED). Otherwise the next issues are written to fleet/owner-issues-draft.md for review.
//   - A hand-approved run posts only the "## owner/repo" entries of the committed draft, and only when the issue it
//     renders now is byte for byte the one in the draft; anything else is skipped and the log says why.
//   - The token is checked with GET /user in every mode. A 401 prints a warning and the read-only lookups fall back to
//     GITHUB_TOKEN; nothing is posted. An account in SELF (Jordan's own) is refused: issues come from the bot only.
//   - Pacing for a new account: at most MAX_OWNER_ISSUES issues per run (default 2), at least 60 s between two posts,
//     at most one issue per repository owner (user or organisation) in 24 hours.
//   - One failed `gh` call never fails the run: a per-repository error (404, 410, 422, issues off) is recorded in the
//     ledger and the loop moves on; a repository that failed 3 times is skipped. A 401, 403, 429, a rate limit or any
//     other error stops the posting loop (not the run).
//
// Who gets an issue, in order (plan() below):
//   - HELD for private handling: a server with a failing or partly passing check that is not on the public allowlist
//     in fleet/security-checks.mjs (fail closed: an unknown check holds too). Every server is evaluated, also ungraded
//     ones and ones whose repository lookup failed. The whole repository is held. Held repositories go to the gitignored
//     fleet/owner-private-queue.json and fleet/owner-private-draft.md, never sent by this script; the public files and
//     the log give only their count;
//   - skipped for good or for now (listed under "Skipped" with the reason): no GitHub repository, opted out, our own,
//     3 failed posts, missing, archived, fork, issues off; a stale grade or a failed latest re-test; no tools declared;
//     no tool reached with a valid call (hygiene-only coverage) unless the grade is an A; a launch line that cannot be
//     reproduced as written ({dsn} placeholders, quotes); a grade below A that only weak signals explain; a newer
//     release than the one tested (waits for its re-test); a package that lives in a subfolder of a larger repository,
//     or a repository whose root package is not the package tested (a copy or a release-only repository);
//   - a renamed or transferred repository is followed to its canonical name, which is stored in owner-repos.json.
//
// Replies: every run reads the comments on the issues the bot opened. Replies from people are recorded in the ledger,
// listed in fleet/owner-weekly.md and the Actions step summary, and mirrored to one tracking issue in this repository
// ("Owner replies to Sealmark issues", created once with the workflow's GITHUB_TOKEN). Removal and recheck requests
// are listed first; acting on them is Jordan's call.
//
// Files (tracked, committed by the collect job):
//   fleet/owner-repos.json      server id -> GitHub repo (or null), resolved from the launch line or npm/PyPI metadata
//   fleet/owner-notified.json   the ledger: issues opened (with the baseline fleet/impact.mjs measures from), failed
//                               posts per repository, replies, and the tracking issue's number
//   fleet/owner-optout.json     repositories that asked not to hear from Sealmark; honoured forever, never pruned
//   fleet/owner-issues-draft.md the issues the next live run would open (rewritten each run while the gate is shut)
//   fleet/owner-weekly.md       the weekly counts and the replies of the last 7 days
// Not tracked (.gitignore): fleet/owner-private-queue.json and fleet/owner-private-draft.md, rewritten every run.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ISSUE_MARKER, ORIGIN, RANK, failingChecks, issueDraft, letterOf, notPassed } from "../web/worker/notify-core.mjs";
import { failedSince } from "../web/lib/retest.mjs";
import { PUBLIC, isPublicCheck, isSecurityCheck, isWeakSignal, securityFindings } from "./security-checks.mjs";

export const FILES = {
  results: "web/content/data/server-results.json",
  repos: "fleet/owner-repos.json",
  ledger: "fleet/owner-notified.json",
  optout: "fleet/owner-optout.json",
  draft: "fleet/owner-issues-draft.md",
  privateQueue: "fleet/owner-private-queue.json",
  privateDraft: "fleet/owner-private-draft.md",
  weekly: "fleet/owner-weekly.md",
};
// Issues per run: MAX_OWNER_ISSUES when it is a whole number of at least 1, else 2.
export const DEFAULT_MAX_ISSUES = 2;
export function maxIssues(value) {
  const n = Number(String(value ?? "").trim() || NaN);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_MAX_ISSUES;
}
export const MAX_ISSUES = maxIssues(process.env.MAX_OWNER_ISSUES);
export const FRESH_DAYS = 14; // a grade older than this waits for a re-test before its owner is told
export const SELF = ["jordanallenlewis"]; // never notify our own repositories, never post as this account
export const PACE_MS = 60_000; // at least this long between two posts
export const OWNER_WINDOW_MS = 24 * 3600_000; // one issue per repository owner in this window
export const MAX_REPO_FAILURES = 3; // a repository whose post failed this often is skipped
export const TRACKING_REPO = "jordanallenlewis/sealmark-site";
export const TRACKING_TITLE = "Owner replies to Sealmark issues";
const RESOLVE_AGAIN_DAYS = 30; // a server with no repo found is looked up again after this long
const lookupBudget = (max) => max * 10 + 10; // repositories checked over the network per run

// ---- repository resolution ----

// owner/repo from any GitHub URL or npm-style shorthand; null when it is not GitHub.
export function parseRepo(text) {
  if (!text) return null;
  const s = String(text).trim();
  const m = s.match(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/#?].*)?$/i) ?? s.match(/^(?:github:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:#.*)?$/i);
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
}

// The folder of a GitHub URL that points inside a repository (…/tree/main/packages/x), or "".
export function dirFromUrl(text) {
  const m = String(text ?? "").match(/github\.com[/:][^/]+\/[^/#?]+\/(?:tree|blob)\/[^/]+\/([^#?]+?)\/?(?:[#?].*)?$/i);
  return m ? m[1] : "";
}

// The repo named in a launch line (github ecosystem): `npx -y github:o/r`, `uvx --from git+https://github.com/o/r x`.
export function repoFromLaunch(launch) {
  for (const tok of String(launch ?? "").split(/\s+/)) {
    if (/^github:|github\.com/i.test(tok)) {
      const r = parseRepo(tok.replace(/^git\+/, ""));
      if (r) return r;
    }
  }
  return null;
}

const npmRepoUrl = (meta) => { const r = meta?.repository; return typeof r === "string" ? r : r?.url; };
export function repoFromNpm(meta) {
  return parseRepo(npmRepoUrl(meta)) ?? parseRepo(meta?.homepage) ?? parseRepo(meta?.bugs?.url);
}

const PYPI_KEYS = ["Source", "Source Code", "Repository", "Code", "GitHub", "Homepage", "Home"];
function pypiRepoUrl(meta) {
  const info = meta?.info ?? {};
  const urls = info.project_urls ?? {};
  for (const k of PYPI_KEYS) if (parseRepo(urls[k])) return urls[k];
  for (const v of Object.values(urls)) if (parseRepo(v)) return v;
  return parseRepo(info.home_page) ? info.home_page : null;
}
export function repoFromPypi(meta) {
  return parseRepo(pypiRepoUrl(meta));
}

async function getJson(fetchFn, url) {
  const res = await fetchFn(url, { headers: { accept: "application/json", "user-agent": "sealmark-fleet" } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

const npmLatestUrl = (name) => `https://registry.npmjs.org/${name.replace("/", "%2F")}/latest`;
const pypiUrl = (name) => `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;

export async function resolveRepo(server, fetchFn = fetch) {
  if (server.ecosystem === "github") return { repo: repoFromLaunch(server.launch) ?? parseRepo(`github:${server.name}`), source: "launch" };
  if (server.ecosystem === "npm") return { repo: repoFromNpm(await getJson(fetchFn, npmLatestUrl(server.name))), source: "npm" };
  if (server.ecosystem === "pypi") return { repo: repoFromPypi(await getJson(fetchFn, pypiUrl(server.name))), source: "pypi" };
  return { repo: null, source: "unknown ecosystem" };
}

// ---- eligibility ----

// Why a graded server's grade is not fresh enough to tell its owner about, or null when it is.
export function staleReason(server, today) {
  const failed = failedSince(server);
  if (failed) return `latest re-test failed on ${failed.date}; waits for a fresh grade`;
  const days = (Date.parse(today) - Date.parse(server.testedAt)) / 864e5;
  if (!(days <= FRESH_DAYS)) return `grade from ${server.testedAt} is older than ${FRESH_DAYS} days; waits for a fresh grade`;
  return null;
}

// Why the launch line cannot go in the reproduce command as written, or null.
export function launchProblem(launch) {
  const s = String(launch ?? "");
  const ph = s.match(/\{[a-z_:]+\}/i);
  if (ph) return `the launch line needs a value the test harness fills in (${ph[0]}), so the reproduce command would not run as written`;
  if (/["`]/.test(s)) return "the launch line has quotes, so the reproduce command would not paste as written";
  if (!s.trim()) return "no launch line recorded";
  return null;
}

// The failing or partly passing checks an issue may name: scored, in a graded test area, on the public allowlist.
export const listedChecks = (server) => notPassed(server).filter(isPublicCheck);

// Why the grade cannot be explained in public, or null. Every test area below an A must have at least one check the
// issue can name; an A must have every scored check passed or a nameable one that did not.
export function weakReason(server) {
  const letter = letterOf(server);
  const listed = listedChecks(server);
  const nonPass = notPassed(server);
  if (letter === "A") return nonPass.length && !listed.length ? "an A that is not full marks only because of weak signals (partial results with nothing conclusive); waits for a clearer re-test" : null;
  const below = (server.packs ?? []).filter((p) => p.status === "graded" && p.letter && p.letter !== "A");
  if (below.every((p) => listed.some((c) => c.pack === p.id))) return null;
  return "the grade below A comes only from weak signals (partial results with nothing conclusive, or checks that did not finish); waits for a clearer re-test";
}

// The checks that need no network: freshness, coverage, launch line, weak signals. {code, reason} or null.
export function serverGate(server, today) {
  const stale = staleReason(server, today);
  if (stale) return { code: "stale", reason: stale };
  const cov = server.coverage;
  if (!cov) return { code: "no-coverage", reason: "the result has no coverage data" };
  const tools = cov.toolsTotal ?? server.toolCount ?? 0;
  if (!tools) return { code: "no-tools", reason: "the server declared no tools, so nothing past the handshake was tested" };
  if (cov.level === "hygiene-only" && letterOf(server) !== "A") return { code: "hygiene-only", reason: `no tool answered a valid call with default settings (0 of ${tools}), so the grade covers the handshake and tool metadata only` };
  const launch = launchProblem(server.launch);
  if (launch) return { code: "launch", reason: launch };
  const weak = weakReason(server);
  if (weak) return { code: "weak-signals", reason: weak };
  return null;
}

// Version order: is `latest` newer than `tested`? Numeric parts first; a release beats its own pre-release; strings
// that do not parse count as newer when they differ (fail closed: wait for a re-test).
export function isNewer(latest, tested) {
  if (!latest || !tested) return false;
  const parse = (v) => { const m = String(v).trim().replace(/^v/i, "").match(/^(\d+(?:\.\d+)*)(.*)$/); return m ? { nums: m[1].split(".").map(Number), pre: m[2] } : null; };
  const a = parse(latest);
  const b = parse(tested);
  if (!a || !b) return String(latest).replace(/^v/i, "") !== String(tested).replace(/^v/i, "");
  for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i++) {
    const d = (a.nums[i] ?? 0) - (b.nums[i] ?? 0);
    if (d) return d > 0;
  }
  return Boolean(b.pre) && !a.pre;
}

// npm names compare case-insensitively; PyPI names by their normalised form (PEP 503).
export const sameName = (a, b) => String(a ?? "").toLowerCase().replace(/[-_.]+/g, "-") === String(b ?? "").toLowerCase().replace(/[-_.]+/g, "-");

// The checks that need the network (facts: {latest, directory, root} or {error}). {code, reason} or null.
//   root: the package manifest at the repository root: {name, version, monorepo} or {missing: true}
export function factsGate(server, facts) {
  if (facts.error) return { code: "check-failed", reason: `could not check the repository or the latest version (${facts.error}); waits` };
  const tested = server.ecosystem === "github" ? (server.refTested ?? server.versionTested) : server.versionTested;
  if (facts.latest && isNewer(facts.latest, tested)) return { code: "newer-version", reason: `version ${facts.latest} is out and ${tested} was tested; waits for the re-test` };
  const dir = String(facts.directory ?? "").replace(/^\.?\/+|\/+$/g, "");
  if (dir && dir !== ".") return { code: "monorepo", reason: `the package lives in \`${dir}\` of a larger repository and the issue would not name that folder` };
  if (server.ecosystem === "github") return null; // started from the repository root itself
  const root = facts.root;
  if (!root || root.missing) return { code: "not-source", reason: "no package manifest at the repository root (a release-only repository or a copy?)" };
  if (!sameName(root.name, server.name)) {
    return root.monorepo
      ? { code: "monorepo", reason: `the root package is \`${root.name}\` (a monorepo) and the issue would not name the folder of \`${server.name}\`` }
      : { code: "not-source", reason: `the root package is \`${root.name ?? "unnamed"}\`, not \`${server.name}\` (a copy or a different project?)` };
  }
  return null;
}

// ---- the plan ----

// Which graded servers get an issue this run, which repositories are held for a private report, and why the others
// get neither. Pure: callers pass what the network said.
//   cache: id -> {repo}; ledger: {issues, failures}; optout: {repos}; meta: repo -> GitHub repo object, {missing} or
//   {error}; facts: id -> factsGate input; today: YYYY-MM-DD; now: ms, for the per-owner window;
//   only: Set of lowercased repos (a hand-approved batch) or null
// Returns send (at most max), eligible (all), waiting, skipped [{id, repo, code, reason}], held [{repo, servers}] and
// unchecked [{repo, servers}] (candidates that need network checks before they can be judged).
export function plan({ servers, cache, ledger, optout, meta = {}, facts = {}, max = MAX_ISSUES, today = new Date().toISOString().slice(0, 10), now = Date.parse(`${today}T12:00:00Z`), only = null }) {
  const notified = new Set((ledger.issues ?? []).map((i) => i.repo.toLowerCase()));
  const opted = new Set((optout.repos ?? []).map((r) => r.toLowerCase()));
  const failures = new Map((ledger.failures ?? []).map((f) => [f.repo.toLowerCase(), f]));
  const sorted = [...servers].sort((a, b) => String(a.testedAt).localeCompare(String(b.testedAt)) || a.id.localeCompare(b.id));
  const skipped = [];
  const skip = (x, repo, g) => skipped.push({ id: x.id, repo, code: g.code, reason: g.reason });
  const keyOf = (x) => (cache[x.id]?.repo ? cache[x.id].repo.toLowerCase() : `id:${x.id}`);

  // 1. holds: every server, graded or not, with a repository or not
  const held = new Map();
  for (const x of sorted) if (securityFindings(x).length && !held.has(keyOf(x))) held.set(keyOf(x), { repo: cache[x.id]?.repo ?? null, servers: [] });
  const byRepo = new Map();
  for (const x of sorted) {
    const k = keyOf(x);
    if (held.has(k)) { held.get(k).servers.push(x); continue; }
    if (!letterOf(x)) continue; // not graded: nothing to tell yet
    const c = cache[x.id];
    if (!c) { skip(x, null, { code: "lookup-failed", reason: "repository lookup failed; tried again next run" }); continue; }
    if (!c.repo) { skip(x, null, { code: "no-repo", reason: "no GitHub repository found" }); continue; }
    if (!byRepo.has(k)) byRepo.set(k, { repo: c.repo, servers: [] });
    byRepo.get(k).servers.push(x);
  }

  // 2. per repository
  const busy = new Set((ledger.issues ?? []).filter((i) => {
    const t = Date.parse(i.postedAt ?? `${i.at}T00:00:00Z`);
    return Number.isFinite(t) && now - t < OWNER_WINDOW_MS && now >= t;
  }).map((i) => i.repo.split("/")[0].toLowerCase()));
  const eligible = [];
  const unchecked = [];
  for (const [key, { repo, servers: graded }] of byRepo) {
    if (notified.has(key)) continue;
    if (only && !only.has(key)) continue;
    const owner = key.split("/")[0];
    const f = failures.get(key);
    const repoWhy = opted.has(key) ? { code: "opted-out", reason: "opted out" }
      : SELF.includes(owner) ? { code: "own", reason: "our own repository" }
      : (f?.failed ?? 0) >= MAX_REPO_FAILURES ? { code: "failures", reason: `posting failed ${f.failed} times (last: ${f.status} at ${f.at}); skipped` }
      : null;
    if (repoWhy) { skip(graded[0], repo, repoWhy); continue; }
    const pass = [];
    for (const x of graded) { const g = serverGate(x, today); if (g) skip(x, repo, g); else pass.push(x); }
    if (!pass.length) continue;
    const m = meta[repo];
    if (!m || pass.some((x) => !facts[x.id])) { unchecked.push({ repo, servers: pass }); continue; }
    const metaWhy = m.missing ? { code: "missing", reason: "repository not found" }
      : m.error ? { code: "check-failed", reason: `repository check failed (${m.error}); waits` }
      : m.archived ? { code: "archived", reason: "archived" }
      : m.fork ? { code: "fork", reason: "fork" }
      : m.has_issues === false ? { code: "issues-off", reason: "issues disabled" }
      : null;
    if (metaWhy) { skip(pass[0], repo, metaWhy); continue; }
    const ok = [];
    for (const x of pass) { const g = factsGate(x, facts[x.id]); if (g) skip(x, repo, g); else ok.push(x); }
    if (!ok.length) continue;
    if (busy.has(owner)) { skip(ok[0], repo, { code: "owner-limit", reason: `waits: ${owner} already gets a Sealmark issue within 24 hours (one per owner per day)` }); continue; }
    busy.add(owner);
    eligible.push({ repo, server: ok[0], also: ok.slice(1) });
  }
  return { send: eligible.slice(0, max), eligible: eligible.length, waiting: Math.max(0, eligible.length - max), skipped, held: [...held.values()], unchecked };
}

// The issue for one repository. Refuses a repository with a security finding: plan() holds those, and this is the
// second lock.
export function draftFor(entry) {
  const all = [entry.server, ...entry.also];
  if (all.some((x) => securityFindings(x).length)) throw new Error(`${entry.repo}: security finding, held for a private report; no public issue`);
  const d = issueDraft({ id: entry.server.id, server: entry.server, repo: entry.repo, listed: listedChecks(entry.server), also: entry.also });
  if (/\n---\n/.test(d.body)) throw new Error(`${entry.repo}: the issue body contains a "---" line, which the drafts file uses as a separator`);
  return d;
}

// The baseline fleet/impact.mjs measures this notice against.
export function baseline(entry, issue, at, postedAt = null) {
  return {
    channel: "issue", id: entry.server.id, repo: entry.repo, also: entry.also.map((x) => x.id),
    at, postedAt, version: entry.server.versionTested, letter: letterOf(entry.server), failing: failingChecks(entry.server),
    number: issue?.number ?? null, url: issue?.url ?? null, badgeAtNotice: issue?.badgeAtNotice ?? null,
  };
}

// ---- the drafts file ----

const SKIP_LABEL = {
  "no-repo": "no GitHub repository", "lookup-failed": "repository lookup failed", "opted-out": "opted out", own: "our own repository",
  failures: "3 failed posts", missing: "repository not found", archived: "archived", fork: "fork", "issues-off": "issues off",
  stale: "stale grade or failed re-test", "no-coverage": "no coverage data", "no-tools": "no tools declared",
  "hygiene-only": "no tool reached (hygiene-only)", launch: "launch line not reproducible as written", "weak-signals": "weak signals only",
  "check-failed": "network check failed", "newer-version": "newer version than tested", monorepo: "package in a subfolder of a larger repository",
  "not-source": "root package is not the one tested", "owner-limit": "one issue per owner per day",
};

export function skipCounts(skipped) {
  const n = {};
  for (const s of skipped) n[s.code] = (n[s.code] ?? 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

// The public drafts file (tracked). Held repositories appear only as a count: naming them would say where a security
// finding is before its maintainer has heard of it.
export function renderDrafts({ drafts, waiting = 0, unchecked = 0, skipped, held = 0, reason, today, max = MAX_ISSUES }) {
  const more = [waiting ? `${waiting} more eligible ${waiting === 1 ? "repository waits" : "repositories wait"} for later runs` : "", unchecked ? `${unchecked} more not checked this run` : ""].filter(Boolean).join("; ");
  const parts = [
    `# Owner issues: drafts`,
    `Written by \`fleet/notify-owners.mjs\` on ${today}. Not filed: ${reason}. These are the issues the next live run would open (at most ${max} per run)${more ? `; ${more}` : ""}. A run started by hand with \`file_owner_issues\` posts only the entries below, and only when the issue still renders byte for byte as shown here.`,
  ];
  if (held) parts.push(`${held} ${held === 1 ? "repository is" : "repositories are"} held for private handling under the [disclosure policy](${ORIGIN}/disclosure/) and not listed here.`);
  if (skipped.length) parts.push(`Skipped ${skipped.length}: ${skipCounts(skipped).map(([code, k]) => `${k} ${SKIP_LABEL[code] ?? code}`).join(", ")}.`);
  for (const d of drafts) parts.push(`---\n\n## ${d.repo}\n\n**Title:** ${d.title}\n\n${d.body}`);
  if (!drafts.length) parts.push(`No repository is due an issue.`);
  if (skipped.length) parts.push(`---\n\n## Skipped\n\n${skipped.map((s) => `- \`${s.id}\`${s.repo ? ` (${s.repo})` : ""}: ${s.reason}`).join("\n")}`);
  return parts.join("\n\n") + "\n";
}

// The "## owner/repo" entries of a drafts file: lowercased repo -> {repo, title, body}, the body exactly as drafted.
export function parseDrafts(text) {
  const out = new Map();
  for (const chunk of String(text ?? "").replace(/\r\n/g, "\n").split("\n\n---\n\n")) {
    const m = chunk.match(/^## ([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\n\n\*\*Title:\*\* (.*)\n\n([\s\S]*)$/);
    if (m) out.set(m[1].toLowerCase(), { repo: m[1], title: m[2], body: m[3].replace(/\n+$/, "") });
  }
  return out;
}

// ---- the private queue: security findings, reported privately first, never sent by this script ----

const rerun = (x) => `npx -y sealmark@${x.sealmark?.version ?? "latest"} run --start ${JSON.stringify(x.launch)}`;

// One queue entry per held repository (or server, when no repository is known).
//   pvr: true / false / null (unknown) for GitHub private vulnerability reporting on the repo
export function privateEntry({ repo, servers }, { today, pvr = null } = {}) {
  return {
    repo,
    status: "not sent",
    channel: !repo ? `no GitHub repository known: look for a security contact on the package page (npm or PyPI); if none, record that and wait`
      : pvr === true ? `GitHub private vulnerability reporting: https://github.com/${repo}/security/advisories/new`
      : pvr === false ? `private vulnerability reporting is off: look for SECURITY.md or a listed security contact; if none, record that and wait`
      : `unknown: check https://github.com/${repo}/security for private vulnerability reporting or SECURITY.md`,
    servers: servers.map((x) => ({
      id: x.id, name: x.name, version: x.versionTested, testedAt: x.testedAt, letter: letterOf(x),
      fresh: !staleReason(x, today), stale: staleReason(x, today),
      rerun: rerun(x), results: `${ORIGIN}/results/${encodeURIComponent(x.id)}/`,
      security: securityFindings(x).map((c) => ({ id: c.id, label: c.label, verdict: c.verdict, summary: c.summary })),
      otherFailing: failingChecks(x).filter((id) => !isSecurityCheck((x.checks ?? []).find((c) => c.id === id))),
    })),
  };
}

export function renderPrivate({ entries, today }) {
  const parts = [
    `# Owner notices held for private handling`,
    `PRIVATE. Written by \`fleet/notify-owners.mjs\` on ${today}; gitignored, never committed, never sent. Each repository below has a failing (or partly failing) check that is not on the public allowlist, so it gets no public issue. Under the disclosure policy a person reports it privately: a GitHub Security Advisory draft (private vulnerability reporting) on the repository, else a private contact; a 14-day reply window with one reminder; publication at a fix or at day 90. Re-test first where the grade is not fresh.`,
    `Checks a public issue may name (everything else holds): ${Object.keys(PUBLIC).sort().map((id) => `\`${id}\``).join(", ")} (fleet/security-checks.mjs).`,
  ];
  if (!entries.length) parts.push(`No repository is held.`);
  for (const e of entries) {
    const lines = [`---\n\n## ${e.repo ?? `${e.servers[0]?.id} (no GitHub repository known)`}`, `**Channel:** ${e.channel}`];
    for (const x of e.servers) {
      const sec = x.security.map((c) => `- \`${c.id}\` ${c.label} (${c.verdict}): ${c.summary}`).join("\n") || "- none on this server";
      lines.push(`### ${x.name} ${x.version}: ${x.letter ?? "not graded"}, tested ${x.testedAt}${x.fresh ? "" : ` (NOT FRESH: ${x.stale})`}`,
        `**Draft advisory title:** ${x.security.length ? `${x.security.map((c) => c.label).join("; ")} in ${x.name} ${x.version}` : "(covered by the advisory above)"}`,
        `Security findings:\n\n${sec}`,
        `Other failing checks (in the same private report, not posted publicly): ${x.otherFailing.length ? x.otherFailing.map((id) => `\`${id}\``).join(", ") : "none"}`,
        `Reproduce: \`${x.rerun}\``, `Results page: ${x.results}`);
    }
    parts.push(lines.join("\n\n"));
  }
  return parts.join("\n\n") + "\n";
}

// ---- replies ----

// Text a person wrote, without quoted lines, code and text in quotation marks (a quote of the issue is not a request).
export function ownWords(text) {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .split(/\r?\n/).filter((l) => !/^\s*>/.test(l)).join("\n")
    .replace(/"[^"\n]*"|“[^”\n]*”/g, " ");
}

// A reply that asks not to hear from Sealmark again: "opt out" (or "opt us out") said as a request, not asked as a
// question, negated or quoted ("should I opt out?", "> reply "opt out" if ...", "no need to opt out").
export function isOptOut(text) {
  for (const s of ownWords(text).split(/(?<=[.!?])\s+|\n+/)) {
    const m = s.match(/\bopt(?:[\s-]?out|\s+(?:us|me|this|it)\s+out)\b/i);
    if (!m) continue;
    if (/\?\s*$/.test(s)) continue;
    if (/\b(should|could|can|would|how|what|why|whether|if|do i|does|need to|not|don't|dont|do not|no need|never)\b/i.test(s.slice(0, m.index))) continue;
    return true;
  }
  return false;
}

// "removal" (take the server off sealmark.dev, or stop), "recheck" (the result looks wrong), else "reply".
export function replyKind(text) {
  const t = ownWords(text);
  if (isOptOut(text) || /\b(remove|removal|take (?:it|this|us|me|the server|our server) (?:down|off)|take down|delete|unlist|delist)\b/i.test(t)) return "removal";
  if (/\b(re-?check|re-?test|re-?run|wrong|incorrect|inaccurate|false positive|mistaken?|not right|not true)\b/i.test(t)) return "recheck";
  return "reply";
}

const isBot = (user, author) => !user || user.type === "Bot" || /\[bot\]$/i.test(user.login ?? "") || (author && String(user.login).toLowerCase() === String(author).toLowerCase());

// Markdown list of replies, removal and recheck requests first.
export function renderReplies(replies, { heading = "##" } = {}) {
  const line = (r) => `- ${r.at?.slice(0, 10) ?? "?"}${r.kind !== "reply" ? ` **${r.kind}**` : ""}: @${r.user} on ${r.repo}#${r.number}: ${r.url}`;
  const byNew = [...replies].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const flagged = byNew.filter((r) => r.kind !== "reply");
  const other = byNew.filter((r) => r.kind === "reply");
  const parts = [];
  parts.push(`${heading} Removal or recheck requests\n\n${flagged.length ? flagged.map(line).join("\n") : "None."}`);
  parts.push(`${heading} Other replies\n\n${other.length ? other.map(line).join("\n") : "None."}`);
  return parts.join("\n\n");
}

export function trackingBody(replies, today) {
  return [
    `Updated by \`fleet/notify-owners.mjs\` on ${today}. Every reply from a person on an issue the Sealmark bot opened, newest first. Removal and recheck requests come first: answer those by hand (recheck and correct the page, or take the server off sealmark.dev).`,
    renderReplies(replies),
  ].join("\n\n") + "\n";
}

// ---- the weekly summary ----

// The Monday (UTC) of the week `day` falls in, YYYY-MM-DD.
export function weekStart(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// Counts for the last 7 days and all time: issues sent, opt-outs, replies, and where each notified server's letter
// stands now against the letter in the notice; then the replies of the last 7 days. Pure.
export function weeklySummary({ ledger, optout, servers, today }) {
  const since = new Date(Date.parse(today) - 6 * 864e5).toISOString().slice(0, 10);
  const recent = (d) => Boolean(d) && d.slice(0, 10) >= since && d.slice(0, 10) <= today;
  const issues = ledger.issues ?? [];
  const emails = ledger.emails ?? [];
  const replies = ledger.replies ?? [];
  const optAt = optout.at ?? {};
  const byId = new Map(servers.map((s) => [s.id, s]));
  const moves = { up: 0, down: 0, same: 0, ungraded: 0 };
  for (const i of issues) {
    const now = byId.get(i.id) ? letterOf(byId.get(i.id)) : null;
    if (!now || !i.letter) moves.ungraded += 1;
    else if (now === i.letter) moves.same += 1;
    else moves[RANK[now] > RANK[i.letter] ? "up" : "down"] += 1;
  }
  const row = (label, week, all) => `| ${label} | ${week} | ${all} |`;
  return [
    `# Owner notices: week of ${weekStart(today)}`,
    `Written by \`fleet/notify-owners.mjs\` on ${today}. "Last 7 days" is ${since} to ${today}.`,
    [
      `| | Last 7 days | All time |\n|---|---|---|`,
      row("Issues opened", issues.filter((i) => recent(i.at)).length, issues.length),
      row("Repositories that replied", issues.filter((i) => recent(i.repliedAt)).length, issues.filter((i) => i.repliedAt).length),
      row("Replies from people", replies.filter((r) => recent(r.at)).length, replies.length),
      row("Removal or recheck requests", replies.filter((r) => r.kind !== "reply" && recent(r.at)).length, replies.filter((r) => r.kind !== "reply").length),
      row("Opted out", Object.values(optAt).filter(recent).length, (optout.repos ?? []).length),
      row("Grade-change emails (notices)", emails.filter((e) => recent(e.at)).length, emails.length),
    ].join("\n"),
    `Notified servers, letter now against the letter in the notice: ${moves.up} up, ${moves.down} down, ${moves.same} same, ${moves.ungraded} not graded now. A better letter alone is not proof the notice caused it; fleet/impact-summary.md compares with servers never notified.`,
    `## Replies in the last 7 days\n\nAll of them are also in the "${TRACKING_TITLE}" issue of this repository.`,
    renderReplies(replies.filter((r) => recent(r.at)), { heading: "###" }),
  ].join("\n\n") + "\n";
}

// ---- posting ----

// What a failed `gh` call means: {status, perRepo}. Per repository: 404, 410, 422, issues off, archived. Everything
// else (401, 403, 429, a rate limit, a network error, gh missing, anything unknown) stops the posting loop.
export function classifyGhError(err) {
  const text = `${err?.stderr ?? ""} ${err?.message ?? ""}`;
  if (err?.code === "ENOENT") return { status: "gh-missing", perRepo: false };
  const code = Number(text.match(/HTTP (\d{3})/)?.[1] ?? NaN);
  if (code === 429 || /secondary rate limit|rate limit|abuse detection/i.test(text)) return { status: code === 429 ? "429" : "rate-limited", perRepo: false };
  if (code === 403 || code === 401 || /bad credentials/i.test(text)) return { status: String(code || 401), perRepo: false };
  if ([404, 410, 422].includes(code)) return { status: String(code), perRepo: true };
  if (/could not resolve to a repository|has disabled issues|issues are disabled|is archived|was archived/i.test(text)) return { status: "repo", perRepo: true };
  return { status: Number.isFinite(code) ? String(code) : "error", perRepo: false };
}

// {repo, failed, status, at} per repository; `failed` counts only per-repository errors.
export function recordFailure(ledger, repo, { status, perRepo }, at) {
  ledger.failures ??= [];
  const prev = ledger.failures.find((f) => f.repo.toLowerCase() === repo.toLowerCase());
  const rec = { repo, failed: (prev?.failed ?? 0) + (perRepo ? 1 : 0), status, at };
  if (prev) Object.assign(prev, rec); else ledger.failures.push(rec);
  return rec;
}

// Posts the ready entries. Never throws for a `gh` error: per-repository errors are recorded and skipped, any other
// stops the loop. approved: Map from parseDrafts (a hand-approved batch) or null.
export async function postIssues({ ready, ledger, me, gh, sleep, now, today, log, save, approved = null }) {
  const out = { opened: 0, recorded: 0, skipped: [], stopped: null };
  for (const e of ready) {
    const d = draftFor(e);
    if (approved) {
      const a = approved.get(e.repo.toLowerCase());
      const why = !a ? "not in the approved draft" : a.title !== d.title ? "the title changed since the draft was approved" : a.body !== d.body ? "the issue no longer renders byte for byte as in the approved draft (a re-test or new data since)" : null;
      if (why) { out.skipped.push({ repo: e.repo, reason: why }); log(`not posted: ${e.repo}: ${why}`); continue; }
    }
    try {
      const mine = JSON.parse(gh(["issue", "list", "-R", e.repo, "--author", me, "--state", "all", "--limit", "50", "--json", "number,url,body"]));
      const dupe = mine.find((i) => i.body?.includes(ISSUE_MARKER("").slice(0, -4)));
      let issue = dupe ? { number: dupe.number, url: dupe.url } : null;
      if (!issue) {
        if (out.opened > 0) await sleep(PACE_MS);
        let readme = "";
        try { readme = gh(["api", `repos/${e.repo}/readme`, "-H", "Accept: application/vnd.github.raw"]); } catch {}
        const url = gh(["issue", "create", "-R", e.repo, "--title", d.title.slice(0, 120), "--body-file", "-"], d.body).trim();
        issue = { number: Number(url.split("/").pop()), url, badgeAtNotice: /sealmark\.dev\/badge\//i.test(readme) };
        out.opened += 1;
      }
      ledger.issues.push({ ...baseline(e, issue, today, now().toISOString()), author: me });
      ledger.failures = (ledger.failures ?? []).filter((f) => f.repo.toLowerCase() !== e.repo.toLowerCase());
      out.recorded += 1;
      save();
    } catch (err) {
      const c = classifyGhError(err);
      const rec = recordFailure(ledger, e.repo, c, now().toISOString());
      save();
      log(`::warning::owner issue for ${e.repo} failed (${c.status}${c.perRepo ? `, failure ${rec.failed} of ${MAX_REPO_FAILURES}` : ""})`);
      if (!c.perRepo) { out.stopped = c.status; log(`::warning::stopped posting owner issues: ${c.status} is not specific to one repository`); break; }
    }
  }
  return out;
}

// ---- the gate ----

export function gate(env, argv) {
  const token = env.OWNER_ISSUES_TOKEN ?? "";
  const dry = argv.includes("--dry");
  const live = Boolean(token) && env.OWNER_ISSUES_LIVE === "1" && !dry;
  const reason = live ? "" : dry ? "--dry" : !token ? "the OWNER_ISSUES_TOKEN secret (the bot account's token) is not set" : `the OWNER_ISSUES_LIVE variable is not "1"`;
  return { token, dry, live, approved: live && env.OWNER_ISSUES_APPROVED === "1", reason };
}

// ---- main ----

const realIo = {
  read: (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null),
  write: (f, s) => fs.writeFileSync(f, s),
  append: (f, s) => fs.appendFileSync(f, s),
  remove: (f) => { if (fs.existsSync(f)) fs.rmSync(f); },
};
const realGh = (env) => (args, input) => execFileSync("gh", args, { encoding: "utf8", input, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });

// Reads a package manifest from the root of a repository: {name, version, monorepo} or {missing: true}.
async function rootManifest(api, repo, kind) {
  const raw = (path) => api(`/repos/${repo}/contents/${path}`, { raw: true });
  if (kind === "npm") {
    const t = await raw("package.json");
    if (t?.missing) return { missing: true };
    const j = JSON.parse(t);
    return { name: j.name ?? null, version: j.version ?? null, monorepo: Boolean(j.workspaces) };
  }
  const py = await raw("pyproject.toml");
  if (!py?.missing) {
    const section = (name) => { const m = py.match(new RegExp(`^\\[${name.replace(/\./g, "\\.")}\\]\\s*$([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, "m")); return m?.[1] ?? ""; };
    const field = (s, k) => s.match(new RegExp(`^\\s*${k}\\s*=\\s*["']([^"']+)["']`, "m"))?.[1] ?? null;
    const proj = section("project");
    const poetry = section("tool.poetry");
    const name = field(proj, "name") ?? field(poetry, "name");
    if (name) return { name, version: field(proj, "version") ?? field(poetry, "version"), monorepo: /^\[tool\.uv\.workspace\]/m.test(py) };
  }
  const cfg = await raw("setup.cfg");
  if (!cfg?.missing) { const name = cfg.match(/^\s*name\s*=\s*(\S+)/m)?.[1]; if (name) return { name, version: null, monorepo: false }; }
  const setup = await raw("setup.py");
  if (!setup?.missing) { const name = setup.match(/\bname\s*=\s*["']([^"']+)["']/)?.[1]; if (name) return { name, version: null, monorepo: false }; }
  return { missing: true };
}

const manifestKind = (x) => (x.ecosystem === "npm" || (x.ecosystem === "github" && /^npx\b/.test(String(x.launch).trim())) ? "npm" : "py");

// Network facts for one server whose repository is `repo`: the latest version and folder from npm / PyPI / GitHub
// releases, and the root manifest. Never throws: {error} instead.
async function serverFacts(x, repo, { fetchFn, api, roots }) {
  try {
    const out = { latest: null, directory: "", root: null };
    if (x.ecosystem === "npm") {
      const j = await getJson(fetchFn, npmLatestUrl(x.name));
      out.latest = j.version ?? null;
      out.directory = (typeof j.repository === "object" && j.repository?.directory) || dirFromUrl(npmRepoUrl(j));
    } else if (x.ecosystem === "pypi") {
      const j = await getJson(fetchFn, pypiUrl(x.name));
      out.latest = j.info?.version ?? null;
      out.directory = dirFromUrl(pypiRepoUrl(j));
    } else if (x.ecosystem === "github") {
      const rel = await api(`/repos/${repo}/releases/latest`);
      let tag = rel?.missing ? null : rel?.tag_name;
      if (!tag) { const tags = await api(`/repos/${repo}/tags?per_page=1`); tag = Array.isArray(tags) ? tags[0]?.name : null; }
      out.latest = tag ? String(tag).replace(/^v/i, "") : null;
      out.directory = String(x.launch).match(/[#&]subdirectory=([^\s&]+)/)?.[1] ?? "";
    } else {
      return { error: `unknown ecosystem ${x.ecosystem}` };
    }
    const key = `${repo.toLowerCase()}|${manifestKind(x)}`;
    if (!roots.has(key)) roots.set(key, rootManifest(api, repo, manifestKind(x)));
    out.root = await roots.get(key);
    if (x.ecosystem === "github" && !out.latest) out.latest = out.root?.version ?? null;
    return out;
  } catch (e) {
    return { error: String(e.message ?? e).slice(0, 120) };
  }
}

export async function main({ env = process.env, argv = process.argv, io = realIo, fetchFn = fetch, gh = null, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => new Date(), log = console.log } = {}) {
  const readJson = (f, fallback) => { const t = io.read(f); return t == null ? fallback : JSON.parse(t); };
  const writeJson = (f, v) => io.write(f, JSON.stringify(v, null, 2) + "\n");
  const today = now().toISOString().slice(0, 10);
  const g = gate(env, argv);
  let { live, reason } = g;
  const max = maxIssues(env.MAX_OWNER_ISSUES);
  const result = { live: false, opened: 0, error: null };
  const committedDraft = io.read(FILES.draft); // read before anything rewrites it: a hand-approved run posts exactly this

  // 0. the token: GET /user in every mode. A rejected token falls back to GITHUB_TOKEN for reads and posts nothing.
  let readToken = env.GH_TOKEN || env.GITHUB_TOKEN || "";
  let me = null;
  if (g.token) {
    try {
      const res = await fetchFn("https://api.github.com/user", { headers: { accept: "application/vnd.github+json", "user-agent": "sealmark-fleet", authorization: `Bearer ${g.token}` } });
      if (res.status === 401) { log(`::warning::OWNER_ISSUES_TOKEN was rejected (401); read-only lookups use GITHUB_TOKEN and nothing is posted`); if (live) reason = "the OWNER_ISSUES_TOKEN secret was rejected (401)"; live = false; }
      else if (!res.ok) { log(`::warning::could not check OWNER_ISSUES_TOKEN (${res.status}); read-only lookups use GITHUB_TOKEN and nothing is posted`); if (live) reason = `the OWNER_ISSUES_TOKEN check failed (${res.status})`; live = false; }
      else {
        me = (await res.json()).login;
        if (SELF.includes(String(me).toLowerCase())) {
          log(`::error::OWNER_ISSUES_TOKEN belongs to ${me}: owner issues are posted by the bot account only; nothing is posted`);
          if (live) reason = `the token belongs to ${me}, not the bot account`;
          live = false;
          result.error = "self";
        } else readToken = g.token;
      }
    } catch (e) { log(`::warning::could not check OWNER_ISSUES_TOKEN (${e.message}); nothing is posted`); if (live) reason = "the OWNER_ISSUES_TOKEN check failed"; live = false; }
  }
  const api = async (path, { raw = false, method = "GET", body, token = readToken } = {}) => {
    const res = await fetchFn(`https://api.github.com${path}`, {
      method,
      headers: { accept: raw ? "application/vnd.github.raw" : "application/vnd.github+json", "user-agent": "sealmark-fleet", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 404 && method === "GET") return { missing: true };
    if (!res.ok) { const e = new Error(`GitHub ${method} ${path}: ${res.status}`); e.status = res.status; throw e; }
    return raw ? res.text() : res.json();
  };

  const servers = readJson(FILES.results, { servers: [] }).servers;
  const cache = readJson(FILES.repos, {});
  const ledger = readJson(FILES.ledger, { issues: [], emails: [] });
  ledger.issues ??= [];
  const optout = readJson(FILES.optout, { repos: [] });
  optout.repos ??= [];

  // 1. resolve repositories (cached; misses retried after RESOLVE_AGAIN_DAYS)
  let looked = 0;
  for (const s of servers) {
    const c = cache[s.id];
    const stale = c && !c.repo && (Date.parse(today) - Date.parse(c.resolvedAt)) / 864e5 > RESOLVE_AGAIN_DAYS;
    if (c && !stale) continue;
    try { cache[s.id] = { ...(await resolveRepo(s, fetchFn)), resolvedAt: today }; }
    catch (e) { log(`repo lookup failed for ${s.id}: ${e.message}`); continue; }
    looked += 1;
    await sleep(150);
  }
  const saveCache = () => writeJson(FILES.repos, Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b))));
  saveCache();
  log(`repos: ${looked} looked up, ${Object.values(cache).filter((c) => c.repo).length} of ${Object.keys(cache).length} on GitHub`);

  // 2. replies on the issues the bot opened: recorded, opt-outs honoured, listed for Jordan
  ledger.replies ??= [];
  const seen = new Set(ledger.replies.map((r) => String(r.id)));
  const fresh = [];
  for (const i of ledger.issues) {
    if (!i.number) continue;
    try {
      const comments = await api(`/repos/${i.repo}/issues/${i.number}/comments?per_page=100`);
      const people = Array.isArray(comments) ? comments.filter((c) => !isBot(c.user, i.author)) : [];
      if (people.length && !i.repliedAt) i.repliedAt = people[0].created_at?.slice(0, 10) ?? today;
      for (const c of people) {
        if (seen.has(String(c.id))) continue;
        const r = { id: c.id, repo: i.repo, number: i.number, url: c.html_url, user: c.user?.login ?? "?", at: c.created_at ?? today, kind: replyKind(c.body) };
        ledger.replies.push(r); seen.add(String(c.id)); fresh.push(r);
        if (isOptOut(c.body) && !optout.repos.some((x) => x.toLowerCase() === i.repo.toLowerCase())) { optout.repos.push(i.repo); (optout.at ??= {})[i.repo] = today; log(`opt-out recorded: ${i.repo} (${c.html_url})`); }
      }
    } catch (e) { log(`reply check failed for ${i.repo}: ${e.message}`); }
  }
  writeJson(FILES.optout, optout);
  writeJson(FILES.ledger, ledger);

  // the tracking issue in this repository, with the workflow's own token (never the bot's), only on Actions
  if (fresh.length || (ledger.replies.length && !ledger.tracking?.number)) {
    if (env.GITHUB_ACTIONS === "true" && env.GITHUB_REPOSITORY === TRACKING_REPO && env.GITHUB_TOKEN && !g.dry) {
      try {
        const own = { token: env.GITHUB_TOKEN };
        if (!ledger.tracking?.number) {
          const list = await api(`/repos/${TRACKING_REPO}/issues?state=all&per_page=100`, own);
          const found = Array.isArray(list) ? list.find((x) => x.title === TRACKING_TITLE && !x.pull_request) : null;
          if (found) ledger.tracking = { number: found.number, url: found.html_url };
        }
        const body = trackingBody(ledger.replies, today);
        if (ledger.tracking?.number) await api(`/repos/${TRACKING_REPO}/issues/${ledger.tracking.number}`, { ...own, method: "PATCH", body: { body, state: "open" } });
        else { const made = await api(`/repos/${TRACKING_REPO}/issues`, { ...own, method: "POST", body: { title: TRACKING_TITLE, body } }); ledger.tracking = { number: made.number, url: made.html_url }; }
        writeJson(FILES.ledger, ledger);
        log(`tracking issue updated: ${ledger.tracking.url}`);
      } catch (e) { log(`::warning::could not update the "${TRACKING_TITLE}" issue: ${e.message}`); }
    } else log(`tracking issue not updated (only from the fleet workflow on ${TRACKING_REPO})`);
  }

  // the weekly summary: rewritten when a new week starts or a reply came in; the step summary gets it every run
  const week = weeklySummary({ ledger, optout, servers, today });
  const prev = io.read(FILES.weekly) ?? "";
  if (!prev.includes(`week of ${weekStart(today)}`) || fresh.length) io.write(FILES.weekly, week);
  if (env.GITHUB_STEP_SUMMARY) {
    const news = fresh.length ? `\n## New replies this run\n\n${renderReplies(fresh, { heading: "###" })}\n` : "";
    io.append(env.GITHUB_STEP_SUMMARY, `${news}\n${week}\n`);
  }
  if (fresh.length) log(`new replies: ${fresh.length} (${fresh.filter((r) => r.kind !== "reply").length} removal or recheck requests)`);

  // 3. plan, checking candidates over the network until `max` are eligible (or the lookup budget is spent)
  const approved = g.approved && live ? parseDrafts(committedDraft) : null;
  if (approved && !approved.size) log(`hand-approved run, but the committed ${FILES.draft} lists no issue: nothing to post`);
  const only = approved ? new Set(approved.keys()) : null;
  const meta = {};
  const facts = {};
  const roots = new Map();
  const nowMs = now().getTime();
  const args = () => ({ servers, cache, ledger, optout, meta, facts, max, today, now: nowMs, only });
  let p = plan(args());
  let budget = lookupBudget(max);
  while (p.eligible < max && p.unchecked.length && budget > 0) {
    for (const u of p.unchecked.slice(0, Math.max(1, Math.min(budget, max - p.eligible)))) {
      budget -= 1;
      let m;
      try { m = await api(`/repos/${u.repo}`); } catch (e) { m = { error: String(e.status ?? e.message) }; }
      let repo = u.repo;
      if (m.full_name && m.full_name.toLowerCase() !== repo.toLowerCase()) {
        for (const c of Object.values(cache)) if (c.repo === u.repo) { c.movedFrom = u.repo; c.repo = m.full_name; }
        log(`repository moved: ${u.repo} -> ${m.full_name}`);
        repo = m.full_name;
      }
      meta[repo] = m;
      for (const x of u.servers) facts[x.id] = m.missing || m.error ? { error: m.missing ? "repository not found" : `repository check: ${m.error}` } : await serverFacts(x, repo, { fetchFn, api, roots });
    }
    p = plan(args());
  }
  saveCache(); // canonical names of moved repositories
  const { send, waiting, skipped, held, unchecked } = p;

  // held repositories: archived / fork, and whether private vulnerability reporting is on. Never logged by name (the
  // Actions log of this public repository would say where a security finding is).
  const pvr = {};
  for (const h of held) {
    if (!h.repo) continue;
    try { const r = await api(`/repos/${h.repo}/private-vulnerability-reporting`); pvr[h.repo] = r.missing ? null : r.enabled === true; } catch { pvr[h.repo] = null; }
  }
  const entries = held.map((h) => privateEntry(h, { today, pvr: h.repo ? pvr[h.repo] ?? null : null }));
  writeJson(FILES.privateQueue, { generated: today, note: "PRIVATE: security findings held from public owner issues; report by hand under the disclosure policy", entries });
  io.write(FILES.privateDraft, renderPrivate({ entries, today }));
  log(`held for private handling: ${held.length} (not named here; see ${FILES.privateDraft} in a local run)`);
  const counts = skipCounts(skipped).map(([c, n]) => `${c} ${n}`).join(", ");

  if (!live) {
    io.write(FILES.draft, renderDrafts({ drafts: send.map(draftFor), waiting, unchecked: unchecked.length, skipped, held: held.length, reason, today, max }));
    log(`not live (${reason}): ${send.length} drafts in ${FILES.draft}; ${waiting} more eligible wait; ${unchecked.length} not checked; skipped ${skipped.length} (${counts}); cap ${max} per run`);
    return { ...result, drafts: send.length, waiting, unchecked: unchecked.length, skipped, held: held.length };
  }

  // 4. live: one issue per repository, deduped by the hidden marker in case a ledger commit was lost
  result.live = true;
  const post = await postIssues({
    ready: send, ledger, me, gh: gh ?? realGh({ GH_TOKEN: g.token }), sleep, now, today, log, approved,
    save: () => writeJson(FILES.ledger, ledger),
  });
  io.remove(FILES.draft);
  log(`owner issues opened: ${post.opened} (cap ${max})${post.stopped ? `; stopped on ${post.stopped}` : ""}; ${post.skipped.length} not posted; ${waiting} wait for later runs; skipped ${skipped.length} (${counts}); ${held.length} held for private handling`);
  return { ...result, ...post, waiting, held: held.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const r = await main();
    if (r.error) process.exitCode = 1;
  } catch (e) {
    // the notify step may fail without stopping the fleet run (continue-on-error in fleet.yml); say why plainly
    console.log(`::warning::notify-owners stopped: ${e.message}`);
    process.exitCode = 1;
  }
}
