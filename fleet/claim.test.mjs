import test from "node:test";
import assert from "node:assert/strict";
import { CLAIM_PATH, MAX_BYTES, checkClaim, claimLink, parseClaim } from "./claim.mjs";

const file = (obj, extra = {}) => {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj);
  return { type: "file", encoding: "base64", size: Buffer.byteLength(text), content: Buffer.from(text).toString("base64"), ...extra };
};
const good = { sealmark: "claim/1", servers: ["a-mcp"] };

test("the claim file: a valid file and its optional settings", () => {
  assert.deepEqual(parseClaim(file(good)), { ok: true, servers: ["a-mcp"], issues: "on", retest: null });
  assert.deepEqual(parseClaim(file({ ...good, issues: "off", retest: "2026-11-25" })), { ok: true, servers: ["a-mcp"], issues: "off", retest: "2026-11-25" });
  assert.equal(parseClaim(file({ ...good, servers: ["a-mcp", "b.mcp", "c_mcp"] })).ok, true, "a monorepo names several ids");
});

test("the claim file: anything but a small plain file is no claim", () => {
  assert.equal(parseClaim({ missing: true }).ok, false);
  assert.equal(parseClaim(null).ok, false);
  assert.equal(parseClaim([file(good)]).why, "not-file", "a directory listing");
  assert.equal(parseClaim(file(good, { type: "symlink" })).why, "not-file");
  assert.equal(parseClaim(file(good, { type: "submodule" })).why, "not-file");
  assert.equal(parseClaim(file(good, { size: MAX_BYTES + 1 })).why, "too-big");
  assert.equal(parseClaim(file(good, { size: "10" })).why, "too-big");
  assert.equal(parseClaim(file(good, { encoding: "none" })).why, "encoding");
  // size says small, content is not: the decoded bytes are checked too
  const big = JSON.stringify({ ...good, x: "y".repeat(MAX_BYTES) });
  assert.equal(parseClaim(file(big, { size: 10 })).why, "too-big");
});

test("the claim file: a strict shape, every other shape is invalid", () => {
  const why = (obj) => parseClaim(file(obj)).why;
  assert.equal(why("not json"), "not-json");
  assert.equal(why("﻿" + JSON.stringify(good)), "not-json");
  assert.equal(why("[]"), "shape");
  assert.equal(why("null"), "shape");
  assert.equal(why({ ...good, sealmark: "claim/2" }), "version");
  assert.equal(why({ servers: ["a-mcp"] }), "version");
  assert.equal(why({ ...good, contact: "me@example.com" }), "unknown-key");
  assert.equal(why({ ...good, servers: [] }), "servers");
  assert.equal(why({ ...good, servers: "a-mcp" }), "servers");
  assert.equal(why({ ...good, servers: [1] }), "servers");
  assert.equal(why({ ...good, servers: ["A Server <b>"] }), "servers");
  assert.equal(why({ ...good, servers: Array.from({ length: 21 }, (_, i) => `s${i}`) }), "servers");
  assert.equal(why({ ...good, servers: ["x".repeat(101)] }), "servers");
  assert.equal(why({ ...good, issues: "OFF" }), "issues");
  assert.equal(why({ ...good, issues: false }), "issues");
  assert.equal(why({ ...good, retest: "2026-02-30" }), "retest");
  assert.equal(why({ ...good, retest: "tomorrow" }), "retest");
  assert.equal(why({ ...good, retest: 20261125 }), "retest");
});

test("a key named __proto__ in the file is an unknown key, never a prototype", () => {
  const text = '{"sealmark":"claim/1","servers":["a-mcp"],"__proto__":{"issues":"off"}}';
  assert.equal(parseClaim(file(text)).why, "unknown-key");
});

test("the link a claim may come from: npm repository, PyPI source URLs, the launch repository; never a homepage", () => {
  const npm = { id: "a", ecosystem: "npm", name: "a" };
  assert.equal(claimLink(npm, { repository: { url: "git+https://github.com/O/r.git" } }), "O/r");
  assert.equal(claimLink(npm, { repository: "github:o/r" }), "o/r");
  assert.equal(claimLink(npm, { homepage: "https://github.com/o/r" }), null);
  assert.equal(claimLink(npm, { bugs: { url: "https://github.com/o/r/issues" } }), null);
  assert.equal(claimLink(npm, null), null);
  const py = { id: "p", ecosystem: "pypi", name: "p" };
  assert.equal(claimLink(py, { project_urls: { Homepage: "https://github.com/x/sdk", Source: "https://github.com/o/r" } }), "o/r");
  assert.equal(claimLink(py, { project_urls: { "source code": "https://github.com/o/r" } }), "o/r", "keys in any case");
  assert.equal(claimLink(py, { project_urls: { Homepage: "https://github.com/o/r" }, home_page: "https://github.com/o/r" }), null);
  assert.equal(claimLink(py, { project_urls: { Documentation: "https://github.com/o/r" } }), null);
  assert.equal(claimLink({ id: "g", ecosystem: "github", name: "o/r", launch: "npx -y github:o/r" }, null), "o/r");
  assert.equal(claimLink({ id: "g", ecosystem: "github", name: "o/r" }, null), "o/r");
  assert.equal(claimLink({ id: "x", ecosystem: "docker", name: "x" }, {}), null);
});

const server = { id: "a-mcp", ecosystem: "npm", name: "a-mcp" };
const repoObj = { full_name: "Org/a-mcp", id: 42, fork: false };
const apiWith = (contents, calls = []) => async (path) => { calls.push(path); return contents; };

test("a valid file in the linked repository naming the server is a claim", async () => {
  const calls = [];
  const r = await checkClaim({ server, stored: "org/a-mcp", link: "org/a-mcp", repoObj, api: apiWith(file({ ...good, servers: ["a-mcp"], issues: "off" }), calls), today: "2026-11-25" });
  assert.equal(r.outcome, "claimed");
  assert.deepEqual(r.claim, { repo: "Org/a-mcp", repoId: 42, checkedAt: "2026-11-25", issues: "off" });
  assert.deepEqual(calls, [`/repos/Org/a-mcp/contents/${CLAIM_PATH}`]);
  const t = await checkClaim({ server, stored: "org/a-mcp", link: "org/a-mcp", repoObj, api: apiWith(file({ ...good, retest: "2026-11-24" })), today: "2026-11-25" });
  assert.equal(t.claim.retest, "2026-11-24");
});

test("a renamed repository: the current link may match the stored name or the canonical one", async () => {
  const renamed = await checkClaim({ server, stored: "old/a-mcp", link: "Org/a-mcp", repoObj, api: apiWith(file(good)), today: "2026-11-25" });
  assert.equal(renamed.outcome, "claimed");
  const stillOld = await checkClaim({ server, stored: "old/a-mcp", link: "old/a-mcp", repoObj, api: apiWith(file(good)), today: "2026-11-25" });
  assert.equal(stillOld.outcome, "claimed");
});

test("no claim: no strict link, a link that differs, a fork, a missing repository, no file, a file that does not name the server", async () => {
  const base = { server, stored: "org/a-mcp", link: "org/a-mcp", repoObj, today: "2026-11-25" };
  const calls = [];
  const none = async (o) => (await checkClaim({ ...base, api: apiWith(file(good), calls), ...o }));
  assert.deepEqual(await none({ link: null }), { claim: null, outcome: "no-link" });
  assert.deepEqual(await none({ stored: null }), { claim: null, outcome: "no-link" });
  assert.deepEqual(await none({ link: "someone/sdk" }), { claim: null, outcome: "link-differs" });
  assert.deepEqual(await none({ repoObj: { ...repoObj, fork: true } }), { claim: null, outcome: "fork" });
  assert.deepEqual(await none({ repoObj: { missing: true } }), { claim: null, outcome: "no-link" });
  assert.deepEqual(await none({ repoObj: { full_name: "Org/a-mcp" } }), { claim: null, outcome: "no-link" }, "no numeric id");
  assert.equal(calls.length, 0, "the file is never read when the link does not hold");
  assert.deepEqual(await checkClaim({ ...base, api: apiWith({ missing: true }) }), { claim: null, outcome: "none" });
  assert.deepEqual(await checkClaim({ ...base, api: apiWith(file({ ...good, servers: ["other"] })) }), { claim: null, outcome: "not-named" });
  assert.deepEqual(await checkClaim({ ...base, api: apiWith(file("{")) }), { claim: null, outcome: "invalid" });
});

test("a repository whose id changed ends the claim, and it stays ended", async () => {
  const prev = { repo: "Org/a-mcp", repoId: 41, checkedAt: "2026-11-20", issues: "on" };
  const r = await checkClaim({ server, stored: "org/a-mcp", link: "org/a-mcp", repoObj, api: apiWith(file(good)), today: "2026-11-25", prev });
  assert.deepEqual(r, { claim: { ended: "repository-changed", repoId: 41, checkedAt: "2026-11-25" }, outcome: "repository-changed" });
  const again = await checkClaim({ server, stored: "org/a-mcp", link: "org/a-mcp", repoObj, api: apiWith(file(good)), today: "2026-11-26", prev: r.claim });
  assert.equal(again.outcome, "repository-changed");
  assert.equal(again.claim.repoId, 41);
  const same = await checkClaim({ server, stored: "org/a-mcp", link: "org/a-mcp", repoObj, api: apiWith(file(good)), today: "2026-11-25", prev: { ...prev, repoId: 42 } });
  assert.equal(same.outcome, "claimed");
});

test("a failed read of the file throws, so the caller keeps the last state", async () => {
  const api = async () => { const e = new Error("GitHub GET: 502"); e.status = 502; throw e; };
  await assert.rejects(checkClaim({ server, stored: "org/a-mcp", link: "org/a-mcp", repoObj, api, today: "2026-11-25" }), /502/);
});
