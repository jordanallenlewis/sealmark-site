// The rules that keep owner notices from becoming spam. Pure functions: fleet/notify-owners.mjs calls them, and
// fleet/owner-limits.test.mjs pins every rule. Nothing here reads a file or the network.
//
//   limits        per run, per rolling 24 hours, per rolling 7 days, the gap between posts, one notice per owner per 7 days
//   pause         a stop switch kept in the ledger: set by a 403/429/abuse answer (timed) or by a negative reaction
//                 (until a person clears it); while it is set nothing is posted
//   stability     a grade is told only when the same server version was graded at least twice with the same letters
//   priority      the most helpful notice first: the biggest fixable gap, then the largest server
//   accounting    every graded server ends up sent, waiting (with a reason and an ETA), held or skipped (with a reason)

export const HOUR = 3600_000;
export const DAY = 24 * HOUR;

// The defaults are the conservative start Jordan approved (2026-11-17): at most 6 a day, 30 a week.
export const LIMIT_DEFAULTS = { perRun: 2, perDay: 6, perWeek: 30, ownerDays: 7, gapMinutes: 30, activeDays: 180 };

const whole = (value, fallback, min = 1) => {
  const n = Number(String(value ?? "").trim() || NaN);
  return Number.isInteger(n) && n >= min ? n : fallback;
};

// Reads the limits from the environment (repository variables). An unset or malformed value keeps the default, never
// removes a limit; a 0 for a cap is how a person pauses by hand, so caps accept 0.
export function limitsFrom(env = {}) {
  const cap = (v, d) => (String(v ?? "").trim() === "0" ? 0 : whole(v, d));
  return {
    perRun: cap(env.MAX_OWNER_ISSUES, LIMIT_DEFAULTS.perRun),
    perDay: cap(env.MAX_OWNER_ISSUES_PER_DAY, LIMIT_DEFAULTS.perDay),
    perWeek: cap(env.MAX_OWNER_ISSUES_PER_WEEK, LIMIT_DEFAULTS.perWeek),
    ownerDays: LIMIT_DEFAULTS.ownerDays,
    gapMinutes: whole(env.OWNER_ISSUE_GAP_MINUTES, LIMIT_DEFAULTS.gapMinutes),
    activeDays: LIMIT_DEFAULTS.activeDays,
  };
}

// When a notice was posted, in ms (postedAt, else the day it was recorded); NaN when unknown.
export const postedMs = (issue) => Date.parse(issue?.postedAt ?? (issue?.at ? `${issue.at}T00:00:00Z` : ""));

// How many notices may go out now: min(per run, what is left of the day and the week), and 0 while the gap since the
// last post has not passed. {allow, reason, nextAt} (nextAt: ms when more may go out, or null when unknown).
export function budget({ ledger, now, limits }) {
  const times = (ledger.issues ?? []).map(postedMs).filter((t) => Number.isFinite(t) && t <= now);
  const inLast = (ms) => times.filter((t) => now - t < ms).length;
  const day = inLast(DAY);
  const week = inLast(7 * DAY);
  const last = times.length ? Math.max(...times) : null;
  const pause = pauseState(ledger, now);
  if (pause.paused) return { allow: 0, code: "paused", reason: pause.reason, nextAt: pause.until, day, week };
  if (last != null && now - last < limits.gapMinutes * 60_000) return { allow: 0, code: "spacing", reason: `the last notice went out ${Math.round((now - last) / 60_000)} minutes ago; at least ${limits.gapMinutes} minutes between notices`, nextAt: last + limits.gapMinutes * 60_000, day, week };
  const dayLeft = Math.max(0, limits.perDay - day);
  const weekLeft = Math.max(0, limits.perWeek - week);
  const allow = Math.min(limits.perRun, dayLeft, weekLeft);
  if (allow > 0) return { allow, code: "ok", reason: "", nextAt: null, day, week };
  const code = limits.perRun === 0 ? "cap-run" : weekLeft === 0 ? "cap-week" : "cap-day";
  const oldest = (ms) => Math.min(...times.filter((t) => now - t < ms)) + ms;
  const nextAt = code === "cap-run" ? null : code === "cap-week" ? oldest(7 * DAY) : oldest(DAY);
  const reason = code === "cap-run" ? "the per-run cap is 0" : code === "cap-week" ? `the weekly cap of ${limits.perWeek} is used` : `the daily cap of ${limits.perDay} is used`;
  return { allow: 0, code, reason, nextAt: Number.isFinite(nextAt) ? nextAt : null, day, week };
}

// One notice per owner (user or organisation) per `ownerDays` days, across all their repositories.
export function ownersBusy(ledger, now, ownerDays = LIMIT_DEFAULTS.ownerDays) {
  const busy = new Map();
  for (const i of ledger.issues ?? []) {
    const t = postedMs(i);
    if (!Number.isFinite(t) || t > now || now - t >= ownerDays * DAY) continue;
    const owner = i.repo.split("/")[0].toLowerCase();
    busy.set(owner, Math.max(busy.get(owner) ?? 0, t + ownerDays * DAY));
  }
  return busy; // owner -> ms when the window ends
}

// ---- the pause ----

// {paused, reason, until}. A timed pause ends by itself; one without `until` stays until a person clears
// ledger.pause (set it to null) and says why in the commit.
export function pauseState(ledger, now) {
  const p = ledger.pause;
  if (!p) return { paused: false };
  if (p.until != null && now >= Date.parse(p.until)) return { paused: false };
  return { paused: true, reason: `paused since ${String(p.since).slice(0, 10)}: ${p.reason}`, until: p.until ? Date.parse(p.until) : null };
}

// hours: null for a pause only a person ends.
export function setPause(ledger, { code, reason, now, hours = null }) {
  const keep = ledger.pause && pauseState(ledger, now).paused ? ledger.pause : null;
  if (keep && keep.until == null) return keep; // a person-only pause is never shortened
  ledger.pause = { code, reason, since: new Date(now).toISOString(), until: hours == null ? null : new Date(now + hours * HOUR).toISOString() };
  return ledger.pause;
}

// What a GitHub error means for the pause, from classifyGhError's status: rate limit, abuse and refusal back off for a
// day; a rejected token for a day too (a person has to fix the secret, and nothing is lost by waiting).
export function backoffFor(status) {
  if (["429", "rate-limited", "403"].includes(String(status))) return { code: `http-${status}`, hours: 24, reason: `GitHub answered ${status} (rate limit or abuse signal); backing off for 24 hours` };
  if (String(status) === "401") return { code: "http-401", hours: 24, reason: "GitHub rejected the bot token (401); backing off until the token is fixed" };
  return null;
}

// ---- negative reactions ----

const NEGATIVE_WORDS = /\b(spam|spamming|unsolicited|please stop|stop (?:sending|spamming|this|these|it|contacting|bothering|emailing|opening)|go away|do not contact|don'?t contact|harass(?:ing|ment)?|abuse|abusive|reported? (?:you|this|your|it)|blocked? (?:you|this)|not welcome|unwanted)\b/i;

// Text a person wrote, without quoted lines, code and quotation marks (same rule as the reply reader).
function ownWords(text) {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ")
    .split(/\r?\n/).filter((l) => !/^\s*>/.test(l)).join("\n")
    .replace(/"[^"\n]*"|“[^”\n]*”/g, " ");
}

// A negative reaction to one notice, or null: the issue was removed or hidden as spam (404/410 on a notice we posted),
// closed as "not planned", got a thumbs-down, or a person's comment says stop / spam / unsolicited.
//   issue: the GitHub issue object, or {missing: true} / {gone: true}; comments: the people's comments (bots removed)
export function negativeSignal({ issue, comments = [] }) {
  if (issue?.missing || issue?.gone) return { kind: "removed", detail: "the issue was removed or hidden by the repository (spam removal looks like this)" };
  if (issue?.state === "closed" && issue?.state_reason === "not_planned") return { kind: "not-planned", detail: "closed as not planned" };
  if ((issue?.reactions?.["-1"] ?? 0) > 0) return { kind: "thumbs-down", detail: "a thumbs-down on the issue" };
  for (const c of comments) {
    if ((c.reactions?.["-1"] ?? 0) > 0) return { kind: "thumbs-down", detail: "a thumbs-down on our comment" };
    if (NEGATIVE_WORDS.test(ownWords(c.body))) return { kind: "complaint", detail: "a reply asks us to stop or calls the notice spam", url: c.html_url };
  }
  return null;
}

// Records a signal once per notice and pauses on a new one. Returns the new signal or null.
export function applyNegative(ledger, { repo, number, signal, now }) {
  if (!signal) return null;
  ledger.negative ??= [];
  if (ledger.negative.some((n) => n.repo.toLowerCase() === repo.toLowerCase() && n.number === number && n.kind === signal.kind)) return null;
  const rec = { repo, number, kind: signal.kind, at: new Date(now).toISOString().slice(0, 10) };
  ledger.negative.push(rec);
  setPause(ledger, { code: "negative-reaction", reason: `${signal.detail} (${repo}#${number}); stopped until a person reviews it and clears the pause`, now, hours: null });
  return rec;
}

// ---- stability ----

const sameLetters = (a, b) => a.worst === b.worst && JSON.stringify(a.packs ?? {}) === JSON.stringify(b.packs ?? {});

// Is this server's grade consistent across repeat runs of the version that was graded? history: the parsed lines of
// fleet/history.jsonl ({id, version, testedAt, status, worst, packs}). {ok: true} or {ok: false, code, reason}.
//   single-run: the version was graded once; the next run decides, so this waits (never skips for good)
//   unstable: two runs of the same version gave different letters; a flaky result is never told to an owner
export function stability(server, history) {
  const runs = history.filter((h) => h.id === server.id && h.version === server.versionTested && h.status === "ok");
  if (runs.length < 2) return { ok: false, code: "single-run", reason: "graded once so far; waits for a repeat run to confirm the grade is stable" };
  const recent = runs.slice(-3);
  if (!recent.every((r) => sameLetters(r, recent[0]))) return { ok: false, code: "unstable", reason: "repeat runs of this version gave different grades (flaky); not told until the grade settles" };
  return { ok: true };
}

// ---- activity ----

// Is the repository alive: pushed within activeDays, from the server facts file ({repo: {pushedAt}}) or the repository
// object. Unknown stays unknown (callers treat it as a wait, not a pass).
export function activity(pushedAt, today, activeDays = LIMIT_DEFAULTS.activeDays) {
  if (!pushedAt) return { ok: null };
  const days = (Date.parse(today) - Date.parse(String(pushedAt).slice(0, 10))) / 864e5;
  if (!Number.isFinite(days)) return { ok: null };
  return days <= activeDays ? { ok: true } : { ok: false, code: "inactive", reason: `no commit in ${Math.floor(days)} days (last ${String(pushedAt).slice(0, 10)}); a notice to an unmaintained repository is not helpful` };
}

// ---- priority ----

const RANK = { F: 0, D: 1, C: 2, B: 3, A: 4 };
// Bigger first: the fixable gap (checks to name, a failed check counts double, a lower letter counts more), then the
// server with more tools. `listed` are the checks the notice would name.
export function priority(server, letter, listed) {
  const gap = listed.reduce((n, c) => n + (c.verdict === "fail" ? 2 : 1), 0) + (4 - (RANK[letter] ?? 4));
  return { gap, tools: server.coverage?.toolsTotal ?? server.toolCount ?? 0 };
}
export const byPriority = (a, b) => b.gap - a.gap || b.tools - a.tools || String(a.id).localeCompare(String(b.id));

// ---- accounting ----

// Codes that mean "not now" (a later run may send); everything else is a skip for good (until something changes).
export const WAITING = new Set(["stale", "newer-version", "check-failed", "lookup-failed", "single-run", "unstable", "owner-limit", "owner-window", "cap", "paused", "spacing", "unchecked", "unknown-activity", "weak-signals"]);

// Where every graded server stands: {sent, waiting: {code: n}, skipped: {code: n}, held, eligibleNotSent}.
export function account({ gradedIds, sent = [], skipped = [], held = [], waitingExtra = [] }) {
  const out = { graded: gradedIds.length, sent: sent.length, held: 0, waiting: {}, skipped: {}, unaccounted: [] };
  const seen = new Set(sent);
  const heldIds = new Set(held);
  for (const id of heldIds) if (gradedIds.includes(id)) { out.held += 1; seen.add(id); }
  for (const s of [...skipped, ...waitingExtra]) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    const bucket = WAITING.has(s.code) ? out.waiting : out.skipped;
    bucket[s.code] = (bucket[s.code] ?? 0) + 1;
  }
  out.unaccounted = gradedIds.filter((id) => !seen.has(id));
  return out;
}

// ---- the silent-stall alarm ----

// Appends this run to ledger.runs (kept to 30) and says whether eligible notices existed but none went out for
// `n` runs in a row while nothing explains it (no pause, no cap, no gap).
export function recordRun(ledger, run, keep = 30) {
  ledger.runs ??= [];
  ledger.runs.push(run);
  if (ledger.runs.length > keep) ledger.runs.splice(0, ledger.runs.length - keep);
}
export function stalled(ledger, n = 2) {
  const last = (ledger.runs ?? []).slice(-n);
  return last.length === n && last.every((r) => r.live && r.eligible > 0 && r.sent === 0 && !r.explained);
}
