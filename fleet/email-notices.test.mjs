// node --test fleet/private-notices.test.mjs   Private email notices for held security findings. No network, no files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REMIND_DAYS, REPLY_DAYS, PUBLISH_DAYS, parseSecurityMd, emailFromNpm, emailFromPypi, resolveContact, renderNotice, renderReminder, emailCandidates, emailLimitsFrom, sendNotices, sendReminders, remindersDue, alreadyEmailed, SENDER } from "./email-notices.mjs";

const entry = {
  repo: "acme/widget-mcp",
  servers: [{ id: "widget", name: "widget-mcp", version: "1.2.0", testedAt: "2026-11-12", letter: "D", rerun: "npx -y sealmark@1.0.0 run --start \"npx -y widget-mcp@1.2.0\"", results: "https://sealmark.dev/results/widget/",
    security: [{ id: "net-loopback-ssrf", label: "Loopback requests", verdict: "fail", summary: "fetched http://127.0.0.1:PORT/" }], otherFailing: [] }],
};

test("parseSecurityMd takes a mailto or plain address and ignores noreply and example addresses", () => {
  assert.deepEqual(parseSecurityMd("Report to [us](mailto:sec@acme.io) or noreply@github.com or you@example.com").emails, ["sec@acme.io"]);
  assert.deepEqual(parseSecurityMd("Email security@acme.io.").emails, ["security@acme.io"]);
  assert.equal(parseSecurityMd("Use the Report a vulnerability button").emails.length, 0);
  assert.equal(parseSecurityMd(null).emails.length, 0);
});

test("package metadata: npm maintainers and author, PyPI author", () => {
  assert.equal(emailFromNpm({ maintainers: [{ name: "a", email: "m@acme.io" }] }), "m@acme.io");
  assert.equal(emailFromNpm({ author: { email: "x@acme.io" }, maintainers: [] }), "x@acme.io");
  assert.equal(emailFromNpm({ maintainers: [{ email: "a@users.noreply.github.com" }] }), null);
  assert.equal(emailFromPypi({ info: { author_email: "Jo <jo@acme.io>" } }), "jo@acme.io");
  assert.equal(emailFromPypi({ info: {} }), null);
});

test("parseSecurityMd ignores addresses in config examples and keeps lines about reporting", () => {
  const md = "Connect with postgres://user:pass@db.internal:5432/x\n\n## Reporting\nSend vulnerability reports to sec@acme.io\n\nDemo login admin@demo.local";
  assert.deepEqual(parseSecurityMd(md).emails, ["sec@acme.io"]);
  assert.equal(parseSecurityMd("Maintained by bob@acme.io, thanks").emails.length, 0, "an address on a line that is not about security is not a security contact");
});

test("a SECURITY.md with a link or advisory route but no address is the channel; no fallback to a package address", async () => {
  const get = fake({
    "https://api.github.com/repos/acme/w/contents/SECURITY.md": { text: "Report through GitHub private vulnerability reporting: https://github.com/acme/w/security/advisories/new" },
    "https://registry.npmjs.org/w/latest": { maintainers: [{ email: "old@acme.io" }] },
  });
  const c = await resolveContact({ repo: "acme/w", ecosystem: "npm", pkg: "w" }, { get });
  assert.deepEqual([c.channel, c.email], ["security-policy-link", null]);
});

const fake = (map) => async (url) => (url in map ? map[url] : { missing: true });

test("resolveContact order: SECURITY.md, then package maintainer, then public profile; never a commit email", async () => {
  const base = { repo: "acme/widget-mcp", ecosystem: "npm", pkg: "widget-mcp" };
  const profile = { "https://api.github.com/users/acme": { email: "owner@acme.io", type: "User" } };
  const npm = { "https://registry.npmjs.org/widget-mcp/latest": { maintainers: [{ email: "m@acme.io" }] } };
  const sec = { "https://api.github.com/repos/acme/widget-mcp/contents/SECURITY.md": { text: "Report vulnerabilities to sec@acme.io" } };
  let c = await resolveContact(base, { get: fake({ ...profile, ...npm, ...sec }) });
  assert.deepEqual([c.channel, c.email], ["security-policy", "sec@acme.io"]);
  c = await resolveContact(base, { get: fake({ ...profile, ...npm }) });
  assert.deepEqual([c.channel, c.email], ["package-maintainer", "m@acme.io"]);
  c = await resolveContact(base, { get: fake({ ...profile }) });
  assert.deepEqual([c.channel, c.email], ["github-profile", "owner@acme.io"]);
  c = await resolveContact(base, { get: fake({}) });
  assert.equal(c.channel, "none");
  assert.equal(c.email, null);
});

test("resolveContact records private vulnerability reporting separately from the email channel", async () => {
  const c = await resolveContact({ repo: "acme/w", ecosystem: "npm", pkg: "w" }, { get: fake({ "https://api.github.com/repos/acme/w/private-vulnerability-reporting": { enabled: true } }) });
  assert.equal(c.pvr, true);
  assert.equal(c.channel, "none");
});

test("renderNotice is plain text with the finding, repro, disclosure link, 14 days, one reminder, day 90, no tracking", () => {
  const { subject, text } = renderNotice({ entry, replyTo: "disclosure@sealmark.dev", today: "2026-11-14" });
  assert.match(subject, /widget-mcp/);
  assert.match(text, /Loopback requests/);
  assert.match(text, /npx -y sealmark@1\.0\.0 run --start/);
  assert.match(text, /https:\/\/sealmark\.dev\/disclosure\//);
  assert.match(text, new RegExp(`${REPLY_DAYS} days`));
  assert.match(text, /one reminder/);
  assert.match(text, /reply "opt out"/);
  assert.match(text, new RegExp(`day ${PUBLISH_DAYS}`));
  assert.match(text, /disclosure@sealmark\.dev/);
  assert.doesNotMatch(text, /<[a-z]+[ >]/i);
  assert.doesNotMatch(text, /utm_|pixel|track(ing)? link/i);
  assert.equal(REMIND_DAYS, REPLY_DAYS, "the published policy: no reply in 14 days, then one reminder");
});

import { repoHash } from "./private-reports.mjs";

const KEY = "k";
const NOW = Date.parse("2026-11-20T12:00:00Z");
const held = (repo) => ({ repo, servers: [{ ...entry.servers[0], id: `${repo}-s`, fresh: true, stale: null }] });
const ctx = (es, over = {}) => ({
  pvr: Object.fromEntries(es.map((e) => [e.repo, false])),
  byId: new Map(es.flatMap((e) => e.servers).map((x) => [x.id, { id: x.id, versionTested: x.version }])),
  ledger: { ownerMail: [] }, optout: { repos: [] }, today: "2026-11-20", self: ["jordanallenlewis"], limits: emailLimitsFrom({}), key: KEY, facts: {},
  history: es.flatMap((e) => ["2026-11-10", "2026-11-12"].map((d) => ({ id: e.servers[0].id, version: "1.2.0", testedAt: d, status: "ok", worst: "D", packs: {} }))),
  ...over,
});

test("the sender is a Sealmark address on the notification subdomain, never a personal one", () => {
  assert.equal(SENDER.email, "security@notify.sealmark.dev");
  assert.doesNotMatch(JSON.stringify(SENDER), /gmail|jordanallenlewis/i);
});

test("limits: caps like the issue channel (1 a run, 2 a day, 7 a week, an hour apart); a 0 pauses; junk keeps the default", () => {
  assert.deepEqual(emailLimitsFrom({}), { perRun: 1, perDay: 2, perWeek: 7, gapMinutes: 60, ownerDays: 7, activeDays: 180 });
  assert.equal(emailLimitsFrom({ OWNER_EMAIL_PER_DAY: "0" }).perDay, 0);
  assert.equal(emailLimitsFrom({ OWNER_EMAIL_PER_DAY: "many" }).perDay, 2);
});

test("emailCandidates: a repository without private reporting goes; one with it on is left to that path; opted out, ours and already emailed are skipped", () => {
  const es = ["a/open", "b/haspvr", "c/optout", "jordanallenlewis/own", "d/done", "e/unknown"].map(held);
  const c = ctx(es, { pvr: { "a/open": false, "b/haspvr": true, "c/optout": false, "jordanallenlewis/own": false, "d/done": false, "e/unknown": null }, optout: { repos: ["c/optout"] }, ledger: { ownerMail: [{ h: repoHash("d/done", KEY), at: "2026-11-18" }] } });
  const out = emailCandidates(es, c);
  assert.deepEqual(out.ready.map((e) => e.repo).sort(), ["a/open"]);
  const why = Object.fromEntries(out.skipped.map((k) => [k.repo, k.why]));
  assert.match(why["b/haspvr"], /private vulnerability reporting is on/);
  assert.match(why["c/optout"], /opted out/);
  assert.match(why["jordanallenlewis/own"], /our own/);
  assert.match(why["d/done"], /already reported/);
  assert.match(why["e/unknown"], /could not be read/);
});

test("an emailed repository is not mailed again, but a no-contact record is retried after 14 days", () => {
  const l = { ownerMail: [{ h: repoHash("a/x", KEY), at: "2026-11-01", noContact: "none", retryAfter: "2026-11-15T00:00:00.000Z" }] };
  assert.equal(alreadyEmailed(l, "a/x", KEY, NOW), false);
  assert.equal(alreadyEmailed(l, "a/x", KEY, Date.parse("2026-11-10T00:00:00Z")), true);
  assert.equal(alreadyEmailed({ ownerMail: [{ h: repoHash("a/y", KEY), at: "2026-11-19" }] }, "a/y", KEY, NOW), true);
});

const run = async (over = {}) => {
  const ledger = over.ledger ?? { ownerMail: [] };
  const posted = [], logs = [], saves = [];
  const out = await sendNotices({ ready: over.ready ?? [held("a/one"), held("b/two")], ledger, now: NOW, limits: emailLimitsFrom({}), key: KEY,
    contactFor: over.contactFor ?? (async () => ({ channel: "package-maintainer", email: "m@acme.io" })),
    post: over.post ?? (async (m) => { posted.push(m); }), save: () => saves.push(JSON.stringify(ledger)), persist: over.persist, sleep: async () => {}, log: (l) => logs.push(l) });
  return { out, ledger, posted, logs, saves };
};

test("sendNotices: one a run under the default cap; the record holds a keyed hash, a channel and dates, never an address or a name", async () => {
  const { out, ledger, posted } = await run();
  assert.equal(out.sent, 1);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].to, "m@acme.io");
  assert.match(posted[0].text, /disclosure@sealmark\.dev/);
  assert.deepEqual(Object.keys(ledger.ownerMail[0]).sort(), ["at", "channel", "h", "o", "postedAt", "ref", "remindAfter", "replyBy", "sv"]);
  assert.equal(ledger.ownerMail[0].remindAfter, "2026-12-04");
  assert.equal(ledger.ownerMail[0].replyBy, "2026-12-04");
  assert.doesNotMatch(JSON.stringify(ledger), /@|a\/one/);
});

test("sendNotices: the intent is saved and pushed before the request; a failed push sends nothing", async () => {
  const order = [];
  await run({ persist: async () => { order.push("persist"); }, post: async () => { order.push("post"); } });
  assert.deepEqual(order, ["persist", "post"]);
  const r = await run({ persist: async () => { throw new Error("push rejected"); } });
  assert.equal(r.posted.length, 0);
  assert.equal(r.out.stopped, "persist");
  assert.equal(r.ledger.ownerMail.length, 0, "the intent was taken back");
});

test("sendNotices: no usable contact sends nothing, is remembered for 14 days, and does not use up a send", async () => {
  const r = await run({ contactFor: async (e) => (e.repo === "a/one" ? { channel: "none", email: null } : { channel: "github-profile", email: "o@acme.io" }) });
  assert.equal(r.out.noContact, 1);
  assert.equal(r.out.sent, 1);
  assert.deepEqual(r.posted.map((m) => m.to), ["o@acme.io"]);
  assert.equal(r.ledger.ownerMail[0].noContact, "none");
});

test("sendNotices: a definite refusal takes the intent back and stops; a timeout keeps it (it may have gone out)", async () => {
  const refuse = await run({ post: async () => { throw Object.assign(new Error("x"), { status: 429 }); } });
  assert.equal(refuse.ledger.ownerMail.length, 0);
  assert.equal(refuse.out.stopped, "429");
  const timeout = await run({ post: async () => { throw Object.assign(new Error("x"), { status: 502 }); } });
  assert.equal(timeout.ledger.ownerMail.length, 1);
  assert.equal(timeout.ledger.ownerMail[0].intent, true);
  assert.equal(timeout.out.stopped, "502");
});

test("sendNotices: the daily cap holds across runs, and a pause sends nothing", async () => {
  const stamp = (h) => ({ h, at: "2026-11-20", postedAt: "2026-11-20T08:00:00.000Z", channel: "x" });
  const l = { ownerMail: [stamp("1"), stamp("2")] };
  assert.equal((await run({ ledger: l })).out.sent, 0);
  const p = { ownerMail: [], ownerMailPause: { until: new Date(NOW + 3600e3).toISOString(), code: "x", reason: "y" } };
  assert.equal((await run({ ledger: p })).out.sent, 0);
});

test("reminders: one, after day 14, only when no reply is recorded; the address is resolved again and the text is plain", async () => {
  const sent = (h, extra = {}) => ({ h, at: "2026-11-10", postedAt: "2026-11-10T09:00:00.000Z", channel: "package-maintainer", remindAfter: "2026-11-17", replyBy: "2026-11-24", ...extra });
  const ledger = { ownerMail: [sent(repoHash("a/one", KEY)), sent(repoHash("b/two", KEY), { replied: true }), sent(repoHash("c/three", KEY), { reminded: "2026-11-18" }), sent(repoHash("d/four", KEY), { remindAfter: "2026-12-01" }), sent(repoHash("e/five", KEY), { intent: true })] };
  assert.equal(remindersDue(ledger, "2026-11-20").length, 1);
  const posted = [];
  const r = await sendReminders({ entries: ["a/one", "b/two", "c/three", "d/four", "e/five"].map(held), ledger, now: NOW, limits: emailLimitsFrom({}), key: KEY, contactFor: async () => ({ channel: "x", email: "m@acme.io" }), post: async (m) => posted.push(m), save() {}, sleep: async () => {}, log() {} });
  assert.equal(r.sent, 1);
  assert.match(posted[0].subject, /^Reminder:/);
  assert.match(posted[0].text, /this is the one reminder/i);
  assert.doesNotMatch(posted[0].text, /<[a-z]+[ >]/i);
  assert.equal(remindersDue(ledger, "2026-11-20").length, 0, "never a second reminder");
  assert.equal(ledger.ownerMail.at(-1).reminder, true);
  assert.doesNotMatch(JSON.stringify(ledger), /@/);
});

test("a reminder is skipped when the repository is no longer held (fixed, opted out, gone)", async () => {
  const ledger = { ownerMail: [{ h: repoHash("a/one", KEY), at: "2026-11-10", postedAt: "2026-11-10T09:00:00.000Z", channel: "x", remindAfter: "2026-11-17", replyBy: "2026-11-24" }] };
  const posted = [];
  const r = await sendReminders({ entries: [], ledger, now: NOW, limits: emailLimitsFrom({}), key: KEY, contactFor: async () => ({ email: "m@acme.io" }), post: async (m) => posted.push(m), save() {}, sleep: async () => {}, log() {} });
  assert.equal(r.sent, 0);
  assert.equal(posted.length, 0);
});

test("a no-contact record does not use up the send caps or start the gap", async () => {
  const l = { ownerMail: [{ h: "1", at: "2026-11-20", noContact: "none", retryAfter: "2026-12-04T00:00:00.000Z" }, { h: "2", at: "2026-11-20", noContact: "none", retryAfter: "2026-12-04T00:00:00.000Z" }] };
  assert.equal((await run({ ledger: l })).out.sent, 1);
});

test("SECURITY.md: a thank-you line or a line that says where NOT to report is never the contact (reviewer probes)", () => {
  assert.equal(parseSecurityMd("Thanks to alice@researcher.io for reporting CVE-2024-1").emails.length, 0);
  assert.equal(parseSecurityMd("Do not report security issues to support@acme.com; use https://github.com/acme/w/security/advisories/new").emails.length, 0);
  assert.deepEqual(parseSecurityMd("## Reporting\nSend vulnerability reports to sec@acme.io\n\nThanks to bob@x.io for the report").emails, ["sec@acme.io"]);
});

test("npm: the author, else the first maintainer; never a contributor, a bot or a no-reply address", () => {
  assert.equal(emailFromNpm({ contributors: [{ email: "drive@by.io" }] }), null);
  assert.equal(emailFromNpm({ author: { email: "me@acme.io" }, maintainers: [{ email: "other@acme.io" }] }), "me@acme.io");
  assert.equal(emailFromNpm({ maintainers: [{ email: "ci@acme.io" }, { email: "real@acme.io" }] }), "real@acme.io");
});

test("a failed lookup (rate limit, 5xx) is not 'no file': it throws instead of falling through to another address", async () => {
  const get = async (url) => { if (url.includes("SECURITY.md")) throw new Error("GitHub 503"); return url.includes("registry.npmjs.org") ? { maintainers: [{ email: "m@acme.io" }] } : { missing: true }; };
  await assert.rejects(() => resolveContact({ repo: "acme/w", ecosystem: "npm", pkg: "w" }, { get }), /503/);
});

test("sendNotices: a failed lookup records nothing and sends nothing; the next run tries again", async () => {
  const r = await run({ contactFor: async () => { throw new Error("rate limited"); } });
  assert.equal(r.out.sent, 0);
  assert.equal(r.out.lookupFailed, 2);
  assert.equal(r.ledger.ownerMail.length, 0);
});

test("one notice per owner per 7 days, and the same server is never mailed again under another repository name", () => {
  const es = ["acme/one", "acme/two", "other/three"].map(held);
  let out = emailCandidates(es, ctx(es));
  assert.deepEqual(out.ready.map((e) => e.repo), ["acme/one", "other/three"], "two repositories of one owner in one run: only the first");
  const prior = { ownerMail: [{ h: "zz", o: repoHash("other", KEY), at: "2026-11-18", channel: "x", postedAt: "2026-11-18T10:00:00.000Z" }] };
  out = emailCandidates(es, ctx(es, { ledger: prior }));
  assert.deepEqual(out.ready.map((e) => e.repo), ["acme/one"]);
  const renamed = held("acme/renamed");
  renamed.servers[0].id = "acme/one-s"; // the same server id, a new repository name
  out = emailCandidates([renamed], ctx([renamed], { ledger: { ownerMail: [{ h: "q", sv: [repoHash("id:acme/one-s", KEY)], at: "2026-11-01", channel: "x" }] } }));
  assert.match(out.skipped[0].why, /same server/);
});

test("a repository already given a private report is not also emailed", () => {
  const es = [held("a/x")];
  const out = emailCandidates(es, ctx(es, { ledger: { ownerMail: [], private: [{ h: repoHash("a/x", KEY), at: "2026-11-18" }] } }));
  assert.equal(out.ready.length, 0);
  assert.match(out.skipped[0].why, /private vulnerability reporting/);
});

test("the gap between notices cannot be set below 30 minutes", () => {
  assert.equal(emailLimitsFrom({ OWNER_EMAIL_GAP_MINUTES: "0" }).gapMinutes >= 30, true);
});

test("reminders skip an opted-out repository and a notice whose maintainer replied", async () => {
  const sent = (h) => ({ h, at: "2026-11-01", postedAt: "2026-11-01T09:00:00.000Z", channel: "x", remindAfter: "2026-11-15", replyBy: "2026-11-15" });
  const ledger = { ownerMail: [sent(repoHash("a/one", KEY)), sent(repoHash("b/two", KEY)), sent(repoHash("c/three", KEY))] };
  const posted = [];
  const r = await sendReminders({ entries: ["a/one", "b/two", "c/three"].map(held), ledger, now: NOW, limits: emailLimitsFrom({}), key: KEY, contactFor: async () => ({ email: "m@acme.io" }), post: async (m) => posted.push(m), save() {}, sleep: async () => {}, log() {},
    replied: [repoHash("b/two", KEY)], optout: { repos: ["c/three"] } });
  assert.equal(r.sent, 1);
  assert.equal(posted.length, 1);
  assert.match(posted[0].ref, /^[0-9a-f]{16}$/);
});
