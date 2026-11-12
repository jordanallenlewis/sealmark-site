// What happened to a server's grade after its owner was told. Runs in fleet.yml after notify-owners.mjs; the output
// is for us, not for sealmark.dev (nothing under web/ reads it).
//
//   node fleet/impact.mjs                        real notices: fleet/owner-notified.json (+ live emails from D1)
//   node fleet/impact.mjs --simulate --out DIR   SIMULATED: half the servers (a fixed hash split) are treated as
//                                                notified at their first graded run, the other half are the base rate
//
// Writes fleet/impact-summary.md and fleet/impact.json, and appends a line to fleet/owner-impact.jsonl whenever a
// notice's grade or evidence changes (so first-seen dates survive later edits, deleted comments or reopened issues).
//
// Honest wording, kept by attribute() below:
//   "improved after notice"  a later version got a better letter. Correlation only: compare it with the base rate.
//   "acted on Sealmark"      only with direct evidence: a commit or PR referenced our issue, a commit message mentions
//                            Sealmark, a maintainer closed our issue with a fix, or the Sealmark badge was added.
// Each piece of evidence is its own flag, read from GitHub (read-only, throttled), and never inferred from another.
// Caveat for every number: the grader changes too; a better letter on a new version can come from a Sealmark change.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { RANK } from "../web/worker/notify-core.mjs";
import { SELF } from "./notify-owners.mjs";

export const FILES = {
  history: "fleet/history.jsonl",
  telemetry: "fleet/telemetry.jsonl",
  ledger: "fleet/owner-notified.json",
  repos: "fleet/owner-repos.json",
  snapshots: "fleet/owner-impact.jsonl",
  summary: "fleet/impact-summary.md",
  json: "fleet/impact.json",
};
const D1 = { account: "f37b212eac72fedf8ef688eb7856ea4d", database: "121844a2-b776-4888-ba48-8d271f93fee3" };
const MAX_REPOS = Number(process.env.IMPACT_MAX_REPOS ?? 40); // GitHub evidence checks per run
const MAINTAINER = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const MENTION = /sealmark/i;

const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const rank = (l) => (l && l in RANK ? RANK[l] : null);
export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const readLines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

// id -> history rows (graded only), oldest first.
export function indexHistory(rows) {
  const by = new Map();
  for (const r of rows) {
    if (r.status !== "ok" || !r.worst) continue;
    if (!by.has(r.id)) by.set(r.id, []);
    by.get(r.id).push(r);
  }
  for (const list of by.values()) list.sort((a, b) => a.testedAt.localeCompare(b.testedAt));
  return by;
}

// "id@version" -> failing check ids (fail, not advisory), from the first telemetry row for that version.
export function indexFailing(rows) {
  const by = new Map();
  for (const r of rows) {
    const key = `${r.id}@${r.serverVersion}`;
    if (by.has(key) || r.status !== "ok") continue;
    by.set(key, (r.ruleHits ?? []).filter(([, verdict, , advisory]) => verdict === "fail" && !advisory).map(([id]) => id));
  }
  return by;
}

// One notice joined with the grades that came after it. Versions already tested on or before the notice day do not
// count as "after"; each later version is graded by its first graded run.
export function joinNotice(notice, hist, failing) {
  const rows = hist.get(notice.id) ?? [];
  const before = new Set(rows.filter((r) => r.testedAt <= notice.at).map((r) => r.version));
  before.add(notice.version);
  const seen = new Set();
  const after = [];
  for (const r of rows) {
    if (r.testedAt <= notice.at || before.has(r.version) || seen.has(r.version)) continue;
    seen.add(r.version);
    after.push({ version: r.version, testedAt: r.testedAt, letter: r.worst, failing: failing.get(`${notice.id}@${r.version}`) ?? null });
  }
  const base = rank(notice.letter);
  const better = after.find((v) => rank(v.letter) > base) ?? null;
  const worse = after.find((v) => rank(v.letter) < base) ?? null;
  const latest = after.at(-1) ?? null;
  const known = latest?.failing && Array.isArray(notice.failing);
  return {
    ...notice,
    after,
    released: after.length > 0,
    improved: Boolean(better),
    firstImprovement: better ? { version: better.version, testedAt: better.testedAt, letter: better.letter, days: days(notice.at, better.testedAt) } : null,
    regressed: Boolean(worse),
    latest: latest ? { version: latest.version, letter: latest.letter, testedAt: latest.testedAt } : null,
    fixed: known ? notice.failing.filter((id) => !latest.failing.includes(id)) : null,
    broke: known ? latest.failing.filter((id) => !notice.failing.includes(id)) : null,
  };
}

// The words we may use. `evidence` holds independent flags: true, false, or null (not checked / check failed).
export function attribute(joined, evidence = {}) {
  const direct = {
    issueReferenced: evidence.issueReferenced === true,
    fixCommitMentionsSealmark: evidence.commitMentionsSealmark === true,
    closedByMaintainerWithFix: evidence.closedByMaintainer === true && (evidence.closedByCommit === true || evidence.issueReferenced === true),
    badgeAdded: evidence.badgeNow === true && joined.badgeAtNotice === false,
  };
  const acted = Object.values(direct).some(Boolean);
  const label = acted ? "acted on Sealmark" : joined.improved ? "improved after notice" : joined.released ? "new version, no better grade" : "no new version yet";
  return { direct, actedOnSealmark: acted, improvedWithDirectSignal: acted && joined.improved, label };
}

// Servers never notified, measured the same way from `startFor(id)`: the base rate a notice has to beat.
export function baseRate(hist, failing, ids, startFor) {
  const out = { servers: 0, released: 0, improved: 0, regressed: 0, daysToImprovement: [] };
  for (const id of ids) {
    const start = startFor(id);
    const rows = hist.get(id) ?? [];
    const at = rows.filter((r) => r.testedAt <= start).at(-1);
    if (!start || !at) continue;
    const j = joinNotice({ id, at: start, version: at.version, letter: at.worst, failing: null }, hist, failing);
    out.servers += 1;
    if (j.released) out.released += 1;
    if (j.improved) { out.improved += 1; out.daysToImprovement.push(j.firstImprovement.days); }
    if (j.regressed) out.regressed += 1;
  }
  out.medianDaysToImprovement = median(out.daysToImprovement);
  delete out.daysToImprovement;
  return out;
}

export function summarize(rows, base) {
  const fixed = new Map();
  for (const r of rows) for (const id of r.fixed ?? []) fixed.set(id, (fixed.get(id) ?? 0) + 1);
  const count = (f) => rows.filter(f).length;
  return {
    notified: rows.length,
    byChannel: Object.fromEntries([...new Set(rows.map((r) => r.channel))].map((c) => [c, count((r) => r.channel === c)])),
    released: count((r) => r.released),
    improved: count((r) => r.improved),
    regressed: count((r) => r.regressed),
    improvedWithDirectSignal: count((r) => r.attribution.improvedWithDirectSignal),
    actedOnSealmark: count((r) => r.attribution.actedOnSealmark),
    medianDaysToImprovement: median(rows.filter((r) => r.improved).map((r) => r.firstImprovement.days)),
    topFixedChecks: [...fixed].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8),
    base,
  };
}

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");
export function renderSummary({ summary: s, rows, mode, today, window, notes = [] }) {
  const sim = mode === "simulate";
  const lines = [
    sim ? `# Owner-notice impact: SIMULATED` : `# Owner-notice impact`,
    ``,
    sim
      ? `**Simulation, not real notices.** Nobody was told anything. A fixed hash split treats half the servers as notified at their first graded run; the other half are the never-notified base rate. Use it to check the method, not to claim an effect. Written ${today} by \`fleet/impact.mjs --simulate\`.`
      : `Written ${today} by \`fleet/impact.mjs\`. Internal: not published on sealmark.dev. ${window}`,
    ``,
    `| | Notified | Base rate (never notified) |`,
    `|---|---|---|`,
    `| Servers | ${s.notified} | ${s.base.servers} |`,
    `| Released a new version since | ${s.released} (${pct(s.released, s.notified)}) | ${s.base.released} (${pct(s.base.released, s.base.servers)}) |`,
    `| Improved after notice (better letter on a new version) | ${s.improved} (${pct(s.improved, s.notified)}; ${pct(s.improved, s.released)} of releasers) | ${s.base.improved} (${pct(s.base.improved, s.base.servers)}; ${pct(s.base.improved, s.base.released)} of releasers) |`,
    `| Regressed (worse letter on a new version) | ${s.regressed} | ${s.base.regressed} |`,
    `| Median days to first improvement | ${s.medianDaysToImprovement ?? "n/a"} | ${s.base.medianDaysToImprovement ?? "n/a"} |`,
    `| Acted on Sealmark (direct evidence) | ${s.actedOnSealmark} | not measured |`,
    `| Improved, with direct evidence | ${s.improvedWithDirectSignal} | not measured |`,
    ``,
    `"Improved after notice" is correlation: read it against the base rate. "Acted on Sealmark" needs direct evidence (our issue referenced by a commit or PR, a commit message naming Sealmark, a maintainer closing our issue with a fix, or the badge added after the notice). The grader changes too, so a letter can move without the server changing.`,
  ];
  if (Object.keys(s.byChannel).length) lines.push(``, `Notices by channel: ${Object.entries(s.byChannel).map(([c, n]) => `${c} ${n}`).join(", ")}.`);
  lines.push(``, `## Checks fixed most often (failing at notice, passing on the latest new version)`, ``, s.topFixedChecks.length ? s.topFixedChecks.map(([id, n]) => `- \`${id}\`: ${n}`).join("\n") : `None yet (or no per-check data for the versions involved; per-check data starts 2026-11-09).`);
  const shown = rows.filter((r) => r.released || r.attribution.actedOnSealmark).slice(0, 40);
  if (shown.length) {
    lines.push(``, `## Notices with a new version or evidence`, ``, `| Server | Notice | Since | Latest | Label | Evidence |`, `|---|---|---|---|---|---|`);
    for (const r of shown) {
      const ev = Object.entries(r.evidence ?? {}).filter(([, v]) => v === true).map(([k]) => k).join(", ") || "none";
      lines.push(`| \`${r.id}\` | ${r.at} ${r.version} **${r.letter}** | ${r.after.length} version(s) | ${r.latest ? `${r.latest.version} **${r.latest.letter}**` : "n/a"} | ${r.attribution.label} | ${ev} |`);
    }
  }
  if (notes.length) lines.push(``, `## Notes`, ``, ...notes.map((n) => `- ${n}`));
  return lines.join("\n") + "\n";
}

// ---- GitHub evidence (read-only) ----
export function githubClient(token, { pause = 250 } = {}) {
  let calls = 0;
  return {
    get calls() { return calls; },
    async get(p, accept = "application/vnd.github+json") {
      calls += 1;
      await new Promise((r) => setTimeout(r, pause));
      const res = await fetch(`https://api.github.com${p}`, { headers: { accept, "user-agent": "sealmark-fleet", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${p}: ${res.status}`);
      return accept.includes("raw") ? res.text() : res.json();
    },
  };
}

// Every flag separately; a failed call leaves its flag null rather than guessing.
export async function gatherEvidence(gh, notice) {
  const ev = {};
  const flag = async (names, fn) => { try { Object.assign(ev, await fn()); } catch { for (const n of names) ev[n] ??= null; } };
  const r = notice.repo;
  if (notice.channel === "issue" && notice.number) {
    await flag(["issueState", "closedByMaintainer"], async () => {
      const i = await gh.get(`/repos/${r}/issues/${notice.number}`);
      return { issueState: i?.state ?? null, closedByMaintainer: i ? i.state === "closed" && Boolean(i.closed_by) && i.closed_by.login !== i.user?.login : null };
    });
    await flag(["maintainerCommented"], async () => {
      const cs = (await gh.get(`/repos/${r}/issues/${notice.number}/comments?per_page=100`)) ?? [];
      return { maintainerCommented: cs.some((c) => MAINTAINER.has(c.author_association) && c.user?.login !== notice.author) };
    });
    await flag(["issueReferenced", "closedByCommit"], async () => {
      const tl = (await gh.get(`/repos/${r}/issues/${notice.number}/timeline?per_page=100`)) ?? [];
      const byOthers = (e) => (e.actor?.login ?? e.source?.issue?.user?.login) !== notice.author;
      return {
        issueReferenced: tl.some((e) => byOthers(e) && ((e.event === "referenced" && e.commit_id) || (e.event === "cross-referenced" && e.source?.issue?.pull_request))),
        closedByCommit: tl.some((e) => e.event === "closed" && Boolean(e.commit_id)),
      };
    });
  }
  if (r) {
    await flag(["badgeNow"], async () => ({ badgeNow: /sealmark\.dev\/badge\//i.test((await gh.get(`/repos/${r}/readme`, "application/vnd.github.raw")) ?? "") }));
    await flag(["commitMentionsSealmark"], async () => {
      const cs = (await gh.get(`/repos/${r}/commits?since=${notice.at}T00:00:00Z&per_page=100`)) ?? [];
      return { commitMentionsSealmark: cs.some((c) => MENTION.test(c.commit?.message ?? "")) };
    });
    await flag(["releaseMentionsSealmark"], async () => {
      const rs = (await gh.get(`/repos/${r}/releases?per_page=30`)) ?? [];
      return { releaseMentionsSealmark: rs.some((x) => (x.published_at ?? "") >= notice.at && MENTION.test(x.body ?? "")) };
    });
  }
  return ev;
}

// Live grade-change emails sent by the Worker (D1 notices with live = 1), mirrored into the tracked ledger.
async function pullEmailNotices(ledger) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) return "email notices not read: CLOUDFLARE_API_TOKEN is not set";
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${D1.account}/d1/database/${D1.database}/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ sql: "SELECT id, server_id, letter_to, version, failing, recipients, sent_at FROM notices WHERE live = 1 ORDER BY id" }),
  });
  if (!res.ok) return `email notices not read: D1 answered ${res.status}`;
  const rows = (await res.json()).result?.[0]?.results ?? [];
  ledger.emails ??= [];
  const have = new Set(ledger.emails.map((e) => e.d1));
  for (const n of rows) {
    if (have.has(n.id)) continue;
    ledger.emails.push({ channel: "email", d1: n.id, id: n.server_id, at: n.sent_at.slice(0, 10), version: n.version, letter: n.letter_to, failing: JSON.parse(n.failing || "[]"), recipients: n.recipients, badgeAtNotice: null });
  }
  return null;
}

// Simulated notices: every server whose id hashes even is "notified" at its first graded run.
export const simNotified = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 2 === 0;

async function main() {
  const args = process.argv.slice(2);
  const sim = args.includes("--simulate");
  const outDir = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
  if (sim && !outDir) throw new Error("--simulate needs --out DIR (simulated output is never written into fleet/)");
  const today = new Date().toISOString().slice(0, 10);
  const hist = indexHistory(readLines(FILES.history));
  const failing = indexFailing(readLines(FILES.telemetry));
  const repos = fs.existsSync(FILES.repos) ? JSON.parse(fs.readFileSync(FILES.repos, "utf8")) : {};
  const ledger = fs.existsSync(FILES.ledger) ? JSON.parse(fs.readFileSync(FILES.ledger, "utf8")) : { issues: [], emails: [] };
  const notes = [];

  let notices, startFor, window;
  if (sim) {
    const own = (id) => SELF.includes((repos[id]?.repo ?? "").split("/")[0].toLowerCase());
    notices = [...hist].filter(([id]) => simNotified(id) && !own(id)).map(([id, rows]) => ({ channel: "simulated", id, repo: repos[id]?.repo ?? null, at: rows[0].testedAt, version: rows[0].version, letter: rows[0].worst, failing: failing.get(`${id}@${rows[0].version}`) ?? null, badgeAtNotice: null }));
    startFor = (id) => hist.get(id)?.[0]?.testedAt ?? null;
    notes.push("Badge evidence cannot count in a simulation: whether the badge was there at the 'notice' is unknown.");
  } else {
    const err = await pullEmailNotices(ledger).catch((e) => `email notices not read: ${e.message}`);
    if (err) notes.push(err);
    else fs.writeFileSync(FILES.ledger, JSON.stringify(ledger, null, 2) + "\n");
    notices = [...(ledger.issues ?? []), ...(ledger.emails ?? []).map((e) => ({ ...e, repo: repos[e.id]?.repo ?? null }))];
    const first = notices.map((n) => n.at).sort()[0];
    const start = first ?? new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
    startFor = () => start;
    window = first ? `Base-rate window: from the first notice (${first}) to ${today}.` : `No notices yet. Base-rate window: the last 14 days (${start} to ${today}), for reference.`;
  }
  const notifiedIds = new Set(notices.map((n) => n.id));
  const base = baseRate(hist, failing, [...hist.keys()].filter((id) => !notifiedIds.has(id)), startFor);

  // evidence: oldest-checked first, capped per run; earlier results reused for the rest
  const prev = !sim && fs.existsSync(FILES.json) ? JSON.parse(fs.readFileSync(FILES.json, "utf8")) : { notices: [] };
  const prevBy = new Map(prev.notices.map((n) => [`${n.channel}:${n.id}:${n.at}`, n]));
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || process.env.OWNER_ISSUES_TOKEN || "";
  const gh = githubClient(token);
  const due = notices.filter((n) => n.repo).sort((a, b) => (prevBy.get(`${a.channel}:${a.id}:${a.at}`)?.checkedAt ?? "").localeCompare(prevBy.get(`${b.channel}:${b.id}:${b.at}`)?.checkedAt ?? "")).slice(0, MAX_REPOS);
  const fresh = new Map();
  for (const n of due) fresh.set(n, { evidence: await gatherEvidence(gh, n), checkedAt: today });
  if (notices.some((n) => !n.repo)) notes.push(`${notices.filter((n) => !n.repo).length} notices have no known GitHub repository, so no evidence flags.`);
  if (notices.filter((n) => n.repo).length > due.length) notes.push(`Evidence checked for ${due.length} repositories this run (cap ${MAX_REPOS}); the rest reuse earlier checks.`);

  const rows = notices.map((n) => {
    const key = `${n.channel}:${n.id}:${n.at}`;
    const got = fresh.get(n) ?? { evidence: prevBy.get(key)?.evidence ?? {}, checkedAt: prevBy.get(key)?.checkedAt ?? null };
    const j = joinNotice(n, hist, failing);
    return { ...j, evidence: got.evidence, checkedAt: got.checkedAt, attribution: attribute(j, got.evidence) };
  });
  const summary = summarize(rows, base);
  const json = { generatedAt: today, mode: sim ? "simulate" : "real", summary, notices: rows };
  const md = renderSummary({ summary, rows, mode: sim ? "simulate" : "real", today, window, notes });

  const dir = outDir ?? "fleet";
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, path.basename(FILES.summary)), md);
  fs.writeFileSync(path.join(dir, path.basename(FILES.json)), JSON.stringify(json, null, 2) + "\n");
  if (!sim) {
    // append a snapshot only when something about a notice changed
    const last = new Map();
    for (const s of readLines(FILES.snapshots)) last.set(s.key, JSON.stringify([s.latest, s.evidence, s.label]));
    const add = [];
    for (const r of rows) {
      const key = `${r.channel}:${r.id}:${r.at}`;
      const sig = JSON.stringify([r.latest, r.evidence, r.attribution.label]);
      if (last.get(key) !== sig) add.push(JSON.stringify({ at: today, key, latest: r.latest, evidence: r.evidence, label: r.attribution.label }));
    }
    if (add.length) fs.appendFileSync(FILES.snapshots, add.join("\n") + "\n");
  }
  console.log(`impact (${sim ? "SIMULATED" : "real"}): ${rows.length} notices, ${base.servers} base-rate servers, ${gh.calls} GitHub calls; wrote ${dir}/${path.basename(FILES.summary)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
