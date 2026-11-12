// Tells MCP server owners their Sealmark grade: one GitHub issue per repository, opened on the first grade, never
// again (reply "opt out" and that repository is skipped forever). Runs in fleet.yml after merge.mjs.
//
//   node fleet/notify-owners.mjs            draft or file, depending on the gate below
//   node fleet/notify-owners.mjs --dry      never files; writes the drafts file even when the gate is open
//
// Gate: issues are opened only when the OWNER_ISSUES_TOKEN secret is set AND OWNER_ISSUES_LIVE is "1" (the repository
// variable, or one hand-approved batch: the fleet workflow's "file_owner_issues" input). Otherwise the next issues are
// written to fleet/owner-issues-draft.md for review. Per run at most MAX_OWNER_ISSUES issues (default 2; 8 later).
// Sender: the Sealmark bot GitHub account; its token (classic, public_repo scope: a fine-grained token cannot open
// issues on repositories the account does not belong to) is OWNER_ISSUES_TOKEN. The
// script posts as whoever the token belongs to and refuses an account in SELF (never Jordan's personal account).
//
// Every run also writes fleet/owner-weekly.md (sent, opted out, replied, grade changes since the notice) once a week,
// and prints it to the Actions step summary each run.
//
// Who gets a public issue, in order (plan() below):
//   - skipped for good: no GitHub repo, already notified, opted out, our own repo, repo missing, archived, fork;
//   - HELD for private handling: any graded server of the repo fails (or partly fails) a security check
//     (fleet/security-checks.mjs). The whole repository is held, its other failures too: the disclosure policy
//     reports security findings privately first (a GitHub Security Advisory), never in a public issue. Held repos
//     go to fleet/owner-private-queue.json and fleet/owner-private-draft.md, which are gitignored, never committed
//     and never sent by this script; the public draft and the log give only their count;
//   - skipped, issues off (only the public issue needs them);
//   - waiting for a fresh grade: a server whose grade is older than FRESH_DAYS or whose latest re-test failed is
//     left out; a repository with no fresh server waits for the next good re-test.
//
// Files (tracked, committed by the collect job):
//   fleet/owner-repos.json      server id -> GitHub repo (or null), resolved from the launch line or npm/PyPI metadata
//   fleet/owner-notified.json   the notice ledger: every issue opened, with the baseline fleet/impact.mjs measures from
//   fleet/owner-optout.json     repositories that asked not to hear from Sealmark; honoured forever, never pruned
//   fleet/owner-issues-draft.md the issues the next live run would open (rewritten each run while the gate is shut)
// Not tracked (.gitignore): fleet/owner-private-queue.json and fleet/owner-private-draft.md, rewritten every run.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ISSUE_MARKER, ORIGIN, RANK, failingChecks, issueDraft, letterOf } from "../web/worker/notify-core.mjs";
import { failedSince } from "../web/lib/retest.mjs";
import { SECURITY_CHECKS, isSecurityCheck, securityFindings } from "./security-checks.mjs";

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
// Issues per run: MAX_OWNER_ISSUES when it is a whole number of at least 1, else 2. Raise the repository variable to 8
// once the first live runs read well.
export const DEFAULT_MAX_ISSUES = 2;
export function maxIssues(value) {
  const n = Number(String(value ?? "").trim() || NaN);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_MAX_ISSUES;
}
export const MAX_ISSUES = maxIssues(process.env.MAX_OWNER_ISSUES);
export const FRESH_DAYS = 14; // a grade older than this waits for a re-test before its owner is told
export const SELF = ["jordanallenlewis"]; // never notify our own repositories
const RESOLVE_AGAIN_DAYS = 30; // a server with no repo found is looked up again after this long

// owner/repo from any GitHub URL or npm-style shorthand; null when it is not GitHub.
export function parseRepo(text) {
  if (!text) return null;
  const s = String(text).trim();
  const m = s.match(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/#?].*)?$/i) ?? s.match(/^(?:github:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:#.*)?$/i);
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
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

export function repoFromNpm(meta) {
  const r = meta?.repository;
  const url = typeof r === "string" ? r : r?.url;
  return parseRepo(url) ?? parseRepo(meta?.homepage) ?? parseRepo(meta?.bugs?.url);
}

export function repoFromPypi(meta) {
  const info = meta?.info ?? {};
  const urls = info.project_urls ?? {};
  const preferred = ["Source", "Source Code", "Repository", "Code", "GitHub", "Homepage", "Home"];
  for (const k of preferred) { const r = parseRepo(urls[k]); if (r) return r; }
  for (const v of Object.values(urls)) { const r = parseRepo(v); if (r) return r; }
  return parseRepo(info.home_page);
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "sealmark-fleet" } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

export async function resolveRepo(server) {
  if (server.ecosystem === "github") return { repo: repoFromLaunch(server.launch) ?? parseRepo(`github:${server.name}`), source: "launch" };
  if (server.ecosystem === "npm") return { repo: repoFromNpm(await getJson(`https://registry.npmjs.org/${server.name.replace("/", "%2F")}/latest`)), source: "npm" };
  if (server.ecosystem === "pypi") return { repo: repoFromPypi(await getJson(`https://pypi.org/pypi/${encodeURIComponent(server.name)}/json`)), source: "pypi" };
  return { repo: null, source: "unknown ecosystem" };
}

// Why a graded server's grade is not fresh enough to tell its owner about, or null when it is.
export function staleReason(server, today) {
  const failed = failedSince(server);
  if (failed) return `latest re-test failed on ${failed.date}; waits for a fresh grade`;
  const days = (Date.parse(today) - Date.parse(server.testedAt)) / 864e5;
  if (!(days <= FRESH_DAYS)) return `grade from ${server.testedAt} is older than ${FRESH_DAYS} days; waits for a fresh grade`;
  return null;
}

// Which graded servers get an issue this run, which repositories are held for a private report, and why the others
// get neither. Pure: callers pass the repo metadata.
//   cache: id -> {repo}; ledger: {issues: [...]}; optout: {repos: [...]}; meta: repo -> GitHub repo object or {missing}
//   today: YYYY-MM-DD, for freshness
export function plan({ servers, cache, ledger, optout, meta = {}, max = MAX_ISSUES, today = new Date().toISOString().slice(0, 10) }) {
  const notified = new Set((ledger.issues ?? []).map((i) => i.repo.toLowerCase()));
  const opted = new Set((optout.repos ?? []).map((r) => r.toLowerCase()));
  const byRepo = new Map();
  const skipped = [];
  for (const server of [...servers].sort((a, b) => a.testedAt.localeCompare(b.testedAt) || a.id.localeCompare(b.id))) {
    if (!letterOf(server)) continue; // not graded: nothing to tell yet
    const repo = cache[server.id]?.repo;
    if (!repo) { skipped.push({ id: server.id, reason: "no GitHub repository found" }); continue; }
    const key = repo.toLowerCase();
    if (!byRepo.has(key)) byRepo.set(key, { repo, servers: [] });
    byRepo.get(key).servers.push(server);
  }
  const send = [];
  const held = [];
  for (const [key, { repo, servers: graded }] of byRepo) {
    const m = meta[repo];
    const why = notified.has(key) ? "already notified"
      : opted.has(key) ? "opted out"
      : SELF.includes(key.split("/")[0]) ? "our own repository"
      : m?.missing ? "repository not found"
      : m?.archived ? "archived"
      : m?.fork ? "fork"
      : null;
    if (why) { if (why !== "already notified") skipped.push({ id: graded[0].id, repo, reason: why }); continue; }
    // A security finding on any of the repo's servers, fresh or not, holds the whole repository: no public issue.
    if (graded.some((x) => securityFindings(x).length)) { held.push({ repo, servers: graded }); continue; }
    if (m && m.has_issues === false) { skipped.push({ id: graded[0].id, repo, reason: "issues disabled" }); continue; }
    const fresh = [];
    for (const x of graded) {
      const stale = staleReason(x, today);
      if (stale) skipped.push({ id: x.id, repo, reason: stale });
      else fresh.push(x);
    }
    if (fresh.length) send.push({ repo, server: fresh[0], also: fresh.slice(1) });
  }
  return { send: send.slice(0, max), waiting: Math.max(0, send.length - max), skipped, held };
}

// The issue for one repository. A repo with several graded servers gets one issue that names the others.
// Refuses a repository with a security finding: plan() holds those, and this is the second lock.
export function draftFor(entry) {
  if ([entry.server, ...entry.also].some((x) => securityFindings(x).length)) throw new Error(`${entry.repo}: security finding, held for a private report; no public issue`);
  const d = issueDraft({ id: entry.server.id, server: entry.server, repo: entry.repo });
  if (entry.also.length) {
    const more = entry.also.map((x) => `- \`${x.name}\` ${x.versionTested}: **${letterOf(x)}**, https://sealmark.dev/results/${encodeURIComponent(x.id)}/`).join("\n");
    const at = d.body.lastIndexOf("\n\nThe fleet re-tests");
    d.body = `${d.body.slice(0, at)}\n\nAlso graded from this repository:\n\n${more}${d.body.slice(at)}`;
  }
  return d;
}

// The baseline fleet/impact.mjs measures this notice against.
export function baseline(entry, issue, at) {
  return {
    channel: "issue", id: entry.server.id, repo: entry.repo, also: entry.also.map((x) => x.id),
    at, version: entry.server.versionTested, letter: letterOf(entry.server), failing: failingChecks(entry.server),
    number: issue?.number ?? null, url: issue?.url ?? null, badgeAtNotice: issue?.badgeAtNotice ?? null,
  };
}

// The public drafts file (tracked). Held repositories appear only as a count: naming them would say where a security
// finding is before its maintainer has heard of it.
export function renderDrafts({ drafts, waiting, skipped, held = 0, reason, today, max = MAX_ISSUES }) {
  const parts = [
    `# Owner issues: drafts`,
    `Written by \`fleet/notify-owners.mjs\` on ${today}. Not filed: ${reason}. These are the issues the next live run would open (at most ${max} per run)${waiting ? `; ${waiting} more repositories wait for later runs` : ""}.`,
  ];
  if (held) parts.push(`${held} ${held === 1 ? "repository is" : "repositories are"} held for private handling under the [disclosure policy](${ORIGIN}/disclosure/) and not listed here.`);
  for (const d of drafts) parts.push(`---\n\n## ${d.repo}\n\n**Title:** ${d.title}\n\n${d.body}`);
  if (!drafts.length) parts.push(`No repository is due an issue.`);
  if (skipped.length) parts.push(`---\n\n## Skipped\n\n${skipped.map((s) => `- \`${s.id}\`${s.repo ? ` (${s.repo})` : ""}: ${s.reason}`).join("\n")}`);
  return parts.join("\n\n") + "\n";
}

// ---- the private queue: security findings, reported privately first, never sent by this script ----

const rerun = (x) => `npx -y sealmark@${x.sealmark?.version ?? "latest"} run --start ${JSON.stringify(x.launch)}`;

// One queue entry per held repository: what a private report would contain and where it would go.
//   pvr: true / false / null (unknown) for GitHub private vulnerability reporting on the repo
export function privateEntry({ repo, servers }, { today, pvr = null } = {}) {
  return {
    repo,
    status: "not sent",
    channel: pvr === true ? `GitHub private vulnerability reporting: https://github.com/${repo}/security/advisories/new`
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
    `PRIVATE. Written by \`fleet/notify-owners.mjs\` on ${today}; gitignored, never committed, never sent. Each repository below has a failing (or partly failing) security check, so it gets no public issue. Under the disclosure policy a person reports it privately: a GitHub Security Advisory draft (private vulnerability reporting) on the repository, else a private contact; a 14-day reply window with one reminder; publication at a fix or at day 90. Re-test first where the grade is not fresh.`,
    `Security checks: ${[...SECURITY_CHECKS].sort().map((id) => `\`${id}\``).join(", ")} (fleet/security-checks.mjs).`,
  ];
  if (!entries.length) parts.push(`No repository is held.`);
  for (const e of entries) {
    const lines = [`---\n\n## ${e.repo}`, `**Channel:** ${e.channel}`];
    for (const x of e.servers) {
      const sec = x.security.map((c) => `- \`${c.id}\` ${c.label} (${c.verdict}): ${c.summary}`).join("\n") || "- none on this server";
      lines.push(`### ${x.name} ${x.version}: ${x.letter}, tested ${x.testedAt}${x.fresh ? "" : ` (NOT FRESH: ${x.stale})`}`,
        `**Draft advisory title:** ${x.security.length ? `${x.security.map((c) => c.label).join("; ")} in ${x.name} ${x.version}` : "(covered by the advisory above)"}`,
        `Security findings:\n\n${sec}`,
        `Other failing checks (in the same private report, not posted publicly): ${x.otherFailing.length ? x.otherFailing.map((id) => `\`${id}\``).join(", ") : "none"}`,
        `Reproduce: \`${x.rerun}\``, `Results page: ${x.results}`);
    }
    parts.push(lines.join("\n\n"));
  }
  return parts.join("\n\n") + "\n";
}

// ---- the weekly summary ----

// The Monday (UTC) of the week `day` falls in, YYYY-MM-DD.
export function weekStart(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// Counts for the last 7 days and all time: issues sent, opt-outs, replies, and where each notified server's letter
// stands now against the letter in the notice. Pure.
export function weeklySummary({ ledger, optout, servers, today }) {
  const since = new Date(Date.parse(today) - 6 * 864e5).toISOString().slice(0, 10);
  const recent = (d) => Boolean(d) && d >= since && d <= today;
  const issues = ledger.issues ?? [];
  const emails = ledger.emails ?? [];
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
      row("Opted out", Object.values(optAt).filter(recent).length, (optout.repos ?? []).length),
      row("Grade-change emails (notices)", emails.filter((e) => recent(e.at)).length, emails.length),
    ].join("\n"),
    `Notified servers, letter now against the letter in the notice: ${moves.up} up, ${moves.down} down, ${moves.same} same, ${moves.ungraded} not graded now. A better letter alone is not proof the notice caused it; fleet/impact-summary.md compares with servers never notified.`,
  ].join("\n\n") + "\n";
}

// "opt out" (any case, with or without the space or hyphen) in a reply that is not Sealmark's own.
export const OPT_OUT = /\bopt[\s-]?out\b/i;

const readJson = (f, fallback) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : fallback);
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n");

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const token = process.env.OWNER_ISSUES_TOKEN ?? "";
  const live = Boolean(token) && process.env.OWNER_ISSUES_LIVE === "1" && !process.argv.includes("--dry");
  const reason = live ? "" : !token ? "the OWNER_ISSUES_TOKEN secret (the bot account's token) is not set" : process.env.OWNER_ISSUES_LIVE !== "1" ? "the OWNER_ISSUES_LIVE variable is not \"1\"" : "--dry";
  const readToken = token || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
  const servers = readJson(FILES.results, { servers: [] }).servers;
  const cache = readJson(FILES.repos, {});
  const ledger = readJson(FILES.ledger, { issues: [], emails: [] });
  const optout = readJson(FILES.optout, { repos: [] });

  // 1. resolve repositories (cached; misses retried after RESOLVE_AGAIN_DAYS)
  let looked = 0;
  for (const s of servers) {
    const c = cache[s.id];
    const stale = c && !c.repo && (Date.parse(today) - Date.parse(c.resolvedAt)) / 864e5 > RESOLVE_AGAIN_DAYS;
    if (c && !stale) continue;
    try { cache[s.id] = { ...(await resolveRepo(s)), resolvedAt: today }; }
    catch (e) { console.log(`repo lookup failed for ${s.id}: ${e.message}`); continue; }
    looked += 1;
    await new Promise((r) => setTimeout(r, 150));
  }
  writeJson(FILES.repos, Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b))));
  console.log(`repos: ${looked} looked up, ${Object.values(cache).filter((c) => c.repo).length} of ${Object.keys(cache).length} on GitHub`);

  // 2. read-only GitHub checks: opt-out replies on issues we opened, then archived / fork / issues-off for candidates
  const api = async (path) => {
    const res = await fetch(`https://api.github.com${path}`, { headers: { accept: "application/vnd.github+json", "user-agent": "sealmark-fleet", ...(readToken ? { authorization: `Bearer ${readToken}` } : {}) } });
    if (res.status === 404) return { missing: true };
    if (!res.ok) throw new Error(`GitHub ${path}: ${res.status}`);
    return res.json();
  };
  for (const i of ledger.issues ?? []) {
    if (!i.number || optout.repos.some((r) => r.toLowerCase() === i.repo.toLowerCase())) continue;
    try {
      const comments = await api(`/repos/${i.repo}/issues/${i.number}/comments?per_page=100`);
      const people = Array.isArray(comments) ? comments.filter((c) => c.user?.type !== "Bot" && c.user?.login !== i.author) : [];
      if (people.length && !i.repliedAt) i.repliedAt = people[0].created_at?.slice(0, 10) ?? today;
      const hit = people.find((c) => OPT_OUT.test(c.body ?? ""));
      if (hit) { optout.repos.push(i.repo); (optout.at ??= {})[i.repo] = today; console.log(`opt-out recorded: ${i.repo} (${hit.html_url})`); }
    } catch (e) { console.log(`opt-out check failed for ${i.repo}: ${e.message}`); }
  }
  writeJson(FILES.optout, optout);
  writeJson(FILES.ledger, ledger); // repliedAt

  // the weekly summary: rewritten when a new week starts; the step summary gets it every run
  const week = weeklySummary({ ledger, optout, servers, today });
  const prev = fs.existsSync(FILES.weekly) ? fs.readFileSync(FILES.weekly, "utf8") : "";
  if (!prev.includes(`week of ${weekStart(today)}`)) fs.writeFileSync(FILES.weekly, week);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${week}\n`);

  const first = plan({ servers, cache, ledger, optout, max: Infinity, today });
  const meta = {};
  for (const e of first.send.slice(0, MAX_ISSUES * 2)) {
    try { meta[e.repo] = await api(`/repos/${e.repo}`); } catch (err) { console.log(`repo check failed for ${e.repo}: ${err.message}`); }
  }
  // held repositories: archived / fork, and whether private vulnerability reporting is on. Never logged by name (the
  // Actions log of this public repository would say where a security finding is).
  const pvr = {};
  for (const e of first.held) {
    try { meta[e.repo] = await api(`/repos/${e.repo}`); } catch { console.log(`repo check failed for a held repository`); }
    try { const r = await api(`/repos/${e.repo}/private-vulnerability-reporting`); pvr[e.repo] = r.missing ? null : r.enabled === true; } catch { pvr[e.repo] = null; }
  }
  const { send, waiting, skipped, held } = plan({ servers, cache, ledger, optout, meta, max: MAX_ISSUES, today });
  // only candidates whose repo was checked go out live: an unchecked one may be archived or have issues off
  const ready = send.filter((e) => meta[e.repo] && !meta[e.repo].missing);

  // the private queue: rewritten every run, gitignored, never sent from here
  const entries = held.map((h) => privateEntry(h, { today, pvr: pvr[h.repo] ?? null }));
  writeJson(FILES.privateQueue, { generated: today, note: "PRIVATE: security findings held from public owner issues; report by hand under the disclosure policy", entries });
  fs.writeFileSync(FILES.privateDraft, renderPrivate({ entries, today }));
  console.log(`held for private handling: ${held.length} repositories (not named here; see ${FILES.privateDraft} in a local run)`);

  if (!live) {
    fs.writeFileSync(FILES.draft, renderDrafts({ drafts: ready.map(draftFor), waiting: waiting + send.length - ready.length, skipped, held: held.length, reason, today }));
    console.log(`not live (${reason}): ${ready.length} drafts in ${FILES.draft}, ${skipped.length} skipped, cap ${MAX_ISSUES} per run`);
    return;
  }

  // 3. live: one issue per repository, deduped by the hidden marker in case a ledger commit was lost
  const env = { ...process.env, GH_TOKEN: token };
  const gh = (args, input) => execFileSync("gh", args, { encoding: "utf8", input, env });
  const me = JSON.parse(gh(["api", "user"])).login;
  if (SELF.includes(me.toLowerCase())) throw new Error(`OWNER_ISSUES_TOKEN belongs to ${me}: owner issues are posted by the bot account only`);
  let opened = 0;
  for (const e of ready) {
    const d = draftFor(e);
    const mine = JSON.parse(gh(["issue", "list", "-R", e.repo, "--author", me, "--state", "all", "--limit", "50", "--json", "number,url,body"]));
    const dupe = mine.find((i) => i.body?.includes(ISSUE_MARKER("").slice(0, -4)));
    let issue = dupe ? { number: dupe.number, url: dupe.url } : null;
    if (!issue) {
      let readme = "";
      try { readme = gh(["api", `repos/${e.repo}/readme`, "-H", "Accept: application/vnd.github.raw"]); } catch {}
      const url = gh(["issue", "create", "-R", e.repo, "--title", d.title.slice(0, 120), "--body-file", "-"], d.body).trim();
      issue = { number: Number(url.split("/").pop()), url, badgeAtNotice: /sealmark\.dev\/badge\//i.test(readme) };
      opened += 1;
    }
    ledger.issues.push({ ...baseline(e, issue, today), author: me });
    writeJson(FILES.ledger, ledger);
  }
  if (fs.existsSync(FILES.draft)) fs.rmSync(FILES.draft);
  console.log(`owner issues opened: ${opened} (cap ${MAX_ISSUES}); ${waiting} repositories wait for later runs; ${skipped.length} skipped; ${held.length} held for private handling`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
