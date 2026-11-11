// node --test fleet/   The owner notices (web/worker/notify-core.mjs, fleet/notify-owners.mjs) and the impact join and
// attribution rules (fleet/impact.mjs). Pure functions only: no network, no files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeEligible, changeEmail, confirmEmail, failingChecks, gradeChange, gradeRow, issueDraft, letterOf, ISSUE_MARKER } from "../web/worker/notify-core.mjs";
import { OPT_OUT, draftFor, parseRepo, plan, renderDrafts, repoFromLaunch, repoFromNpm, repoFromPypi } from "./notify-owners.mjs";
import { attribute, baseRate, indexFailing, indexHistory, joinNotice, median, renderSummary, summarize } from "./impact.mjs";

const pack = (id, letter, extra = {}) => ({ id, status: "graded", letter, points: 3, scored: 4, provisional: false, ...extra });
const check = (id, verdict, extra = {}) => ({ id, pack: "core", label: `label ${id}`, verdict, advisory: false, critical: false, summary: `summary ${id}`, ...extra });
const server = (over = {}) => ({
  id: "demo", name: "@demo/mcp", ecosystem: "npm", versionTested: "1.2.0", testedAt: "2026-11-01", standard: true, launch: "npx -y @demo/mcp@1.2.0",
  packs: [pack("core", "A"), pack("fs", "C"), { id: "db", status: "n/a", letter: null }],
  checks: [check("protocol", "pass"), check("fs-link-escape", "fail"), check("refusal-quality", "fail", { advisory: true }), check("fs-size-cap", "inconclusive")],
  ...over,
});

test("letterOf is the worst graded pack, null when nothing was graded", () => {
  assert.equal(letterOf(server()), "C");
  assert.equal(letterOf(server({ packs: [{ id: "core", status: "error", letter: null }] })), null);
});

test("failingChecks leaves out advisory and non-fail verdicts", () => {
  assert.deepEqual(failingChecks(server()), ["fs-link-escape"]);
});

test("badgeEligible matches the site rule", () => {
  assert.equal(badgeEligible(server()), true);
  assert.equal(badgeEligible(server({ standard: false })), false);
  assert.equal(badgeEligible(server({ packs: [pack("core", "A")] })), false, "protocol pack alone gets no badge");
  assert.equal(badgeEligible(server({ packs: [pack("core", "A"), pack("fs", "B", { provisional: true })] })), false);
  assert.equal(badgeEligible(server({ badge: { eligible: false } })), false);
});

test("gradeChange: silent on first sight, no letter, or same letter", () => {
  const cur = { letter: "B", failing: [] };
  assert.equal(gradeChange(null, cur), null);
  assert.equal(gradeChange({ letter: null, failing: [] }, cur), null);
  assert.equal(gradeChange({ letter: "B", failing: ["x"] }, cur), null);
  assert.equal(gradeChange({ letter: "A", failing: [] }, { letter: null, failing: [] }), null);
});

test("gradeChange: direction, fixed and broke", () => {
  assert.deepEqual(gradeChange({ letter: "F", failing: ["a", "b"] }, { letter: "B", failing: ["b", "c"] }), { from: "F", to: "B", direction: "up", fixed: ["a"], broke: ["c"] });
  assert.equal(gradeChange({ letter: "A", failing: [] }, { letter: "D", failing: ["z"] }).direction, "down");
});

test("emails carry the links they need and no badge link without a badge", () => {
  const row = gradeRow(server());
  const c = confirmEmail({ id: "demo", row, confirmUrl: "https://sealmark.dev/api/notify/confirm?t=abc" });
  assert.match(c.text, /confirm\?t=abc/);
  assert.match(c.text, /Nothing more is sent unless the link is opened/);
  const change = gradeChange({ letter: "F", failing: ["fs-link-escape", "old"] }, row);
  const e = changeEmail({ id: "demo", row, change, unsubscribeUrl: "https://sealmark.dev/api/notify/unsubscribe?s=1&t=x" });
  assert.equal(e.subject, "Sealmark: @demo/mcp went up from F to C");
  assert.match(e.text, /Now passing: old \(check\)/);
  assert.match(e.text, /Badge: https:\/\/sealmark\.dev\/badge\/demo\.svg/);
  assert.match(e.html, /unsubscribe\?s=1&amp;t=x/);
  const plain = changeEmail({ id: "demo", row: { ...row, badge: false }, change, unsubscribeUrl: "u" });
  assert.doesNotMatch(plain.text + plain.html, /badge/i);
});

test("issueDraft: marker, grade, failing checks only, badge when eligible", () => {
  const d = issueDraft({ id: "demo", server: server(), repo: "demo/mcp" });
  assert.equal(d.title, "Sealmark graded @demo/mcp 1.2.0: C");
  assert.ok(d.body.startsWith(ISSUE_MARKER("demo")));
  assert.match(d.body, /`fs-link-escape`/);
  assert.doesNotMatch(d.body, /refusal-quality/, "advisory checks are not listed as failures");
  assert.match(d.body, /\[!\[Sealmark\]\(https:\/\/sealmark\.dev\/badge\/demo\.svg\)\]/);
  assert.match(d.body, /reply "opt out"/);
  assert.doesNotMatch(issueDraft({ id: "demo", server: server({ standard: false }), repo: "r" }).body, /badge\//);
});

test("repo resolution from launch lines, npm and PyPI metadata", () => {
  assert.equal(repoFromLaunch("npx -y github:antvis/mcp-server-chart"), "antvis/mcp-server-chart");
  assert.equal(repoFromLaunch("uvx --from git+https://github.com/AminForou/mcp-gsc mcp-gsc"), "AminForou/mcp-gsc");
  assert.equal(repoFromNpm({ repository: { url: "git+https://github.com/o/r.git" } }), "o/r");
  assert.equal(repoFromNpm({ repository: "github:o/r" }), "o/r");
  assert.equal(repoFromNpm({ repository: { url: "https://gitlab.com/o/r" } }), null);
  assert.equal(repoFromPypi({ info: { project_urls: { Documentation: "https://docs.x", Source: "https://github.com/o/py#readme" } } }), "o/py");
  assert.equal(repoFromPypi({ info: { project_urls: null, home_page: "https://github.com/o/h" } }), "o/h");
  assert.equal(parseRepo("https://github.com/o/r/tree/main/src/x"), "o/r");
});

test("plan: one issue per repo, skips, opt-out forever, cap per run", () => {
  const s = (id, repo, letter = "B", testedAt = "2026-11-01") => ({ ...server({ id, testedAt, packs: [pack("core", letter)] }), _repo: repo });
  const servers = [s("a", "o/one"), s("a2", "O/One"), s("b", "o/two"), s("c", "o/three"), s("d", "jordanallenlewis/x"), s("e", "o/arch"), s("f", "o/fork"), s("g", "o/noissues"), s("h", null), s("i", "o/opted"), s("j", "o/done"),
    { ...server({ id: "k", packs: [{ id: "core", status: "error", letter: null }] }), _repo: "o/ungraded" }];
  const cache = Object.fromEntries(servers.map((x) => [x.id, { repo: x._repo }]));
  const meta = { "o/arch": { archived: true }, "o/fork": { fork: true }, "o/noissues": { has_issues: false } };
  const out = plan({ servers, cache, ledger: { issues: [{ repo: "o/done" }] }, optout: { repos: ["O/OPTED"] }, meta, max: 2 });
  assert.deepEqual(out.send.map((e) => e.repo), ["o/one", "o/two"]);
  assert.deepEqual(out.send[0].also.map((x) => x.id), ["a2"], "same repo, any case: one issue naming both");
  assert.equal(out.waiting, 1);
  const why = Object.fromEntries(out.skipped.map((x) => [x.id, x.reason]));
  assert.deepEqual(why, { d: "our own repository", e: "archived", f: "fork", g: "issues disabled", h: "no GitHub repository found", i: "opted out" });
  const d = draftFor(out.send[0]);
  assert.match(d.body, /Also graded from this repository:\n\n- `@demo\/mcp`/);
  assert.ok(d.body.indexOf("Also graded") < d.body.indexOf("The fleet re-tests"));
  const md = renderDrafts({ drafts: [d], waiting: 1, skipped: out.skipped, reason: "test", today: "2026-11-11" });
  assert.match(md, /Not filed: test/);
  assert.match(md, /## o\/one\n\n\*\*Title:\*\* Sealmark graded/);
});

test("opt-out wording", () => {
  for (const t of ["opt out", "Please OPT-OUT", "optout thanks"]) assert.match(t, OPT_OUT);
  assert.doesNotMatch("we opted to keep it", OPT_OUT);
});

// ---- impact ----
const H = (id, version, testedAt, worst, status = "ok") => ({ id, version, testedAt, worst, status });
const history = [
  H("s", "1.0", "2026-11-01", "D"), H("s", "1.0", "2026-11-03", "D"), H("s", "1.1", "2026-11-05", "D"), H("s", "1.1", "2026-11-06", "C"),
  H("s", "1.2", "2026-11-09", "B"), H("s", "1.3", "2026-11-10", "F"), H("s", "1.4", "2026-11-11", null, "error"),
  H("q", "2.0", "2026-11-01", "B"), H("q", "2.1", "2026-11-04", "A"), H("r", "3.0", "2026-11-01", "A"),
];
const telemetry = [
  { id: "s", serverVersion: "1.2", status: "ok", ruleHits: [["x", "fail", 0, 0], ["adv", "fail", 0, 1], ["inc", "inconclusive", 0, 0]] },
  { id: "s", serverVersion: "1.3", status: "ok", ruleHits: [["x", "fail", 0, 0], ["y", "fail", 1, 0]] },
];
const hist = indexHistory(history);
const fail = indexFailing(telemetry);

test("joinNotice: new versions after the notice, first grade per version, improvement, regression", () => {
  const j = joinNotice({ channel: "issue", id: "s", at: "2026-11-02", version: "1.0", letter: "D", failing: ["x", "z"], badgeAtNotice: false }, hist, fail);
  assert.deepEqual(j.after.map((v) => [v.version, v.letter]), [["1.1", "D"], ["1.2", "B"], ["1.3", "F"]], "a regrade of 1.1 does not count; failed runs are ignored");
  assert.equal(j.released, true);
  assert.equal(j.improved, true);
  assert.deepEqual(j.firstImprovement, { version: "1.2", testedAt: "2026-11-09", letter: "B", days: 7 });
  assert.equal(j.regressed, true);
  assert.deepEqual(j.latest, { version: "1.3", letter: "F", testedAt: "2026-11-10" });
  assert.deepEqual(j.fixed, ["z"]);
  assert.deepEqual(j.broke, ["y"]);
});

test("joinNotice: no per-check data means fixed is unknown, not empty", () => {
  const j = joinNotice({ channel: "issue", id: "q", at: "2026-11-01", version: "2.0", letter: "B", failing: ["a"] }, hist, fail);
  assert.equal(j.improved, true);
  assert.equal(j.fixed, null);
  const none = joinNotice({ channel: "issue", id: "r", at: "2026-11-01", version: "3.0", letter: "A", failing: [] }, hist, fail);
  assert.equal(none.released, false);
  assert.equal(none.latest, null);
});

test("attribute: improvement alone is correlation, never 'acted on Sealmark'", () => {
  const improved = { improved: true, released: true, badgeAtNotice: false };
  assert.equal(attribute(improved, {}).label, "improved after notice");
  assert.equal(attribute(improved, { maintainerCommented: true, issueState: "closed" }).actedOnSealmark, false, "a comment or a close alone is not evidence of a fix");
  assert.equal(attribute(improved, { closedByMaintainer: true }).actedOnSealmark, false, "closed without a fix");
  assert.equal(attribute(improved, { releaseMentionsSealmark: true }).actedOnSealmark, false, "release notes are recorded, not counted");
});

test("attribute: each direct signal on its own", () => {
  const j = { improved: true, released: true, badgeAtNotice: false };
  assert.equal(attribute(j, { issueReferenced: true }).label, "acted on Sealmark");
  assert.equal(attribute(j, { commitMentionsSealmark: true }).direct.fixCommitMentionsSealmark, true);
  assert.equal(attribute(j, { closedByMaintainer: true, closedByCommit: true }).direct.closedByMaintainerWithFix, true);
  assert.equal(attribute(j, { badgeNow: true }).direct.badgeAdded, true);
  assert.equal(attribute(j, { badgeNow: true }).improvedWithDirectSignal, true);
});

test("attribute: a badge that was already there, or an unknown baseline, is not 'added'", () => {
  assert.equal(attribute({ improved: false, released: false, badgeAtNotice: true }, { badgeNow: true }).actedOnSealmark, false);
  assert.equal(attribute({ improved: false, released: false, badgeAtNotice: null }, { badgeNow: true }).actedOnSealmark, false);
  assert.equal(attribute({ improved: false, released: false, badgeAtNotice: null }, {}).label, "no new version yet");
  assert.equal(attribute({ improved: false, released: true }, {}).label, "new version, no better grade");
});

test("baseRate measures never-notified servers the same way", () => {
  const b = baseRate(hist, fail, ["q", "r", "missing"], () => "2026-11-01");
  assert.deepEqual(b, { servers: 2, released: 1, improved: 1, regressed: 0, medianDaysToImprovement: 3 });
});

test("summarize and render keep the honest labels", () => {
  const rows = [
    joinNotice({ channel: "issue", id: "s", at: "2026-11-02", version: "1.0", letter: "D", failing: ["x", "z"], badgeAtNotice: false }, hist, fail),
    joinNotice({ channel: "email", id: "q", at: "2026-11-01", version: "2.0", letter: "B", failing: [] }, hist, fail),
  ].map((r, i) => ({ ...r, evidence: i ? {} : { issueReferenced: true }, attribution: attribute(r, i ? {} : { issueReferenced: true }) }));
  const s = summarize(rows, { servers: 1, released: 0, improved: 0, regressed: 0, medianDaysToImprovement: null });
  assert.equal(s.notified, 2);
  assert.deepEqual(s.byChannel, { issue: 1, email: 1 });
  assert.equal(s.improved, 2);
  assert.equal(s.actedOnSealmark, 1);
  assert.equal(s.improvedWithDirectSignal, 1);
  assert.equal(s.medianDaysToImprovement, 5);
  assert.deepEqual(s.topFixedChecks, [["z", 1]]);
  const md = renderSummary({ summary: s, rows, mode: "real", today: "2026-11-11", window: "w" });
  assert.match(md, /Internal: not published/);
  assert.match(md, /"Improved after notice" is correlation/);
  assert.match(renderSummary({ summary: s, rows, mode: "simulate", today: "t" }), /SIMULATED[\s\S]*Simulation, not real notices/);
  assert.equal(median([3, 1, 2, 10]), 2.5);
});
