// node --test fleet/   The rules that keep owner notices from being spam (fleet/owner-limits.mjs). Pure, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY, HOUR, LIMIT_DEFAULTS, account, activity, applyNegative, backoffFor, budget, byPriority, limitsFrom, negativeSignals, ownersBusy, pauseState, priority, recordRun, setPause, stability, stalled } from "./owner-limits.mjs";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const L = { ...LIMIT_DEFAULTS };

test("limits: the conservative defaults, repository variables only raise or lower them, junk keeps the default, 0 pauses", () => {
  assert.deepEqual(limitsFrom({}), { perRun: 2, perDay: 6, perWeek: 30, ownerDays: 7, gapMinutes: 30, activeDays: 180 });
  const v = limitsFrom({ MAX_OWNER_ISSUES: "3", MAX_OWNER_ISSUES_PER_DAY: "4", MAX_OWNER_ISSUES_PER_WEEK: "10", OWNER_ISSUE_GAP_MINUTES: "45" });
  assert.deepEqual([v.perRun, v.perDay, v.perWeek, v.gapMinutes], [3, 4, 10, 45]);
  for (const junk of ["", "abc", "-1", "2.5", "  "]) assert.equal(limitsFrom({ MAX_OWNER_ISSUES_PER_DAY: junk }).perDay, 6, JSON.stringify(junk));
  assert.equal(limitsFrom({ MAX_OWNER_ISSUES_PER_DAY: "0" }).perDay, 0, "0 is a deliberate pause");
});

test("budget: per run, per day and per week caps, each in its own window", () => {
  assert.equal(budget({ ledger: { issues: [] }, now: NOW, limits: L }).allow, 2);
  const day = (n) => ({ issues: Array.from({ length: n }, (_, i) => ({ repo: `o${i}/r`, postedAt: ago(2 * HOUR + i * HOUR) })) });
  assert.equal(budget({ ledger: day(5), now: NOW, limits: L }).allow, 1, "6 a day: one left of 5 used");
  const full = budget({ ledger: day(6), now: NOW, limits: L });
  assert.deepEqual([full.allow, full.code], [0, "cap-day"]);
  assert.ok(full.nextAt > NOW && full.nextAt <= NOW + DAY, "the ETA is when the oldest of the day falls out");
  // 30 in the last 7 days, none in the last day
  const week = { issues: Array.from({ length: 30 }, (_, i) => ({ repo: `o${i}/r`, postedAt: ago(DAY + HOUR + i * 4 * HOUR) })) };
  assert.equal(budget({ ledger: week, now: NOW, limits: L }).code, "cap-week");
  assert.equal(budget({ ledger: { issues: [] }, now: NOW, limits: { ...L, perRun: 0 } }).code, "cap-run");
});

test("budget: at least the gap between two notices, across runs", () => {
  const b = budget({ ledger: { issues: [{ repo: "a/b", postedAt: ago(10 * 60_000) }] }, now: NOW, limits: L });
  assert.deepEqual([b.allow, b.code], [0, "spacing"]);
  assert.equal(b.nextAt, NOW + 20 * 60_000);
  assert.equal(budget({ ledger: { issues: [{ repo: "a/b", postedAt: ago(31 * 60_000) }] }, now: NOW, limits: L }).allow, 2);
});

test("ownersBusy: one notice per owner per 7 days, any repository of theirs, any case", () => {
  const busy = ownersBusy({ issues: [{ repo: "Acme/one", postedAt: ago(6 * DAY) }, { repo: "old/two", postedAt: ago(8 * DAY) }] }, NOW);
  assert.deepEqual([...busy.keys()], ["acme"]);
  assert.ok(busy.get("acme") > NOW && busy.get("acme") <= NOW + DAY);
});

test("pause: a timed pause ends by itself, a negative reaction pause only a person ends", () => {
  const ledger = { issues: [] };
  setPause(ledger, { code: "http-429", reason: "rate limit", now: NOW, hours: 24 });
  assert.equal(pauseState(ledger, NOW + HOUR).paused, true);
  assert.equal(pauseState(ledger, NOW + 25 * HOUR).paused, false);
  assert.equal(budget({ ledger, now: NOW + HOUR, limits: L }).code, "paused");
  setPause(ledger, { code: "negative-reaction", reason: "x", now: NOW, hours: null });
  setPause(ledger, { code: "http-429", reason: "later, shorter", now: NOW + HOUR, hours: 1 });
  assert.equal(ledger.pause.code, "negative-reaction", "a person-only pause is never replaced by a timed one");
  assert.equal(pauseState(ledger, NOW + 400 * DAY).paused, true);
  ledger.pause = null;
  assert.equal(pauseState(ledger, NOW).paused, false);
});

test("backoff: 403, 429, a rate limit and a rejected token pause; a per-repository failure does not", () => {
  for (const s of ["403", "429", "rate-limited"]) assert.equal(backoffFor(s).hours, 24, s);
  assert.equal(backoffFor("401").code, "http-401");
  for (const s of ["404", "422", "error", "repo"]) assert.equal(backoffFor(s), null, s);
});

test("negative reactions: removed, locked, closed as not planned, thumbs-down, or a stop / spam reply; ordinary replies are not", () => {
  const kinds = (x) => negativeSignals(x).map((n) => n.kind);
  assert.deepEqual(kinds({ issue: { missing: true } }), ["removed"]);
  assert.deepEqual(kinds({ issue: { gone: true } }), ["removed"]);
  assert.deepEqual(kinds({ issue: { locked: true, active_lock_reason: "spam" } }), ["locked-spam"]);
  assert.deepEqual(kinds({ issue: { locked: true, active_lock_reason: "resolved" } }), []);
  assert.deepEqual(kinds({ issue: { state: "closed", state_reason: "not_planned" } }), ["not-planned"]);
  assert.deepEqual(kinds({ issue: { state: "closed", state_reason: "completed" } }), [], "closed as completed is fine");
  assert.deepEqual(kinds({ issue: { state: "open", reactions: { "-1": 1 } } }), ["thumbs-down"]);
  assert.deepEqual(kinds({ issue: { state: "open", reactions: { "+1": 3, heart: 1 } } }), []);
  for (const body of ["please stop opening these", "this is spam", "Unsolicited.", "Not interested, please don't open issues here", "unsubscribe", "stop spamming us"]) assert.deepEqual(kinds({ issue: {}, people: [{ id: 1, body }] }), ["complaint"], body);
  for (const body of ["Fixed in 1.2, and I reported this upstream", "How do I stop this check from failing?", "the rate limiter prevents abuse of the API", "thanks, fixed in 1.2.1", "can you recheck? the result looks wrong", "> this is spam\nthanks, will look"]) assert.deepEqual(kinds({ issue: {}, people: [{ id: 1, body }] }), [], body);
  assert.deepEqual(kinds({ issue: {}, ours: [{ id: 5, reactions: { "-1": 1 } }] }), ["thumbs-down"], "a thumbs-down on a comment of ours");
  assert.deepEqual(kinds({ issue: {}, people: [{ id: 6, body: "nice", reactions: { "-1": 1 } }] }), [], "a thumbs-down on a person's own comment is not about us");
});

test("applyNegative: each signal is recorded once, a later different one pauses again after a person cleared the first", () => {
  const ledger = { issues: [] };
  const first = negativeSignals({ issue: { state: "open", reactions: { "-1": 1 } } });
  assert.equal(applyNegative(ledger, { repo: "a/b", number: 4, signals: first, now: NOW }).length, 1);
  assert.equal(pauseState(ledger, NOW).paused, true);
  assert.match(pauseState(ledger, NOW).reason, /a\/b#4/);
  ledger.pause = null; // a person reviewed it
  assert.equal(applyNegative(ledger, { repo: "A/B", number: 4, signals: first, now: NOW + DAY }).length, 0, "the same signal does not pause again");
  assert.equal(pauseState(ledger, NOW + DAY).paused, false);
  // the 2026-11-17 review: a recorded thumbs-down must not hide a later complaint on the same issue
  const complaint = negativeSignals({ issue: { state: "open", reactions: { "-1": 1 } }, people: [{ id: 99, body: "please stop spamming" }] });
  assert.equal(applyNegative(ledger, { repo: "a/b", number: 4, signals: complaint, now: NOW + DAY }).length, 1);
  assert.equal(pauseState(ledger, NOW + DAY).paused, true);
  ledger.pause = null;
  const second = negativeSignals({ issue: {}, people: [{ id: 100, body: "this is spam" }] });
  assert.equal(applyNegative(ledger, { repo: "a/b", number: 4, signals: second, now: NOW + DAY }).length, 1, "a second person's complaint is a new signal");
  assert.ok(applyNegative(ledger, { repo: "c/d", number: 1, signals: first, now: NOW + DAY }).length);
  assert.deepEqual(applyNegative(ledger, { repo: "x/y", number: 1, signals: [], now: NOW }), []);
});

test("budget: the real count read from GitHub is a floor; a stamp in the future counts as now", () => {
  assert.equal(budget({ ledger: { issues: [] }, now: NOW, limits: L, floor: { day: 6, week: 6 } }).code, "cap-day", "the ledger lost its commit; GitHub knows better");
  assert.equal(budget({ ledger: { issues: [] }, now: NOW, limits: L, floor: { day: 1, week: 30 } }).code, "cap-week");
  const skew = budget({ ledger: { issues: [{ repo: "a/b", postedAt: new Date(NOW + 5 * 60_000).toISOString() }] }, now: NOW, limits: L });
  assert.deepEqual([skew.code, skew.day], ["spacing", 1]);
  assert.ok(ownersBusy({ issues: [{ repo: "a/b", postedAt: new Date(NOW + 5 * 60_000).toISOString() }] }, NOW).has("a"));
});

test("stability: a grade is told only after the same version was graded twice with the same letters", () => {
  const s = { id: "a", versionTested: "1.0.0" };
  const run = (over = {}) => ({ id: "a", version: "1.0.0", status: "ok", worst: "B", packs: { core: "B" }, ...over });
  assert.equal(stability(s, []).code, "single-run");
  assert.equal(stability(s, [run()]).code, "single-run");
  assert.equal(stability(s, [run({ version: "0.9.0" }), run()]).code, "single-run", "another version does not count");
  assert.equal(stability(s, [run({ status: "failed" }), run()]).code, "single-run", "a failed run is not a grade");
  assert.equal(stability(s, [run(), run()]).ok, true);
  assert.equal(stability(s, [run(), run({ worst: "C", packs: { core: "C" } })]).code, "unstable");
  assert.equal(stability(s, [run({ packs: { core: "B", fs: "A" } }), run()]).code, "unstable", "same worst letter, different areas");
  assert.equal(stability(s, [run({ worst: "D", packs: { core: "D" } }), run(), run(), run()]).ok, true, "only the latest three are compared");
});

test("activity: pushed within 180 days; unknown stays unknown", () => {
  assert.equal(activity("2026-11-01T00:00:00Z", "2026-11-17").ok, true);
  assert.equal(activity("2026-05-01", "2026-11-17").ok, false);
  assert.match(activity("2025-01-01", "2026-11-17").reason, /no commit in/);
  assert.equal(activity(null, "2026-11-17").ok, null);
});

test("priority: the biggest fixable gap first, a failed check counts double, then the larger server", () => {
  const x = (id, tools) => ({ id, coverage: { toolsTotal: tools } });
  const many = priority(x("a", 3), "D", [{ verdict: "fail" }, { verdict: "part" }]);
  const few = priority(x("b", 50), "B", [{ verdict: "part" }]);
  assert.ok(byPriority({ ...many, id: "a" }, { ...few, id: "b" }) < 0);
  const big = { ...priority(x("c", 20), "B", [{ verdict: "part" }]), id: "c" };
  const small = { ...priority(x("d", 2), "B", [{ verdict: "part" }]), id: "d" };
  assert.ok(byPriority(big, small) < 0);
});

test("account: every graded server ends up sent, held, waiting or skipped; the rest is reported as a bug", () => {
  const a = account({
    gradedIds: ["s1", "s2", "s3", "s4", "s5", "s6"], sent: ["s1"], held: ["s2"],
    skipped: [{ id: "s3", code: "nothing-to-fix" }, { id: "s4", code: "single-run" }, { id: "s1", code: "cap" }],
  });
  assert.deepEqual([a.sent, a.held, a.waiting, a.skipped], [1, 1, { "single-run": 1 }, { "nothing-to-fix": 1 }]);
  assert.deepEqual(a.unaccounted, ["s5", "s6"]);
});

test("stalled: eligible and nothing sent for 2 live runs, unexplained, raises the alarm; a cap or a pause does not", () => {
  const ledger = {};
  recordRun(ledger, { live: true, eligible: 3, sent: 0, explained: false });
  assert.equal(stalled(ledger), false, "one run is not enough");
  recordRun(ledger, { live: true, eligible: 3, sent: 0, explained: false });
  assert.equal(stalled(ledger), true);
  recordRun(ledger, { live: true, eligible: 3, sent: 0, explained: true });
  assert.equal(stalled(ledger), false);
  recordRun(ledger, { live: true, eligible: 0, sent: 0, explained: false });
  recordRun(ledger, { live: true, eligible: 0, sent: 0, explained: false });
  assert.equal(stalled(ledger), false, "nothing eligible is not a stall");
  for (let i = 0; i < 40; i++) recordRun(ledger, { live: false, eligible: 1, sent: 0, explained: true });
  assert.equal(ledger.runs.length, 30, "the run log is bounded");
});
