// Private reports for held repositories: servers whose graded run has a security finding. Never public. Where the
// repository has GitHub private vulnerability reporting switched on, the finding goes to its maintainers there, under
// the disclosure policy (https://sealmark.dev/disclosure/: a private report, 14 days to reply with one reminder,
// publication at a fix or at day 90). Where it is off the repository stays held.
//
// Gates, all of them: OWNER_PRIVATE_LIVE is "1" (Jordan's yes to the disclosure policy applied to this batch and the
// drip after it), the bot token is valid, the repository is not opted out or ours, every reported server's grade is fresh
// and stable and its tested version is still the latest, the repository is active, the caps below and the shared pause
// allow it. The ledger records only a hash of the repository (ledger.private), because fleet/owner-notified.json is
// public and a repository name there would say where a finding is.
import crypto from "node:crypto";
import { ORIGIN, letterOf } from "../web/worker/notify-core.mjs";
import { budget, stability } from "./owner-limits.mjs";

export const PRIVATE_DEFAULTS = { perRun: 1, perDay: 2, perWeek: 7, gapMinutes: 60 };
const cap = (v, d) => { const t = String(v ?? "").trim(); if (t === "0") return 0; const n = Number(t || NaN); return Number.isInteger(n) && n >= 1 ? n : d; };
export const privateLimitsFrom = (env = {}) => ({
  perRun: cap(env.OWNER_PRIVATE_PER_RUN, PRIVATE_DEFAULTS.perRun), perDay: cap(env.OWNER_PRIVATE_PER_DAY, PRIVATE_DEFAULTS.perDay),
  perWeek: cap(env.OWNER_PRIVATE_PER_WEEK, PRIVATE_DEFAULTS.perWeek), gapMinutes: cap(env.OWNER_PRIVATE_GAP_MINUTES, PRIVATE_DEFAULTS.gapMinutes),
  ownerDays: 7, activeDays: 180,
});

// A keyed hash (HMAC-SHA256 with the OWNER_PRIVATE_KEY secret): the ledger is public and repository names are guessable,
// so a plain hash would let anyone test which repositories were reported. Without the key a live run sends nothing.
export const repoHash = (repo, key = "") => crypto.createHmac("sha256", String(key)).update(String(repo).toLowerCase()).digest("hex").slice(0, 16);
export const alreadyReported = (ledger, repo, key = "") => (ledger.private ?? []).some((r) => r.h === repoHash(repo, key));

// The report for one held repository (privateEntry's shape, with `fix` text per finding). The text is exactly what is posted.
export function reportFor(entry, { fixFor = () => "" } = {}) {
  const servers = entry.servers.filter((x) => x.security.length);
  const first = servers[0];
  const names = [...new Set(servers.flatMap((x) => x.security.map((c) => c.label)))];
  const title = `${names.slice(0, 2).join("; ")}${names.length > 2 ? ` and ${names.length - 2} more` : ""} in ${first.name} ${first.version} (automated Sealmark test)`.slice(0, 200);
  const blocks = servers.map((x) => [
    `${x.name} ${x.version}, tested ${x.testedAt}:`,
    ...x.security.map((c) => `- \`${c.id}\` (${c.verdict === "fail" ? "failed" : "partly passed"}): ${String(c.summary ?? "").trim().replace(/[.\s]+$/, "")}${fixFor(c.id) ? `. How to fix: ${fixFor(c.id)}` : "."}`),
    `Reproduce: \`${x.rerun}\``,
  ].join("\n"));
  const body = [
    `Hi. [Sealmark](${ORIGIN}) is an open-source test suite for MCP servers, run by [Jordan Allen Lewis](https://github.com/jordanallenlewis). An automated run started your server and called its tools with fixed inputs (no model involved). It produced a result you should see before anyone else does, so we are sending it privately.`,
    blocks.join("\n\n"),
    `The page for ${first.name} on sealmark.dev already hides this finding while it is private (${first.results}). We follow [this disclosure policy](${ORIGIN}/disclosure/): we wait 14 days for a reply and send one reminder, and publish the finding once it is fixed or on day 90, whichever comes first. If you need more time or the result is wrong, reply here and we will recheck it and say so.`,
    `This is automated and can be wrong. This is the only report Sealmark will send for this repository. To stop all Sealmark messages to you, reply "opt out".`,
  ].join("\n\n");
  return { repo: entry.repo, title, body, hash: crypto.createHash("sha256").update(`${entry.repo}\n${title}\n${body}`).digest("hex").slice(0, 16), servers: servers.map((x) => x.id) };
}

// Which held repositories may get a report now, most findings first. `entries` are privateEntry results; `pvr` is
// repo -> true/false/null; byId maps server id -> the result (for freshness and stability); rules are applied here so the
// card Jordan approves and the live run see the same list. Pure.
//   ctx: {ledger, optout, history, today, limits, self, facts (id -> factsGate result or null)}
export function candidates(entries, { pvr, byId, ledger, optout, history, today, self = [], limits, facts = {}, key = "" }) {
  const opted = new Set((optout.repos ?? []).map((r) => r.toLowerCase()));
  const optedOwners = new Set([...opted].map((r) => r.split("/")[0]));
  const out = [];
  const skipped = [];
  for (const e of entries) {
    const why = !e.repo ? "no repository" : pvr[e.repo] !== true ? "private vulnerability reporting is not on" : alreadyReported(ledger, e.repo, key) ? "already reported" : opted.has(e.repo.toLowerCase()) || optedOwners.has(e.repo.split("/")[0].toLowerCase()) ? "opted out" : self.includes(e.repo.split("/")[0].toLowerCase()) ? "our own repository" : null;
    if (why) { skipped.push({ repo: e.repo, why }); continue; }
    const live = e.servers.filter((x) => x.security.length);
    const bad = live.map((x) => {
      const r = byId.get(x.id);
      if (!x.fresh) return `not fresh (${x.stale})`;
      if (r && !stability(r, history).ok) return stability(r, history).reason;
      if (facts[x.id]) return facts[x.id].reason;
      return null;
    }).find(Boolean);
    if (bad) { skipped.push({ repo: e.repo, why: bad }); continue; }
    out.push(e);
  }
  out.sort((a, b) => b.servers.reduce((n, x) => n + x.security.length, 0) - a.servers.reduce((n, x) => n + x.security.length, 0) || String(a.repo).localeCompare(String(b.repo)));
  return { ready: out, skipped };
}

// Posts reports. `post(repo, {summary, description})` throws an Error with `.status`. Never throws itself. Returns
// {sent: n, stopped: status|null}; each sent report is recorded as a hash, before the next one is tried.
export async function sendReports({ ready, ledger, now, limits, post, save, sleep, log, key = "" }) {
  const room = budget({ ledger: { issues: ledger.private ?? [], pause: ledger.pause }, now, limits });
  const out = { sent: 0, stopped: null, room };
  for (const r of ready.slice(0, room.allow)) {
    if (out.sent > 0) await sleep(60_000);
    try {
      await post(r.repo, { summary: r.title, description: r.body });
      (ledger.private ??= []).push({ h: repoHash(r.repo, key), at: new Date(now).toISOString().slice(0, 10), postedAt: new Date(now).toISOString() });
      out.sent += 1;
      save();
    } catch (e) {
      const status = Number(e.status ?? NaN);
      log(`::warning::a private report failed (${Number.isFinite(status) ? status : "error"}); not named here`);
      if (!Number.isFinite(status) || status === 401 || status === 403 || status === 429 || status >= 500) { out.stopped = String(Number.isFinite(status) ? status : "error"); break; }
      // 404 / 422: this repository cannot take a report; record it so it is not tried every run
      (ledger.private ??= []).push({ h: repoHash(r.repo, key), at: new Date(now).toISOString().slice(0, 10), failed: status });
      save();
    }
  }
  return out;
}
