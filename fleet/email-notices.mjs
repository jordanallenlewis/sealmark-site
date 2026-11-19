// Private email notices for security findings held back from public owner issues, for the repositories GitHub private
// vulnerability reporting cannot reach (fleet/private-reports.mjs covers the ones that have it on). Rebuilt from the
// design of the closed PR #40. This module finds a contact, renders the plain-text notice, picks which repositories may be
// mailed now and sends through the Worker's /api/owner-mail route (sender security@notify.sealmark.dev, replies to the
// disclosure mailbox). Never commit a queue, a draft or an address; this repository is public: the ledger keeps only a
// keyed hash of the repository (ledger.ownerMail), never an address, and nothing here logs a name or an address.
// Policy: https://sealmark.dev/disclosure/ (14 days to reply, one reminder, publication at a fix or day 90).
//
// Contact, in this order: the security contact in the repository's SECURITY.md; the npm or PyPI maintainer address;
// the owner's public GitHub profile address. Never a commit address. GitHub private vulnerability reporting is
// recorded separately (pvr) and filed in addition where it is enabled.
import { alreadyReported, candidates, repoHash } from "./private-reports.mjs";
import { budget } from "./owner-limits.mjs";

export const REPLY_DAYS = 14;
export const REMIND_DAYS = 14; // the published policy: no reply in 14 days, one reminder through the same channel
export const PUBLISH_DAYS = 90;
const DAY = 86_400_000;
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const BAD = /(^|[.@-])(noreply|no-reply|donotreply)|@users\.noreply\.github\.com$|@(example\.(com|org|net)|localhost)$|\.(internal|local|test|invalid|localhost|example)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const clean = (list) => [...new Set(list.map((e) => e.replace(/[.,;:)\]>]+$/, "").toLowerCase()))].filter((e) => !BAD.test(e));

/** Addresses named in a SECURITY.md. @param {string|null|undefined} text */
export function parseSecurityMd(text) {
  const t = String(text ?? "");
  // a line about reporting a vulnerability; not a thank-you or hall-of-fame line, and not one that says where NOT to report
  const SKIP = /\b(thanks?|thank you|credit|acknowledg|hall of fame|reported by|discovered by|found by|cve-\d|do not|don'?t|never|instead of|rather than|not to)\b/i;
  const about = t.split(/\r?\n/).filter((l) => /secur|vulnerab|disclos|report|\bcontact\b/i.test(l) && !SKIP.test(l)).join("\n");
  const noUrls = about.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, (u) => u.replace(/\/\/[^@/\s]*@/, "//")); // user:pass@host in a URL is not an address
  return { emails: clean(noUrls.match(EMAIL) ?? []), route: /advisor|hackerone|bugcrowd|https?:\/\/\S+/i.test(t) };
}

/** The package author's address, else the first maintainer's, in npm package metadata. Never a contributor, a bot or a no-reply address. */
export function emailFromNpm(meta) {
  const all = [meta?.author, ...(meta?.maintainers ?? [])].map((p) => p?.email).filter(Boolean); // the package author is the intended contact; never a contributor
  return clean(all).filter((e) => !/(^|[.@-])(bot|ci|actions?|github-actions|release|noreply)([.@-]|$)/i.test(e))[0] ?? null;
}

/** Author or maintainer address in PyPI JSON metadata. */
export function emailFromPypi(meta) {
  const raw = [meta?.info?.author_email, meta?.info?.maintainer_email].filter(Boolean).join(" ");
  return clean(raw.match(EMAIL) ?? [])[0] ?? null;
}

/**
 * @param {{repo: string|null, ecosystem?: string, pkg?: string}} x
 * @param {{get: (url: string) => Promise<any>}} deps get returns parsed JSON, or {missing: true}; for file contents {text}.
 * @returns {Promise<{channel: "security-policy"|"security-policy-link"|"package-maintainer"|"github-profile"|"none", email: string|null, pvr: boolean|null}>}
 */
export async function resolveContact({ repo, ecosystem, pkg }, { get }) {
  // a 404 is "not there" and falls through to the next source; any other failure (rate limit, 5xx, network) throws, so a repository's
  // designated contact is never skipped because a lookup failed: the caller skips this run and tries again next run
  const safe = async (url) => (await get(url)) ?? { missing: true };
  let pvr = null;
  if (repo) {
    const r = await safe(`https://api.github.com/repos/${repo}/private-vulnerability-reporting`);
    pvr = r.missing ? null : r.enabled === true;
    for (const path of ["SECURITY.md", ".github/SECURITY.md", "docs/SECURITY.md"]) {
      const f = await safe(`https://api.github.com/repos/${repo}/contents/${path}`);
      if (f.missing) continue;
      const md = parseSecurityMd(f.text);
      if (md.emails.length) return { channel: "security-policy", email: md.emails[0], pvr };
      if (md.route) return { channel: "security-policy-link", email: null, pvr }; // the policy names a form or advisory route: follow it by hand
    }
  }
  if (pkg) {
    const url = ecosystem === "pypi" ? `https://pypi.org/pypi/${pkg}/json` : `https://registry.npmjs.org/${pkg}/latest`;
    const m = await safe(url);
    const e = m.missing ? null : ecosystem === "pypi" ? emailFromPypi(m) : emailFromNpm(m);
    if (e) return { channel: "package-maintainer", email: e, pvr };
  }
  if (repo) {
    const u = await safe(`https://api.github.com/users/${repo.split("/")[0]}`);
    const e = u.missing ? null : clean(u.email ? [u.email] : [])[0] ?? null;
    if (e) return { channel: "github-profile", email: e, pvr };
  }
  return { channel: "none", email: null, pvr };
}

/** The plain-text notice for one held repository. No HTML, no links that track. */
/** The short reminder, sent once, day REMIND_DAYS if no reply is recorded. The same plain-text rules. */
export function renderReminder({ entry, replyTo }) {
  const names = entry.servers.filter((s) => s.security.length).map((s) => `${s.name} ${s.version}`).join(", ");
  return { subject: `Reminder: private security report for ${entry.repo ?? names}`, text: [
    `Hello,`,
    `Two weeks ago I sent you a private report from Sealmark about ${names}. This is the one reminder; I will not send another.`,
    `The report, the command that reproduces it and the policy are in the first message and at https://sealmark.dev/disclosure/. Please reply (to ${replyTo}); if I hear nothing I publish the details once a fixed version is out or on day ${PUBLISH_DAYS}, whichever comes first. If the result is wrong, tell me and I will recheck it.`,
    `Jordan Allen Lewis\nSealmark (https://sealmark.dev)`,
  ].join("\n\n") + "\n" };
}

export function renderNotice({ entry, replyTo, today }) {
  const servers = entry.servers.filter((s) => s.security.length);
  const names = servers.map((s) => `${s.name} ${s.version}`).join(", ");
  const blocks = servers.map((s) => [
    `${s.name} ${s.version} (tested ${s.testedAt}, grade ${s.letter ?? "not graded"})`,
    ...s.security.map((c) => `  - ${c.label} [${c.id}]: ${c.summary}`),
    `  Reproduce it yourself: ${s.rerun}`,
    `  Full result: ${s.results}`,
  ].join("\n")).join("\n\n");
  const text = [
    `Hello,`,
    `I run Sealmark (https://sealmark.dev), an open-source test suite that starts an MCP server, calls its tools with fixed inputs and records what it actually did. An automated run of ${names} found behavior in your repository (${entry.repo ?? "package listed above"}) that looks like a security problem. I am writing to you privately first, and I will not post it anywhere public before you have had a chance to respond.`,
    `What the run found:\n\n${blocks}`,
    `The run is deterministic and uses no AI model, so the command above should show you the same result. It can be wrong; if you think it is, tell me and I will recheck it. This is the only automated message Sealmark sends about this repository apart from the one reminder after 14 days; to stop all Sealmark messages to you, reply "opt out".`,
    `Timeline: please reply within ${REPLY_DAYS} days. If I have not heard from you by then I will send one reminder. I publish the details when a fixed version is out or on day ${PUBLISH_DAYS}, whichever comes first. If you need longer, say so and we can talk.`,
    `The policy is at https://sealmark.dev/disclosure/. This message has no tracking in it. Reply to this email (it goes to ${replyTo}) to reach me.`,
    `Jordan Allen Lewis\nSealmark (https://sealmark.dev)`,
  ].join("\n\n") + "\n";
  return { subject: `Private security report for ${entry.repo ?? names}: Sealmark test results`, text };
}

// answers that mean nothing was sent (the Worker answers them before it sends); a timeout, a 5xx or an unreadable answer may have gone out
export const DEFINITE = [400, 401, 403, 404, 413, 422, 429];
export const SENDER = { email: "security@notify.sealmark.dev", name: "Sealmark security notices" };
export const EMAIL_DEFAULTS = { perRun: 1, perDay: 2, perWeek: 7, gapMinutes: 60 };
const cap = (v, d) => { const t = String(v ?? "").trim(); if (t === "0") return 0; const n = Number(t || NaN); return Number.isInteger(n) && n >= 1 ? n : d; };
/** Caps like the public issue channel: 1 a run, 2 a day, 7 a week, an hour apart. A 0 pauses by hand; a malformed value keeps the default. */
export const emailLimitsFrom = (env = {}) => ({
  perRun: cap(env.OWNER_EMAIL_PER_RUN, EMAIL_DEFAULTS.perRun), perDay: cap(env.OWNER_EMAIL_PER_DAY, EMAIL_DEFAULTS.perDay),
  perWeek: cap(env.OWNER_EMAIL_PER_WEEK, EMAIL_DEFAULTS.perWeek), gapMinutes: Math.max(30, cap(env.OWNER_EMAIL_GAP_MINUTES, EMAIL_DEFAULTS.gapMinutes)), // never below 30: a 0 here would remove the spacing
  ownerDays: 7, activeDays: 180,
});

/**
 * Held repositories that may be mailed now: the same rules as the private-report path (fresh and stable grade, latest
 * version, not opted out, not ours, not already sent), except that a repository where private vulnerability reporting
 * is ON is left to that path. The ledger list is ledger.ownerMail. Pure.
 */
export function emailCandidates(entries, ctx) {
  const key = ctx.key ?? "";
  const skippedHere = [];
  const eligible = entries.filter((e) => {
    if (!e.repo) return true; // candidates() names it "no repository"
    if (ctx.pvr[e.repo] === true) { skippedHere.push({ repo: e.repo, why: "private vulnerability reporting is on: sent there" }); return false; }
    if (ctx.pvr[e.repo] !== false) { skippedHere.push({ repo: e.repo, why: "whether private vulnerability reporting is on could not be read; waits for a clear answer" }); return false; }
    if (alreadyReported(ctx.ledger, e.repo, key)) { skippedHere.push({ repo: e.repo, why: "already reported through private vulnerability reporting" }); return false; }
    const ids = e.servers.filter((x) => x.security.length).map((x) => repoHash("id:" + x.id, key));
    if ((ctx.ledger.ownerMail ?? []).some((r) => (r.sv ?? []).some((v) => ids.includes(v)))) { skippedHere.push({ repo: e.repo, why: "already reported (same server under another repository name)" }); return false; }
    return true;
  });
  const pvr = Object.fromEntries(eligible.filter((e) => e.repo).map((e) => [e.repo, true])); // candidates() wants true to proceed
  const out = candidates(eligible, { ...ctx, pvr, ledger: { private: ctx.ledger.ownerMail ?? [] } });
  // one notice per owner (user or organisation) per ownerDays, whatever their repositories: a keyed hash of the owner
  const days = ctx.limits?.ownerDays ?? 7, today = Date.parse(ctx.today);
  const busy = new Set((ctx.ledger.ownerMail ?? []).filter((r) => r.o && !r.noContact && today - Date.parse(r.at) < days * DAY).map((r) => r.o));
  const taken = new Set();
  const ready = [];
  for (const e of out.ready) {
    const o = repoHash(String(e.repo).split("/")[0], key);
    if (busy.has(o) || taken.has(o)) { out.skipped.push({ repo: e.repo, why: "another repository of the same owner was notified in the last 7 days or is ahead of it" }); continue; }
    taken.add(o); ready.push(e);
  }
  return { ready, skipped: [...out.skipped, ...skippedHere] };
}

/** True when this repository has an email record (sent, or intent written). Keyed hash, 14-day retry window for a refusal. */
export const alreadyEmailed = (ledger, repo, key = "", now = Date.now()) => (ledger.ownerMail ?? []).some((r) => r.h === repoHash(repo, key) && !(r.retryAfter && Date.parse(r.retryAfter) <= now));

/**
 * Mails the ready notices. `contactFor(entry)` resolves {channel, email}; `post({to, subject, text})` calls the Worker and
 * throws an Error with `.status`. Never throws. Each send is recorded (hash only) and pushed before the request. A
 * repository with no usable email is recorded as `{h, noContact: true, retryAfter}` so it is not looked up every run.
 * Returns {sent, noContact, stopped}.
 */
export async function sendNotices({ ready, ledger, now, limits, key, contactFor, post, save, persist = async () => {}, sleep, log }) {
  const room = budget({ ledger: { issues: (ledger.ownerMail ?? []).filter((r) => !r.noContact), pause: ledger.ownerMailPause }, now, limits });
  const out = { sent: 0, noContact: 0, lookupFailed: 0, stopped: null, room };
  const today = new Date(now).toISOString().slice(0, 10);
  let tried = 0;
  for (const entry of ready) {
    if (tried >= room.allow) break;
    const h = repoHash(entry.repo, key);
    let c;
    try { c = await contactFor(entry); } catch { out.lookupFailed += 1; continue; } // a failed lookup is not "no contact": nothing is recorded, the next run tries again
    if (!c.email) {
      (ledger.ownerMail ??= []).push({ h, at: today, noContact: c.channel, retryAfter: new Date(now + 14 * DAY).toISOString() });
      out.noContact += 1; save(); continue;
    }
    if (tried > 0) await sleep(60_000);
    tried += 1;
    const n = renderNotice({ entry, replyTo: "disclosure@sealmark.dev", today });
    const rec = { h, at: today, postedAt: new Date(now).toISOString(), channel: c.channel, remindAfter: addDays(today, REMIND_DAYS), replyBy: addDays(today, REPLY_DAYS), ref: h, o: repoHash(String(entry.repo).split("/")[0], key), sv: entry.servers.filter((x) => x.security.length).map((x) => repoHash("id:" + x.id, key)), intent: true };
    (ledger.ownerMail ??= []).push(rec);
    save();
    try { await persist(); } catch (e) { ledger.ownerMail.pop(); save(); out.stopped = "persist"; log(`::error::the ledger could not be pushed before an email notice (${String(e.message ?? e).slice(0, 80)}); nothing is sent`); break; }
    try {
      await post({ to: c.email, subject: n.subject, text: n.text, ref: h });
      delete rec.intent; out.sent += 1; save();
    } catch (e) {
      const status = Number(e.status ?? NaN);
      log(`::warning::an email notice failed (${Number.isFinite(status) ? status : "error"}); not named here`);
      // a definite refusal sent nothing (the Worker answers 4xx before it sends): take the intent back. A timeout or a 5xx may have sent: the record stays.
      if (DEFINITE.includes(status)) { ledger.ownerMail.splice(ledger.ownerMail.indexOf(rec), 1); }
      save();
      out.stopped = e.dry ? "dry" : String(Number.isFinite(status) ? status : "error");
      break;
    }
  }
  return out;
}

/** Reminders due now: a sent notice, past remindAfter, not yet reminded, not marked replied or opted out. One reminder, never a second. */
export function remindersDue(ledger, today, replied = []) {
  const got = new Set(replied);
  return (ledger.ownerMail ?? []).filter((r) => r.channel && !r.intent && !r.reminded && !r.replied && !got.has(r.h) && r.remindAfter && r.remindAfter <= today);
}

/**
 * Sends the one reminder for notices past their day-7. The address is not stored, so the contact is resolved again from the
 * held entry whose keyed hash matches. Counts against the same caps (a `{h, postedAt, reminder: true}` record). Never throws.
 */
export async function sendReminders({ entries, ledger, now, limits, key, contactFor, post, save, persist = async () => {}, sleep, log, replied = [], optout = { repos: [] } }) {
  const today = new Date(now).toISOString().slice(0, 10);
  const due = remindersDue(ledger, today, replied);
  const room = budget({ ledger: { issues: (ledger.ownerMail ?? []).filter((r) => !r.noContact), pause: ledger.ownerMailPause }, now, limits });
  const opted = new Set((optout.repos ?? []).map((r) => r.toLowerCase()));
  const optedOwners = new Set([...opted].map((r) => r.split("/")[0]));
  let sent = 0;
  for (const rec of due) {
    if (sent >= room.allow) break;
    const entry = entries.find((e) => e.repo && repoHash(e.repo, key) === rec.h);
    if (!entry) continue; // no longer held (fixed, repository gone): no reminder
    if (opted.has(entry.repo.toLowerCase()) || optedOwners.has(entry.repo.split("/")[0].toLowerCase())) continue; // asked us to stop
    let c;
    try { c = await contactFor(entry); } catch { c = null; }
    if (!c?.email) continue;
    if (sent > 0) await sleep(60_000);
    rec.reminded = today;
    const stamp = { h: rec.h, at: today, postedAt: new Date(now).toISOString(), reminder: true, intent: true };
    ledger.ownerMail.push(stamp); save();
    try { await persist(); } catch { ledger.ownerMail.pop(); delete rec.reminded; save(); log("::error::the ledger could not be pushed before a reminder; nothing is sent"); break; }
    try {
      const n = renderReminder({ entry, replyTo: "disclosure@sealmark.dev" });
      await post({ to: c.email, subject: n.subject, text: n.text, ref: rec.h });
      delete stamp.intent; sent += 1; save();
    } catch (e) {
      const status = Number(e.status ?? NaN);
      log(`::warning::an email reminder failed (${Number.isFinite(status) ? status : "error"}); not named here`);
      if (DEFINITE.includes(status)) { ledger.ownerMail.splice(ledger.ownerMail.indexOf(stamp), 1); delete rec.reminded; }
      save(); break;
    }
  }
  return { sent };
}
