// Tells MCP server owners their Sealmark grade: one GitHub issue per repository, opened on the first grade, never
// again (reply "opt out" and that repository is skipped forever). Runs in fleet.yml after merge.mjs.
//
//   node fleet/notify-owners.mjs            draft or file, depending on the gate below
//   node fleet/notify-owners.mjs --dry      never files; writes the drafts file even when the gate is open
//
// Gate: issues are opened only when the OWNER_ISSUES_TOKEN secret is set AND the repository variable
// OWNER_ISSUES_LIVE is "1". Otherwise the next issues are written to fleet/owner-issues-draft.md for review.
//
// Files (all tracked, committed by the collect job):
//   fleet/owner-repos.json      server id -> GitHub repo (or null), resolved from the launch line or npm/PyPI metadata
//   fleet/owner-notified.json   the notice ledger: every issue opened, with the baseline fleet/impact.mjs measures from
//   fleet/owner-optout.json     repositories that asked not to hear from Sealmark; honoured forever, never pruned
//   fleet/owner-issues-draft.md the issues the next live run would open (rewritten each run while the gate is shut)
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ISSUE_MARKER, failingChecks, issueDraft, letterOf } from "../web/worker/notify-core.mjs";

export const FILES = {
  results: "web/content/data/server-results.json",
  repos: "fleet/owner-repos.json",
  ledger: "fleet/owner-notified.json",
  optout: "fleet/owner-optout.json",
  draft: "fleet/owner-issues-draft.md",
};
export const MAX_ISSUES = Number(process.env.MAX_OWNER_ISSUES ?? 8); // per run
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

// Which graded servers get an issue this run, and why the others do not. Pure: callers pass the repo metadata.
//   cache: id -> {repo}; ledger: {issues: [...]}; optout: {repos: [...]}; meta: repo -> GitHub repo object or {missing}
export function plan({ servers, cache, ledger, optout, meta = {}, max = MAX_ISSUES }) {
  const notified = new Set((ledger.issues ?? []).map((i) => i.repo.toLowerCase()));
  const opted = new Set((optout.repos ?? []).map((r) => r.toLowerCase()));
  const byRepo = new Map();
  const skipped = [];
  for (const server of [...servers].sort((a, b) => a.testedAt.localeCompare(b.testedAt) || a.id.localeCompare(b.id))) {
    if (!letterOf(server)) continue; // not graded: nothing to tell yet
    const repo = cache[server.id]?.repo;
    if (!repo) { skipped.push({ id: server.id, reason: "no GitHub repository found" }); continue; }
    const key = repo.toLowerCase();
    if (byRepo.has(key)) { byRepo.get(key).also.push(server); continue; }
    byRepo.set(key, { repo, server, also: [] });
  }
  const send = [];
  for (const [key, entry] of byRepo) {
    const why = notified.has(key) ? "already notified"
      : opted.has(key) ? "opted out"
      : SELF.includes(key.split("/")[0]) ? "our own repository"
      : meta[entry.repo]?.missing ? "repository not found"
      : meta[entry.repo]?.archived ? "archived"
      : meta[entry.repo]?.fork ? "fork"
      : meta[entry.repo] && meta[entry.repo].has_issues === false ? "issues disabled"
      : null;
    if (why) { if (why !== "already notified") skipped.push({ id: entry.server.id, repo: entry.repo, reason: why }); continue; }
    send.push(entry);
  }
  return { send: send.slice(0, max), waiting: Math.max(0, send.length - max), skipped };
}

// The issue for one repository. A repo with several graded servers gets one issue that names the others.
export function draftFor(entry) {
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

export function renderDrafts({ drafts, waiting, skipped, reason, today }) {
  const parts = [
    `# Owner issues: drafts`,
    `Written by \`fleet/notify-owners.mjs\` on ${today}. Not filed: ${reason}. These are the issues the next live run would open (at most ${MAX_ISSUES} per run)${waiting ? `; ${waiting} more repositories wait for later runs` : ""}.`,
  ];
  for (const d of drafts) parts.push(`---\n\n## ${d.repo}\n\n**Title:** ${d.title}\n\n${d.body}`);
  if (!drafts.length) parts.push(`No repository is due an issue.`);
  if (skipped.length) parts.push(`---\n\n## Skipped\n\n${skipped.map((s) => `- \`${s.id}\`${s.repo ? ` (${s.repo})` : ""}: ${s.reason}`).join("\n")}`);
  return parts.join("\n\n") + "\n";
}

// "opt out" (any case, with or without the space or hyphen) in a reply that is not Sealmark's own.
export const OPT_OUT = /\bopt[\s-]?out\b/i;

const readJson = (f, fallback) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : fallback);
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n");

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const token = process.env.OWNER_ISSUES_TOKEN ?? "";
  const live = Boolean(token) && process.env.OWNER_ISSUES_LIVE === "1" && !process.argv.includes("--dry");
  const reason = live ? "" : !token ? "the OWNER_ISSUES_TOKEN secret is not set" : process.env.OWNER_ISSUES_LIVE !== "1" ? "the OWNER_ISSUES_LIVE variable is not \"1\"" : "--dry";
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
      const hit = Array.isArray(comments) && comments.find((c) => c.user?.type !== "Bot" && c.user?.login !== i.author && OPT_OUT.test(c.body ?? ""));
      if (hit) { optout.repos.push(i.repo); console.log(`opt-out recorded: ${i.repo} (${hit.html_url})`); }
    } catch (e) { console.log(`opt-out check failed for ${i.repo}: ${e.message}`); }
  }
  writeJson(FILES.optout, optout);

  const first = plan({ servers, cache, ledger, optout, max: Infinity });
  const meta = {};
  for (const e of first.send.slice(0, MAX_ISSUES * 2)) {
    try { meta[e.repo] = await api(`/repos/${e.repo}`); } catch (err) { console.log(`repo check failed for ${e.repo}: ${err.message}`); }
  }
  const { send, waiting, skipped } = plan({ servers, cache, ledger, optout, meta: Object.fromEntries(Object.entries(meta)), max: MAX_ISSUES });
  // only candidates whose repo was checked go out live: an unchecked one may be archived or have issues off
  const ready = send.filter((e) => meta[e.repo] && !meta[e.repo].missing);

  if (!live) {
    fs.writeFileSync(FILES.draft, renderDrafts({ drafts: ready.map(draftFor), waiting: waiting + send.length - ready.length, skipped, reason, today }));
    console.log(`not live (${reason}): ${ready.length} drafts in ${FILES.draft}, ${skipped.length} skipped`);
    return;
  }

  // 3. live: one issue per repository, deduped by the hidden marker in case a ledger commit was lost
  const env = { ...process.env, GH_TOKEN: token };
  const gh = (args, input) => execFileSync("gh", args, { encoding: "utf8", input, env });
  const me = JSON.parse(gh(["api", "user"])).login;
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
  console.log(`owner issues opened: ${opened}; ${waiting} repositories wait for later runs; ${skipped.length} skipped`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
