import test from "node:test";
import assert from "node:assert/strict";
import { STALE_DAYS, serverFacts } from "./server-facts.mjs";

const server = { id: "a", ecosystem: "npm", versionTested: "1.7.1" };
const entry = (over = {}) => ({
  checkedAt: "2026-11-16",
  source: "npm",
  license: "MIT",
  latest: { version: "1.8.0", date: "2026-11-14" },
  repo: { name: "o/r", pushedAt: "2026-11-10", archived: false, openIssues: 4 },
  ...over,
});
const view = (e, o = {}) => serverFacts(e, server, { held: false, today: "2026-11-16", ...o });

test("no entry, or nothing to show: no block", () => {
  assert.equal(view(undefined), null);
  assert.equal(view(entry({ license: null, latest: null, repo: null })), null);
});

test("the facts, in the page's words", () => {
  const f = view(entry());
  assert.equal(f.license, "MIT");
  assert.equal(f.licenseFrom, "package");
  assert.deepEqual(f.latest, { version: "1.8.0", date: "14 Nov 2026", graded: false });
  assert.deepEqual(f.repo, { name: "o/r", url: "https://github.com/o/r", pushed: "10 Nov 2026", archived: false, openIssues: 4 });
  assert.equal(f.checked, "16 Nov 2026");
  assert.equal(f.from, "npm and GitHub");
});

test("the latest release is the graded one: said so, never 'newer'", () => {
  assert.equal(view(entry({ latest: { version: "1.7.1", date: "2026-11-01" } })).latest.graded, true);
  assert.equal(view(entry({ latest: { version: "v1.7.1", date: null } })).latest.graded, true);
});

test("a license read from the repository says so", () => {
  assert.equal(view(entry({ licenseFrom: "repo" })).licenseFrom, "repo");
});

test("a server under private disclosure shows no repository facts", () => {
  const f = view(entry(), { held: true });
  assert.equal(f.repo, null);
  assert.equal(f.latest, null, "a newer release beside a held finding would point at the fix");
  assert.equal(f.license, "MIT");
});

test("an old entry is not shown: the facts may no longer be true", () => {
  assert.equal(view(entry({ checkedAt: "2026-10-01" })), null);
  assert.ok(view(entry({ checkedAt: "2026-11-16" })));
  assert.equal(STALE_DAYS, 30);
});

test("someone else's text is checked again before it reaches the page", () => {
  assert.equal(view(entry({ license: "MIT\u202eTIM" })).license, "MIT TIM");
  assert.equal(view(entry({ license: "x".repeat(61) })).license, null);
  assert.equal(view(entry({ repo: { name: "o/r/../../evil", pushedAt: null, archived: false, openIssues: 1 } })).repo, null);
  assert.equal(view(entry({ repo: { name: "o/r", pushedAt: "nope", archived: "yes", openIssues: -3 } })).repo.openIssues, null);
  assert.equal(view(entry({ repo: { name: "o/r", pushedAt: "nope", archived: "yes", openIssues: 2 } })).repo.archived, false);
  assert.equal(view(entry({ latest: { version: "1.0.0\n<b>", date: "x" } })).latest, null);
});

test("PyPI and GitHub sources are named", () => {
  assert.equal(view(entry({ source: "pypi" })).from, "PyPI and GitHub");
  assert.equal(view(entry({ source: "pypi", repo: null })).from, "PyPI");
  assert.equal(view(entry({ source: "github" })).from, "GitHub");
});

test("npm's own license words are spelled out", () => {
  assert.equal(view(entry({ license: "SEE LICENSE IN LICENSE.md" })).license, "in the file LICENSE.md, as the package says");
  assert.equal(view(entry({ license: "UNLICENSED" })).license, "UNLICENSED (npm's word for no rights granted to others)");
  assert.equal(view(entry({ license: "Unlicense" })).license, "Unlicense");
});

test("a server started from its repository has no package: its license is simply the repository's", () => {
  assert.equal(view(entry({ source: "github", licenseFrom: "repo" })).licenseFrom, "package");
});

test("review fixes: a server started from its repository", () => {
  const gh = serverFacts(entry({ source: "github", latest: { version: "1.7.1", date: "2026-11-01" } }), { ...server, ecosystem: "github" }, { held: false, today: "2026-11-16" });
  assert.equal(gh.latest.graded, null, "an unpinned repository launch: which commit was graded is unknown");
  assert.equal(gh.kind, "project");
  assert.equal(view(entry()).kind, "package");
});

test("review fixes: npm's words only for npm, plain ASCII licenses only", () => {
  assert.equal(view(entry({ source: "pypi", license: "UNLICENSED" })).license, "UNLICENSED");
  assert.equal(view(entry({ license: "MIT\u3164" })).license, null);
  assert.equal(view(entry({ license: "MIT, Apache Software License, BSD License" })).license, "MIT, Apache Software License, BSD License");
});

// ---- the Maintainer block (sealmark-site#69) ----
import { CLAIM_PATH, maintainerClaim } from "./server-facts.mjs";
import { CLAIM_PATH as FLEET_CLAIM_PATH } from "../../fleet/claim.mjs";

const claimed = (over = {}) => entry({ claim: { repo: "o/r", repoId: 7, checkedAt: "2026-11-16", issues: "on" }, claimable: true, ...over });
const mc = (e, o = {}) => maintainerClaim(e, { id: "a-mcp" }, { held: false, today: "2026-11-16", ...o });

test("maintainer: the site and the fleet name the same claim file", () => {
  assert.equal(CLAIM_PATH, FLEET_CLAIM_PATH);
});

test("maintainer: a claim that holds", () => {
  assert.deepEqual(mc(claimed()), { state: "claimed", repo: "o/r", url: "https://github.com/o/r", checked: "16 Nov 2026" });
});

test("maintainer: a repository that may claim gets the file to commit, with this server's id", () => {
  const m = mc(entry({ claimable: true }));
  assert.equal(m.state, "unclaimed");
  assert.equal(m.repo, "o/r");
  assert.equal(m.path, ".github/sealmark-claim.json");
  assert.deepEqual(JSON.parse(m.file), { sealmark: "claim/1", servers: ["a-mcp"] });
});

test("maintainer: nothing for a held server, a stale entry or claim, an ended claim, or a repository that may not claim", () => {
  assert.equal(mc(claimed(), { held: true }), null);
  assert.equal(mc(entry({ claimable: true }), { held: true }), null);
  assert.equal(mc(claimed(), { today: "2026-12-30" }), null, "the entry is past STALE_DAYS");
  const oldClaim = claimed({ claim: { repo: "o/r", repoId: 7, checkedAt: "2026-10-01" } });
  assert.equal(mc(oldClaim).state, "unclaimed", "a claim not re-read for STALE_DAYS is not shown");
  assert.equal(mc(claimed({ claim: { ended: "repository-changed", repoId: 6, checkedAt: "2026-11-16" }, claimable: false })), null);
  assert.equal(mc(entry()), null, "claimable unset: the link is a homepage or a fork");
  assert.equal(mc(entry({ claimable: true, repo: null })), null);
  assert.equal(mc(claimed({ claim: { repo: "o/r/../x", checkedAt: "2026-11-16" }, claimable: false })), null);
  assert.equal(maintainerClaim(entry({ claimable: true }), { id: "A Bad id" }, { held: false, today: "2026-11-16" }), null);
  assert.equal(mc(undefined), null);
});
