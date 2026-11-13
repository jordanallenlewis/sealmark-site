// node --test fleet/   The owner notices (web/worker/notify-core.mjs, fleet/notify-owners.mjs, fleet/security-checks.mjs)
// and the impact join and attribution rules (fleet/impact.mjs). No network, no files: main() runs on fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeEligible, changeEmail, confirmEmail, failingChecks, gradeChange, gradeRow, issueDraft, letterOf, ISSUE_MARKER } from "../web/worker/notify-core.mjs";
import {
  DEFAULT_MAX_ISSUES, FILES, FRESH_DAYS, MAX_REPO_FAILURES, PACE_MS, TRACKING_TITLE, classifyGhError, dirFromUrl, draftFor, gate, isNewer, isOptOut, main, maxIssues,
  parseDrafts, parseRepo, plan, postIssues, privateEntry, recordFailure, renderDrafts, renderPrivate, replyKind, repoFromLaunch, repoFromNpm, repoFromPypi, staleReason,
  trackingBody, weekStart, weeklySummary,
} from "./notify-owners.mjs";
import { ADVISORY, CHECK_CLASS, PUBLIC, UNCLASSIFIED, isPublicCheck, isSecurityCheck, isWeakSignal, securityFindings } from "./security-checks.mjs";
import registry from "../web/content/generated/checks.json" with { type: "json" };
import { attribute, baseRate, indexFailing, indexHistory, joinNotice, median, renderSummary, summarize } from "./impact.mjs";

const TODAY = "2026-11-12";
const pack = (id, letter, extra = {}) => ({ id, status: "graded", letter, points: 3, scored: 4, provisional: false, ...extra });
const check = (id, verdict, extra = {}) => ({ id, pack: "core", label: `label ${id}`, verdict, advisory: false, critical: false, summary: `summary ${id}`, ...extra });
const covered = { validCalls: 3, toolsCalledValid: 3, toolsTotal: 4, level: "covered" };
const hygiene = { validCalls: 0, toolsCalledValid: 0, toolsTotal: 4, level: "hygiene-only" };
const server = (over = {}) => ({
  id: "demo", name: "@demo/mcp", ecosystem: "npm", versionTested: "1.2.0", testedAt: "2026-11-10", standard: true, launch: "npx -y @demo/mcp@1.2.0",
  sealmark: { version: "1.0.0" }, toolCount: 4, coverage: covered,
  packs: [pack("core", "B"), { id: "db", status: "na", letter: null }],
  checks: [check("protocol", "pass"), check("robust-input", "part", { summary: "0 internals leak(s), 4 invalid call(s) accepted" }), check("tool-poisoning", "pass", { critical: true }), check("refusal-quality", "fail", { advisory: true })],
  ...over,
});
// A server with an A and every scored check passed.
const allPass = (over = {}) => server({ packs: [pack("core", "A")], checks: [check("protocol", "pass"), check("robust-input", "pass")], ...over });
// What the network says about a healthy candidate: same version, package at the root.
const okFacts = (x) => ({ latest: x.versionTested, directory: "", root: { name: x.name } });
// plan() inputs where every candidate was checked and is fine
const world = (servers, over = {}) => {
  const cache = Object.fromEntries(servers.map((x) => [x.id, { repo: x._repo }]));
  const meta = Object.fromEntries(servers.filter((x) => x._repo).map((x) => [x._repo, { full_name: x._repo, has_issues: true }]));
  const facts = Object.fromEntries(servers.map((x) => [x.id, okFacts(x)]));
  return { servers, cache, meta, facts, ledger: { issues: [] }, optout: { repos: [] }, max: 8, today: TODAY, ...over };
};
const at = (id, repo, over = {}) => ({ ...server({ id, name: `@x/${id}`, ...over }), _repo: repo });

// ---- notify-core: letters, badges, emails ----

test("letterOf is the worst graded pack, null when nothing was graded", () => {
  assert.equal(letterOf(server({ packs: [pack("core", "A"), pack("fs", "C")] })), "C");
  assert.equal(letterOf(server({ packs: [{ id: "core", status: "error", letter: null }] })), null);
});

test("failingChecks leaves out advisory and non-fail verdicts", () => {
  assert.deepEqual(failingChecks(server({ checks: [check("a", "fail"), check("b", "part"), check("c", "fail", { advisory: true })] })), ["a"]);
});

test("badgeEligible matches the site rule", () => {
  const s = server({ packs: [pack("core", "A"), pack("fs", "C")] });
  assert.equal(badgeEligible(s), true);
  assert.equal(badgeEligible({ ...s, standard: false }), false);
  assert.equal(badgeEligible(server({ packs: [pack("core", "A")] })), false, "protocol pack alone gets no badge");
  assert.equal(badgeEligible(server({ packs: [pack("core", "A"), pack("fs", "B", { provisional: true })] })), false);
  assert.equal(badgeEligible({ ...s, badge: { eligible: false } }), false);
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
  const row = gradeRow(server({ packs: [pack("core", "A"), pack("fs", "C")], checks: [check("protocol", "pass"), check("fs-link-escape", "fail")] }));
  const c = confirmEmail({ id: "demo", row, confirmUrl: "https://sealmark.dev/api/notify/confirm?t=abc" });
  assert.match(c.text, /confirm\?t=abc/);
  const change = gradeChange({ letter: "F", failing: ["fs-link-escape", "old"] }, row);
  const e = changeEmail({ id: "demo", row, change, unsubscribeUrl: "https://sealmark.dev/api/notify/unsubscribe?s=1&t=x" });
  assert.equal(e.subject, "Sealmark: @demo/mcp went up from F to C");
  assert.match(e.text, /Badge: https:\/\/sealmark\.dev\/badge\/demo\.svg/);
  const plain = changeEmail({ id: "demo", row: { ...row, badge: false }, change, unsubscribeUrl: "u" });
  assert.doesNotMatch(plain.text + plain.html, /badge/i);
});

// ---- the issue template ----

const FOOTER = "This is automated and can be wrong. If a result looks wrong, reply here and we will recheck it and correct the page. If you want the server taken off sealmark.dev, say so and we will remove it.\n\nThis is the only issue Sealmark will open here. Close it whenever you like.";

test("template: a grade below A names each failing or partial check, exactly in this shape", () => {
  const s = server({ packs: [pack("core", "B"), pack("fs", "D")], checks: [check("protocol", "pass"), check("robust-input", "part", { summary: "3 invalid call(s) accepted" }), check("fs-size-cap", "fail", { pack: "fs", summary: "read_file: no cap" })] });
  const d = draftFor({ repo: "o/r", server: s, also: [] });
  assert.equal(d.title, "Automated Sealmark test of @demo/mcp 1.2.0: D");
  assert.equal(d.body, [
    "<!-- sealmark-owner-notice:demo -->",
    "Hi. [Sealmark](https://sealmark.dev) is an open-source test suite for MCP servers, run by [Jordan Allen Lewis](https://github.com/jordanallenlewis). An automated run started `@demo/mcp` 1.2.0 with `npx -y @demo/mcp@1.2.0` on 2026-11-10. It got a **D**.",
    "The grade is the lowest test-area grade (Protocol B, Files D). It comes from:\n\n- `robust-input`: 3 invalid call(s) accepted (partly passed, half credit)\n- `fs-size-cap`: read_file: no cap (failed)",
    "- What was tested and what was not: https://sealmark.dev/results/demo/\n- How grades work: https://sealmark.dev/docs/methodology/#grading-formula\n- Reproduce it: `npx -y sealmark@1.0.0 run --start \"npx -y @demo/mcp@1.2.0\"`",
    FOOTER,
  ].join("\n\n"));
  for (const word of [/\bfleet\b/i, /\bcore\b/i, /\bpacks?\b/i, /badge/i, /opt out/i, /behaviou?r/i, /—/]) assert.doesNotMatch(d.body + d.title, word);
});

test("template: an A with tools covered, and an A with hygiene-only coverage, say coverage plainly", () => {
  const a = draftFor({ repo: "o/r", server: allPass(), also: [] });
  assert.match(a.body, /It got an \*\*A\*\*\.\n\nEvery scored check passed\. 3 of 4 tools answered a valid call\.\n\n- What was tested/);
  const h = draftFor({ repo: "o/r", server: allPass({ coverage: hygiene }), also: [] });
  assert.match(h.body, /\n\nEvery scored check passed\. Only 0 of 4 tools could be called with default settings, so this grade covers the handshake and tool metadata only\.\n\n/);
  assert.ok(a.body.startsWith(ISSUE_MARKER("demo")), "the hidden marker stays first");
  const p = draftFor({ repo: "o/r", server: allPass({ packs: [pack("core", "A"), pack("net", "A", { provisional: true })] }), also: [] });
  assert.match(p.body, /The Network grade is provisional/, "a provisional grade says so in the reason");
  const also = draftFor({ repo: "o/r", server: allPass(), also: [allPass({ id: "two", name: "two-mcp", versionTested: "0.1.0" })] });
  assert.match(also.body, /- Also tested from this repository: `two-mcp` 0\.1\.0 got an \*\*A\*\*: https:\/\/sealmark\.dev\/results\/two\/\n\nThis is automated/);
});

test("template: refuses a reason it cannot give, and anything held", () => {
  assert.throws(() => issueDraft({ id: "x", server: server(), repo: "o/r", listed: [] }), /not every scored check passed/);
  assert.throws(() => draftFor({ repo: "o/r", server: server({ checks: [check("fs-write-escape", "fail")] }), also: [] }), /held for a private report/);
});

// ---- repositories ----

test("repo resolution from launch lines, npm and PyPI metadata; folders in URLs", () => {
  assert.equal(repoFromLaunch("npx -y github:antvis/mcp-server-chart"), "antvis/mcp-server-chart");
  assert.equal(repoFromLaunch("uvx --from git+https://github.com/AminForou/mcp-gsc mcp-gsc"), "AminForou/mcp-gsc");
  assert.equal(repoFromNpm({ repository: { url: "git+https://github.com/o/r.git" } }), "o/r");
  assert.equal(repoFromNpm({ repository: "github:o/r" }), "o/r");
  assert.equal(repoFromNpm({ repository: { url: "https://gitlab.com/o/r" } }), null);
  assert.equal(repoFromPypi({ info: { project_urls: { Documentation: "https://docs.x", Source: "https://github.com/o/py#readme" } } }), "o/py");
  assert.equal(repoFromPypi({ info: { project_urls: null, home_page: "https://github.com/o/h" } }), "o/h");
  assert.equal(parseRepo("https://github.com/o/r/tree/main/src/x"), "o/r");
  assert.equal(dirFromUrl("https://github.com/o/r/tree/main/packages/mcp"), "packages/mcp");
  assert.equal(dirFromUrl("https://github.com/o/r"), "");
});

test("isNewer: numeric order, a release beats its pre-release, unparseable differs counts as newer", () => {
  assert.equal(isNewer("1.2.1", "1.2.0"), true);
  assert.equal(isNewer("1.10.0", "1.9.9"), true);
  assert.equal(isNewer("1.2.0", "1.2.0"), false);
  assert.equal(isNewer("v1.2.0", "1.2.0"), false);
  assert.equal(isNewer("1.1.0", "1.2.0"), false);
  assert.equal(isNewer("1.2.0", "1.2.0-rc.1"), true);
  assert.equal(isNewer("main-abc", "main-def"), true);
});

// ---- the allowlist ----

test("allowlist: every registry check is classified on purpose", () => {
  assert.deepEqual(UNCLASSIFIED, [], "a new check in web/content/generated/checks.json must be classified in fleet/security-checks.mjs");
  for (const c of registry) {
    const advisory = c.advisory === true || c.severity === "advisory";
    assert.equal(CHECK_CLASS[c.id] === "advisory", advisory, `${c.id}: advisory in the registry iff advisory here`);
    if (c.severity === "critical") assert.equal(CHECK_CLASS[c.id], "private", `${c.id} is critical, so never public`);
  }
  for (const id of Object.keys(PUBLIC)) assert.ok(registry.some((c) => c.id === id), `${id} is in the registry`);
  for (const id of ADVISORY) assert.ok(registry.some((c) => c.id === id), `${id} is in the registry`);
});

test("allowlist: fail closed; read-only, sqlite-read-only and pii-masked hold; unknown checks hold; weak signals do not", () => {
  for (const id of ["read-only", "sqlite-read-only", "pii-masked", "net-redirect", "openworld-honesty", "a-check-from-the-future"]) {
    assert.equal(isPublicCheck({ id }), false, id);
    assert.deepEqual(securityFindings(server({ checks: [check(id, "fail")] })).map((c) => c.id), [id], `${id} fail holds`);
    assert.equal(securityFindings(server({ checks: [check(id, "part", { summary: "half of it got through" })] })).length, 1, `${id} part holds`);
  }
  assert.equal(isPublicCheck({ id: "robust-input" }), true);
  assert.equal(isPublicCheck({ id: "robust-input", critical: true }), false, "a result's own critical flag wins");
  assert.equal(isSecurityCheck({ id: "fs-read-escape", advisory: true }), false, "advisory never holds");
  const weakTp = check("tool-poisoning", "part", { summary: "2 weak indicator(s) worth reading, none conclusive" });
  const weakAh = check("annotation-honesty", "part", { pack: "effects", summary: "declared read-only; only caches changed (sandbox home or temp): list_x" });
  assert.equal(isWeakSignal(weakTp), true);
  assert.equal(isWeakSignal(weakAh), true);
  assert.equal(isWeakSignal(check("exec-cwd", "inconclusive")), true);
  assert.equal(isWeakSignal(check("annotation-honesty", "part", { summary: "declared read-only; wrote /etc/x" })), false);
  assert.deepEqual(securityFindings(server({ checks: [weakTp, weakAh, check("exec-cwd", "inconclusive"), check("robust-input", "fail")] })), [], "weak signals, inconclusive and public checks are not findings");
});

// ---- the plan ----

test("plan: one issue per repo, the repo-level skips, opt-out forever, cap per run", () => {
  const servers = [at("a", "o1/one"), at("a2", "O1/One"), at("b", "o2/two"), at("c", "o3/three"), at("d", "jordanallenlewis/x"), at("e", "o4/arch"), at("f", "o5/fork"), at("g", "o6/noissues"),
    at("h", null), at("i", "o7/opted"), at("j", "o8/done"), at("k", "o9/failing"), { ...at("u", "o10/ungraded"), packs: [{ id: "core", status: "error", letter: null }] }];
  const w = world(servers, { max: 2 });
  Object.assign(w.meta, { "o4/arch": { archived: true }, "o5/fork": { fork: true }, "o6/noissues": { has_issues: false } });
  delete w.cache.h; // repository lookup failed
  const out = plan({ ...w, ledger: { issues: [{ repo: "o8/done" }], failures: [{ repo: "o9/failing", failed: MAX_REPO_FAILURES, status: "404", at: "2026-11-11T00:00:00Z" }] }, optout: { repos: ["O7/OPTED"] } });
  assert.deepEqual(out.send.map((e) => e.repo), ["o1/one", "o2/two"]);
  assert.deepEqual(out.send[0].also.map((x) => x.id), ["a2"], "same repo, any case: one issue naming both");
  assert.equal(out.waiting, 1);
  const why = Object.fromEntries(out.skipped.map((x) => [x.id, x.code]));
  assert.deepEqual(why, { d: "own", e: "archived", f: "fork", g: "issues-off", h: "lookup-failed", i: "opted-out", k: "failures" });
  const md = renderDrafts({ drafts: out.send.map(draftFor), waiting: 1, skipped: out.skipped, reason: "test", today: TODAY, max: 2 });
  assert.match(md, /Not filed: test/);
  assert.match(md, /## o1\/one\n\n\*\*Title:\*\* Automated Sealmark test of/);
  assert.match(md, /Skipped 7: /);
});

test("plan: candidates the network has not checked wait as unchecked, never sent", () => {
  const servers = [at("a", "o/a"), at("b", "p/b")];
  const w = world(servers);
  delete w.meta["o/a"];
  delete w.facts.b;
  const out = plan(w);
  assert.equal(out.send.length, 0);
  assert.deepEqual(out.unchecked.map((u) => u.repo), ["o/a", "p/b"]);
});

test("plan: one issue per repository owner per 24 hours, in a run and across runs", () => {
  const servers = [at("a", "same/one"), at("b", "same/two"), at("c", "busy/three"), at("d", "free/four")];
  const ledger = { issues: [{ repo: "busy/old", postedAt: "2026-11-12T01:00:00Z" }, { repo: "free/old", postedAt: "2026-11-10T01:00:00Z" }] };
  const out = plan({ ...world(servers), ledger, now: Date.parse("2026-11-12T10:00:00Z") });
  assert.deepEqual(out.send.map((e) => e.repo), ["same/one", "free/four"]);
  const why = Object.fromEntries(out.skipped.map((s) => [s.id, s.code]));
  assert.deepEqual(why, { b: "owner-limit", c: "owner-limit" });
});

test("holds: the whole repo, servers with no repository or no letter too, never named publicly", () => {
  const servers = [
    at("ok", "o/ok"),
    at("sec", "o/sec", { checks: [check("protocol", "pass"), check("fs-write-escape", "fail"), check("robust-input", "fail")] }),
    at("sec-also-clean", "o/sec"),
    at("ro", "o/ro", { checks: [check("read-only", "fail", { pack: "db" })] }),
    at("norepo", null, { checks: [check("pii-masked", "fail", { pack: "db" })] }),
    { ...at("ungraded", "o/ung", { checks: [check("sqlite-read-only", "fail", { pack: "sqlite" })] }), packs: [{ id: "core", status: "error", letter: null }] },
    at("old-sec", "o/oldsec", { testedAt: "2026-09-01", checks: [check("mutating-sql", "part", { summary: "1 of 3 forms ran" })] }),
  ];
  const w = world(servers);
  delete w.cache.norepo;
  const out = plan(w);
  assert.deepEqual(out.send.map((e) => e.repo), ["o/ok"]);
  assert.deepEqual(out.held.map((h) => h.repo ?? h.servers[0].id).sort(), ["norepo", "o/oldsec", "o/ro", "o/sec", "o/ung"]);
  assert.deepEqual(out.held.find((h) => h.repo === "o/sec").servers.map((x) => x.id).sort(), ["sec", "sec-also-clean"]);
  assert.deepEqual(out.skipped, [], "held servers are not listed as skipped");
  const md = renderDrafts({ drafts: out.send.map(draftFor), skipped: out.skipped, held: out.held.length, reason: "t", today: TODAY, max: 2 });
  assert.match(md, /5 repositories are held for private handling/);
  assert.doesNotMatch(md, /o\/sec|o\/ro|norepo|o\/ung|o\/oldsec|fs-write-escape|read-only|mutating-sql|pii/);
  const entries = out.held.map((h) => privateEntry(h, { today: TODAY, pvr: h.repo === "o/sec" }));
  const sec = entries.find((e) => e.repo === "o/sec");
  assert.match(sec.channel, /security\/advisories\/new/);
  assert.deepEqual(sec.servers.find((x) => x.id === "sec").security.map((c) => c.id), ["fs-write-escape"]);
  assert.deepEqual(sec.servers.find((x) => x.id === "sec").otherFailing, ["robust-input"]);
  assert.match(entries.find((e) => !e.repo).channel, /no GitHub repository known/);
  const pmd = renderPrivate({ entries, today: TODAY });
  assert.match(pmd, /^# Owner notices held for private handling\n\nPRIVATE/);
  assert.match(pmd, /NOT FRESH/);
  assert.match(pmd, /## norepo \(no GitHub repository known\)/);
});

test("eligibility: each skip, and an A with hygiene-only coverage still goes out", () => {
  const S = {
    notools: at("notools", "o/notools", { toolCount: 0, coverage: { validCalls: 0, toolsCalledValid: 0, toolsTotal: 0, level: "hygiene-only" } }),
    hygieneB: at("hygieneB", "o/hyg", { coverage: hygiene }),
    hygieneA: { ...allPass({ id: "hygieneA", name: "@x/hygieneA", coverage: hygiene }), _repo: "hyg/a" },
    weak: at("weak", "o/weak", { checks: [check("protocol", "pass"), check("tool-poisoning", "part", { critical: true, summary: "1 weak indicator(s) worth reading, none conclusive" })] }),
    weakAh: at("weakAh", "o/weakah", { packs: [pack("core", "A"), pack("effects", "C")], checks: [check("protocol", "pass"), check("annotation-honesty", "part", { pack: "effects", summary: "declared read-only; only caches changed (sandbox home or temp): x" })] }),
    weakMixed: at("weakMixed", "o/mixed", { packs: [pack("core", "B"), pack("effects", "C")], checks: [check("robust-input", "fail"), check("annotation-honesty", "part", { pack: "effects", summary: "declared read-only; only caches changed (sandbox home or temp): x" })] }),
    newer: at("newer", "o/newer"),
    sub: at("sub", "o/mono"),
    copy: at("copy", "o/copy"),
    release: at("release", "o/release"),
    rootmono: at("rootmono", "o/rootmono"),
    placeholder: at("placeholder", "o/ph", { launch: "npx -y @x/placeholder@1.2.0 --dsn {dsn}" }),
    quoted: at("quoted", "o/q", { launch: 'uvx --with "mcp<2" x==1.2.0' }),
    netfail: at("netfail", "o/netfail"),
    stale: at("stale", "o/stale", { testedAt: "2026-10-01" }),
    good: at("good", "good/r"),
  };
  const w = world(Object.values(S));
  Object.assign(w.facts, {
    newer: { latest: "1.3.0", directory: "", root: { name: "@x/newer" } },
    sub: { latest: "1.2.0", directory: "packages/mcp", root: { name: "monorepo-root" } },
    copy: { latest: "1.2.0", directory: "", root: { name: "something-else" } },
    release: { latest: "1.2.0", directory: "", root: { missing: true } },
    rootmono: { latest: "1.2.0", directory: "", root: { name: "root", monorepo: true } },
    netfail: { error: "npm 503" },
  });
  const out = plan(w);
  assert.deepEqual(out.send.map((e) => e.server.id).sort(), ["good", "hygieneA"]);
  const why = Object.fromEntries(out.skipped.map((s) => [s.id, s.code]));
  assert.deepEqual(why, {
    notools: "no-tools", hygieneB: "hygiene-only", weak: "weak-signals", weakAh: "weak-signals", weakMixed: "weak-signals", newer: "newer-version", sub: "monorepo", copy: "not-source",
    release: "not-source", rootmono: "monorepo", placeholder: "launch", quoted: "launch", netfail: "check-failed", stale: "stale",
  });
  const r = Object.fromEntries(out.skipped.map((s) => [s.id, s.reason]));
  assert.match(r.newer, /version 1\.3\.0 is out and 1\.2\.0 was tested; waits for the re-test/);
  assert.match(r.sub, /`packages\/mcp`/);
  assert.match(r.placeholder, /\{dsn\}/);
  assert.match(draftFor(out.send.find((e) => e.server.id === "hygieneA")).body, /Only 0 of 4 tools could be called with default settings/);
  // a GitHub-sourced server compares the release it was tested at
  const gh = { ...at("ghs", "o/ghs", { ecosystem: "github", name: "o/ghs", versionTested: "1.0.0", refTested: "1.0.0", launch: "npx -y github:o/ghs" }) };
  const g = world([gh]);
  assert.equal(plan(g).send.length, 1);
  g.facts.ghs = { latest: "1.1.0", directory: "", root: null };
  assert.equal(plan(g).skipped[0].code, "newer-version");
});

test("freshness: older than 14 days or a failed latest re-test waits; a later good grade clears it", () => {
  assert.equal(FRESH_DAYS, 14);
  assert.equal(staleReason({ testedAt: "2026-10-29" }, TODAY), null, "exactly 14 days is fresh");
  assert.match(staleReason({ testedAt: "2026-10-28" }, TODAY), /older than 14 days/);
  assert.match(staleReason({ testedAt: "2026-11-09", lastAttempt: { date: "2026-11-12", status: "failed", kind: "start-fail" } }, TODAY), /latest re-test failed on 2026-11-12/);
  assert.equal(staleReason({ testedAt: "2026-11-11", lastAttempt: { date: "2026-11-10", status: "failed", kind: "timeout" } }, TODAY), null, "a failure before the grade is old news");
});

test("cap: 2 by default, MAX_OWNER_ISSUES when it is a whole number, the rest wait", () => {
  assert.equal(DEFAULT_MAX_ISSUES, 2);
  assert.equal(maxIssues(undefined), 2);
  assert.equal(maxIssues(""), 2, "an unset Actions variable arrives as an empty string");
  assert.equal(maxIssues("8"), 8);
  for (const bad of ["0", "-1", "2.5", "lots"]) assert.equal(maxIssues(bad), 2, bad);
  const servers = Array.from({ length: 5 }, (_, i) => at(`s${i}`, `o${i}/r${i}`));
  const out = plan({ ...world(servers), max: maxIssues("") });
  assert.equal(out.send.length, 2);
  assert.equal(out.waiting, 3);
  assert.match(renderDrafts({ drafts: [], waiting: 3, skipped: [], reason: "r", today: TODAY, max: 2 }), /at most 2 per run\); 3 more eligible repositories wait/);
});

// ---- the hand-approved batch ----

test("parseDrafts gives back each drafted issue byte for byte", () => {
  const servers = [at("a", "o/a"), at("b", "p/b", { packs: [pack("core", "A")], checks: [check("protocol", "pass")] })];
  const out = plan(world(servers));
  const drafts = out.send.map(draftFor);
  const md = renderDrafts({ drafts, skipped: [{ id: "z", repo: "q/z", code: "fork", reason: "fork" }], held: 1, reason: "r", today: TODAY, max: 2 });
  const parsed = parseDrafts(md);
  assert.deepEqual([...parsed.keys()], ["o/a", "p/b"]);
  for (const d of drafts) {
    assert.equal(parsed.get(d.repo).body, d.body);
    assert.equal(parsed.get(d.repo).title, d.title);
  }
  assert.equal(parseDrafts(md.replace(/\n/g, "\r\n")).get("o/a").body, drafts[0].body, "a CRLF checkout parses the same");
});

// ---- replies ----

test("opt-out: a request, not a question, a negation or a quote", () => {
  for (const t of ["opt out", "Please OPT-OUT", "optout thanks", "We'd like to opt out.", "Please opt us out of these.", "Thanks. Opt out please"]) assert.equal(isOptOut(t), true, t);
  for (const t of ["should I opt out?", "How do I opt out", "> reply \"opt out\" if you do not want it to post here again\n\nThanks for the report!", "The issue says \"opt out\" but I am fine with it.",
    "we opted to keep it", "no need to opt out, this is useful", "`opt out`"]) assert.equal(isOptOut(t), false, t);
});

test("replyKind flags removal and recheck requests", () => {
  assert.equal(replyKind("Can you remove our server from sealmark.dev?"), "removal");
  assert.equal(replyKind("opt out"), "removal");
  assert.equal(replyKind("This result is wrong, the cap is configurable. Please recheck."), "recheck");
  assert.equal(replyKind("Thanks, nice tool!"), "reply");
  assert.equal(replyKind("> If you want the server taken off sealmark.dev, say so and we will remove it.\n\nThanks!"), "reply", "a quote of the issue is not a request");
});

test("weekly summary and tracking body: counts, replies of the week, requests first", () => {
  assert.equal(weekStart("2026-11-12"), "2026-11-09");
  assert.equal(weekStart("2026-11-15"), "2026-11-09");
  const ledger = {
    issues: [{ id: "a", repo: "o/a", at: "2026-11-10", letter: "C", repliedAt: "2026-11-11" }, { id: "b", repo: "o/b", at: "2026-10-01", letter: "B" }, { id: "gone", repo: "o/g", at: "2026-11-09", letter: "A" }],
    emails: [{ at: "2026-11-12" }, { at: "2026-10-02" }],
    replies: [
      { id: 1, repo: "o/a", number: 3, url: "https://github.com/o/a/issues/3#c1", user: "amy", at: "2026-11-11T08:00:00Z", kind: "reply" },
      { id: 2, repo: "o/a", number: 3, url: "https://github.com/o/a/issues/3#c2", user: "amy", at: "2026-11-12T08:00:00Z", kind: "removal" },
      { id: 3, repo: "o/b", number: 9, url: "https://github.com/o/b/issues/9#c3", user: "bo", at: "2026-10-02T08:00:00Z", kind: "recheck" },
    ],
  };
  const optout = { repos: ["o/b", "o/x"], at: { "o/b": "2026-11-08" } };
  const servers = [server({ id: "a", packs: [pack("core", "A")] }), server({ id: "b", packs: [pack("core", "D")] })];
  const md = weeklySummary({ ledger, optout, servers, today: TODAY });
  assert.match(md, /^# Owner notices: week of 2026-11-09/);
  assert.match(md, /\|---\|---\|---\|\n\| Issues opened \| 2 \| 3 \|/, "header and rows form one table");
  assert.match(md, /\| Replies from people \| 2 \| 3 \|/);
  assert.match(md, /\| Removal or recheck requests \| 1 \| 2 \|/);
  assert.match(md, /\| Opted out \| 1 \| 2 \|/);
  assert.match(md, /1 up, 1 down, 0 same, 1 not graded now/);
  assert.match(md, /### Removal or recheck requests\n\n- 2026-11-12 \*\*removal\*\*: @amy on o\/a#3: https:\/\/github\.com\/o\/a\/issues\/3#c2/);
  assert.doesNotMatch(md, /@bo/, "only the last 7 days in the weekly file");
  const body = trackingBody(ledger.replies, TODAY);
  assert.ok(body.indexOf("**removal**") < body.indexOf("## Other replies") && body.indexOf("**recheck**") < body.indexOf("## Other replies"), "requests first");
});

// ---- posting ----

test("classifyGhError: per-repository errors continue, everything else stops", () => {
  const e = (stderr, code) => Object.assign(new Error("Command failed: gh"), { stderr, ...(code ? { code } : {}) });
  assert.deepEqual(classifyGhError(e("HTTP 404: Not Found")), { status: "404", perRepo: true });
  assert.deepEqual(classifyGhError(e("HTTP 410: Issues are disabled for this repo")), { status: "410", perRepo: true });
  assert.deepEqual(classifyGhError(e("the 'o/r' repository has disabled issues")), { status: "repo", perRepo: true });
  assert.equal(classifyGhError(e("HTTP 403: You have exceeded a secondary rate limit")).perRepo, false);
  assert.equal(classifyGhError(e("HTTP 403: Forbidden")).perRepo, false);
  assert.equal(classifyGhError(e("HTTP 429")).status, "429");
  assert.equal(classifyGhError(e("HTTP 401: Bad credentials")).perRepo, false);
  assert.equal(classifyGhError(e("", "ENOENT")).status, "gh-missing");
  assert.equal(classifyGhError(e("connection reset")).perRepo, false, "unknown errors stop: fail closed");
  const ledger = {};
  recordFailure(ledger, "o/r", { status: "404", perRepo: true }, "t1");
  recordFailure(ledger, "O/R", { status: "403", perRepo: false }, "t2");
  assert.deepEqual(ledger.failures, [{ repo: "O/R", failed: 1, status: "403", at: "t2" }], "one record per repo; only per-repo errors count");
});

// A fake `gh`: issue list returns [], create returns a URL, and `fail` maps repo -> stderr to throw.
function fakeGh({ fail = {}, existing = {} } = {}) {
  const calls = [];
  const fn = (args, input) => {
    calls.push({ args, input });
    const repo = args[args.indexOf("-R") + 1] ?? args[1]?.split("/").slice(1, 3).join("/");
    if (args[0] === "issue" && fail[repo]) throw Object.assign(new Error("Command failed"), { stderr: fail[repo] });
    if (args[0] === "issue" && args[1] === "list") return JSON.stringify(existing[repo] ?? []);
    if (args[0] === "issue" && args[1] === "create") return `https://github.com/${repo}/issues/7\n`;
    if (args[0] === "api") return "# readme";
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
  fn.calls = calls;
  fn.created = () => calls.filter((c) => c.args[1] === "create").map((c) => c.args[c.args.indexOf("-R") + 1]);
  return fn;
}
const clock = () => new Date("2026-11-12T10:00:00Z");

test("postIssues: a per-repo failure is recorded and skipped, a 403 stops the loop, 60 s between posts, marker dedupe", async () => {
  const servers = [at("a", "o1/a"), at("b", "o2/b"), at("c", "o3/c"), at("d", "o4/d"), at("e", "o5/e")];
  const ready = plan(world(servers)).send;
  const ledger = { issues: [] };
  const sleeps = [];
  const logs = [];
  const gh = fakeGh({ fail: { "o2/b": "HTTP 404: Not Found", "o5/e": "HTTP 403: secondary rate limit" }, existing: { "o3/c": [{ number: 2, url: "https://github.com/o3/c/issues/2", body: `${ISSUE_MARKER("c")}\nhi` }] } });
  const out = await postIssues({ ready, ledger, me: "sealmark-bot", gh, sleep: async (ms) => sleeps.push(ms), now: clock, today: TODAY, log: (m) => logs.push(m), save: () => {} });
  assert.deepEqual(gh.created(), ["o1/a", "o4/d"]);
  assert.equal(out.opened, 2);
  assert.equal(out.stopped, "rate-limited");
  assert.deepEqual(ledger.issues.map((i) => [i.repo, i.number, i.author]), [["o1/a", 7, "sealmark-bot"], ["o3/c", 2, "sealmark-bot"], ["o4/d", 7, "sealmark-bot"]], "an issue already there (marker) is recorded, not posted again");
  assert.equal(ledger.issues[0].postedAt, "2026-11-12T10:00:00.000Z");
  assert.deepEqual(sleeps, [PACE_MS], "one pause, between the two posts");
  assert.ok(PACE_MS >= 60_000);
  assert.deepEqual(ledger.failures.map((f) => [f.repo, f.failed, f.status]), [["o2/b", 1, "404"], ["o5/e", 0, "rate-limited"]]);
  assert.ok(logs.some((l) => /::warning::stopped posting/.test(l)));
});

test("postIssues: a hand-approved batch posts only what the draft shows, byte for byte", async () => {
  const servers = [at("a", "o1/a"), at("b", "o2/b"), at("c", "o3/c")];
  const ready = plan(world(servers)).send;
  const drafts = ready.map(draftFor);
  const approved = parseDrafts(renderDrafts({ drafts: [drafts[0], { ...drafts[1], body: drafts[1].body.replace("It got", "It received") }], skipped: [], reason: "r", today: TODAY, max: 2 }));
  const gh = fakeGh();
  const out = await postIssues({ ready, ledger: { issues: [] }, me: "bot", gh, sleep: async () => {}, now: clock, today: TODAY, log: () => {}, save: () => {}, approved });
  assert.deepEqual(gh.created(), ["o1/a"]);
  assert.deepEqual(out.skipped.map((s) => [s.repo, /byte for byte/.test(s.reason) ? "changed" : s.reason]), [["o2/b", "changed"], ["o3/c", "not in the approved draft"]]);
});

// ---- main(), on fakes ----

const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
function fakeWorld({ user = { login: "sealmark-bot" }, userStatus = 200, servers, ledger = { issues: [], emails: [] }, draft = null, comments = {} } = {}) {
  const files = new Map([
    [FILES.results, JSON.stringify({ servers })],
    [FILES.repos, JSON.stringify(Object.fromEntries(servers.map((x) => [x.id, { repo: x._repo, source: "npm", resolvedAt: TODAY }])))],
    [FILES.ledger, JSON.stringify(ledger)],
    [FILES.optout, JSON.stringify({ repos: [] })],
  ]);
  if (draft != null) files.set(FILES.draft, draft);
  const io = { read: (f) => files.get(f) ?? null, write: (f, s) => files.set(f, s), append: (f, s) => files.set(f, (files.get(f) ?? "") + s), remove: (f) => files.delete(f) };
  const requests = [];
  const fetchFn = async (url, init = {}) => {
    requests.push({ url, auth: init.headers?.authorization ?? null, method: init.method ?? "GET" });
    const u = new URL(url);
    if (u.hostname === "registry.npmjs.org") { const name = decodeURIComponent(u.pathname.split("/")[1]); const x = servers.find((s) => s.name === name); return json({ name, version: x.versionTested, repository: { url: `https://github.com/${x._repo}` } }); }
    if (u.pathname === "/user") return userStatus === 200 ? json(user) : json({ message: "Bad credentials" }, userStatus);
    const m = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
    if (m && !m[2]) return json({ full_name: m[1], has_issues: true });
    if (m && m[2] === "/contents/package.json") { const x = servers.find((s) => s._repo === m[1]); return new Response(JSON.stringify({ name: x.name, version: x.versionTested }), { status: 200 }); }
    if (m && /\/issues\/\d+\/comments$/.test(m[2])) return json(comments[m[1]] ?? []);
    return json({ message: "Not Found" }, 404);
  };
  return { files, io, fetchFn, requests };
}

test("main: a scheduled run with no OWNER_ISSUES_LIVE writes drafts only, even with the token set", async () => {
  const servers = [at("a", "o1/a"), at("b", "o2/b"), at("c", "o3/c")];
  const w = fakeWorld({ servers });
  const gh = fakeGh();
  const r = await main({ env: { OWNER_ISSUES_TOKEN: "tok", MAX_OWNER_ISSUES: "", GITHUB_TOKEN: "gt" }, argv: [], io: w.io, fetchFn: w.fetchFn, gh, sleep: async () => {}, now: clock, log: () => {} });
  assert.equal(r.live, false);
  assert.equal(gh.calls.length, 0, "gh is never called");
  const md = w.files.get(FILES.draft);
  assert.match(md, /Not filed: the OWNER_ISSUES_LIVE variable is not "1"/);
  assert.deepEqual([...parseDrafts(md).keys()], ["o1/a", "o2/b"], "the default cap is 2");
  assert.ok(w.requests.some((q) => q.url.endsWith("/user") && q.auth === "Bearer tok"), "the token is checked with GET /user in draft mode too");
  assert.equal(gate({ OWNER_ISSUES_TOKEN: "t", OWNER_ISSUES_LIVE: "" }, []).live, false);
  assert.equal(gate({ OWNER_ISSUES_TOKEN: "t", OWNER_ISSUES_LIVE: "1" }, ["--dry"]).live, false);
  assert.equal(gate({ OWNER_ISSUES_TOKEN: "", OWNER_ISSUES_LIVE: "1" }, []).live, false);
});

test("main: refuses a token that belongs to a SELF account", async () => {
  const servers = [at("a", "o1/a")];
  const w = fakeWorld({ servers, user: { login: "JordanAllenLewis" } });
  const gh = fakeGh();
  const logs = [];
  const r = await main({ env: { OWNER_ISSUES_TOKEN: "tok", OWNER_ISSUES_LIVE: "1" }, argv: [], io: w.io, fetchFn: w.fetchFn, gh, sleep: async () => {}, now: clock, log: (m) => logs.push(m) });
  assert.equal(r.live, false);
  assert.equal(r.error, "self");
  assert.equal(gh.calls.length, 0);
  assert.ok(logs.some((l) => /^::error::OWNER_ISSUES_TOKEN belongs to JordanAllenLewis/.test(l)));
  assert.match(w.files.get(FILES.draft), /the token belongs to JordanAllenLewis/);
});

test("main: a rejected token (401) warns, reads with GITHUB_TOKEN and posts nothing", async () => {
  const servers = [at("a", "o1/a")];
  const w = fakeWorld({ servers, userStatus: 401 });
  const gh = fakeGh();
  const logs = [];
  const r = await main({ env: { OWNER_ISSUES_TOKEN: "bad", OWNER_ISSUES_LIVE: "1", GITHUB_TOKEN: "gt" }, argv: [], io: w.io, fetchFn: w.fetchFn, gh, sleep: async () => {}, now: clock, log: (m) => logs.push(m) });
  assert.equal(r.live, false);
  assert.equal(gh.calls.length, 0);
  assert.ok(logs.some((l) => /^::warning::OWNER_ISSUES_TOKEN was rejected \(401\)/.test(l)));
  const reads = w.requests.filter((q) => q.url.startsWith("https://api.github.com/repos/"));
  assert.ok(reads.length && reads.every((q) => q.auth === "Bearer gt"), "read-only lookups fall back to GITHUB_TOKEN");
});

test("main: live and hand-approved posts only the committed draft, and a gh failure does not throw", async () => {
  const servers = [at("a", "o1/a"), at("b", "o2/b"), at("c", "o3/c")];
  const first = fakeWorld({ servers });
  await main({ env: {}, argv: [], io: first.io, fetchFn: first.fetchFn, sleep: async () => {}, now: clock, log: () => {} });
  const committed = first.files.get(FILES.draft).replace("Hi. [Sealmark]", "Hi there. [Sealmark]"); // o1/a edited after approval
  const w = fakeWorld({ servers, draft: committed });
  const gh = fakeGh({ fail: { "o2/b": "HTTP 422: Validation Failed" } });
  const r = await main({ env: { OWNER_ISSUES_TOKEN: "tok", OWNER_ISSUES_LIVE: "1", OWNER_ISSUES_APPROVED: "1" }, argv: [], io: w.io, fetchFn: w.fetchFn, gh, sleep: async () => {}, now: clock, log: () => {} });
  assert.equal(r.live, true);
  assert.deepEqual(gh.created(), [], "o1/a changed, o2/b failed with a per-repo error, o3/c was never drafted");
  assert.deepEqual(r.skipped.map((s) => s.repo), ["o1/a"]);
  const ledger = JSON.parse(w.files.get(FILES.ledger));
  assert.deepEqual(ledger.failures.map((f) => [f.repo, f.failed, f.status]), [["o2/b", 1, "422"]]);
  assert.equal(ledger.issues.length, 0);
});

test("main: replies from people are recorded once, opt-outs honoured, and the tracking issue is left to the workflow", async () => {
  const servers = [at("a", "o1/a")];
  const ledger = { issues: [{ channel: "issue", id: "a", repo: "o1/a", number: 5, at: "2026-11-11", author: "sealmark-bot", letter: "B" }], emails: [] };
  const comments = { "o1/a": [
    { id: 11, user: { login: "sealmark-bot", type: "User" }, body: "follow-up", created_at: "2026-11-11T09:00:00Z", html_url: "u0" },
    { id: 12, user: { login: "dependabot[bot]", type: "Bot" }, body: "bump", created_at: "2026-11-11T09:00:00Z", html_url: "u1" },
    { id: 13, user: { login: "amy", type: "User" }, body: "Please opt us out.", created_at: "2026-11-12T08:00:00Z", html_url: "https://github.com/o1/a/issues/5#issuecomment-13" },
  ] };
  const w = fakeWorld({ servers, ledger, comments });
  const logs = [];
  await main({ env: { GITHUB_STEP_SUMMARY: "summary.md" }, argv: [], io: w.io, fetchFn: w.fetchFn, sleep: async () => {}, now: clock, log: (m) => logs.push(m) });
  const saved = JSON.parse(w.files.get(FILES.ledger));
  assert.deepEqual(saved.replies.map((r) => [r.id, r.user, r.kind]), [[13, "amy", "removal"]]);
  assert.deepEqual(JSON.parse(w.files.get(FILES.optout)).repos, ["o1/a"]);
  assert.match(w.files.get(FILES.weekly), /\*\*removal\*\*: @amy on o1\/a#5/);
  assert.match(w.files.get("summary.md"), /## New replies this run/);
  assert.ok(logs.some((l) => /tracking issue not updated/.test(l)), "outside the fleet workflow no issue is created");
  assert.ok(!w.requests.some((q) => q.method !== "GET"), "nothing but reads");
  assert.equal(TRACKING_TITLE, "Owner replies to Sealmark issues");
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

test("main: fleet/owner-pick.json restricts the drafts and an approved run to the repositories it names", async () => {
  const servers = [at("a", "o1/a"), at("b", "o2/b"), at("c", "o3/c")];
  const pick = JSON.stringify({ repos: ["O3/C"] });
  const first = fakeWorld({ servers });
  first.files.set(FILES.pick, pick);
  await main({ env: {}, argv: [], io: first.io, fetchFn: first.fetchFn, sleep: async () => {}, now: clock, log: () => {} });
  assert.deepEqual([...parseDrafts(first.files.get(FILES.draft)).keys()], ["o3/c"], "only the picked repository is drafted");
  const w = fakeWorld({ servers, draft: first.files.get(FILES.draft) });
  w.files.set(FILES.pick, pick);
  const gh = fakeGh();
  await main({ env: { OWNER_ISSUES_TOKEN: "tok", OWNER_ISSUES_LIVE: "1", OWNER_ISSUES_APPROVED: "1" }, argv: [], io: w.io, fetchFn: w.fetchFn, gh, sleep: async () => {}, now: clock, log: () => {} });
  assert.equal(gh.created().length, 1);
  assert.match(JSON.stringify(gh.created()), /o3\/c/);
  assert.doesNotMatch(JSON.stringify(gh.created()), /o1\/a|o2\/b/);
});
