import test from "node:test";
import assert from "node:assert/strict";
import { clean, collect, githubGetter, githubLatest, lookup, npmLatest, npmLicense, pypiLatest, pypiLicense, repoFacts } from "./server-facts.mjs";

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const ghRepo = (over = {}) => ({ full_name: "o/r", license: { spdx_id: "Apache-2.0" }, pushed_at: "2026-11-10T08:00:00Z", archived: false, open_issues_count: 4, ...over });

test("clean drops control and format characters and over-long values", () => {
  assert.equal(clean("MIT\u202e"), "MIT");
  assert.equal(clean("a\u200bb"), "a b");
  assert.equal(clean("x".repeat(61)), null);
  assert.equal(clean("  "), null);
  assert.equal(clean(42), null);
});

test("npm license shapes", () => {
  assert.equal(npmLicense({ license: "MIT" }), "MIT");
  assert.equal(npmLicense({ license: { type: "ISC" } }), "ISC");
  assert.equal(npmLicense({ licenses: [{ type: "BSD-3-Clause" }] }), "BSD-3-Clause");
  assert.equal(npmLicense({}), null);
});

test("PyPI license: expression, short field, classifier; never a pasted license text", () => {
  assert.equal(pypiLicense({ license_expression: "MIT", license: "whatever" }), "MIT");
  assert.equal(pypiLicense({ license: "Apache 2.0" }), "Apache 2.0");
  assert.equal(pypiLicense({ license: "MIT License\n\nCopyright (c) 2025 ...", classifiers: ["License :: OSI Approved :: MIT License"] }), "MIT License");
  assert.equal(pypiLicense({ license: "UNKNOWN" }), null);
  assert.equal(pypiLicense({ classifiers: ["License :: Other/Proprietary License"] }), null);
});

test("latest release from npm, PyPI and GitHub", () => {
  assert.deepEqual(npmLatest({ "dist-tags": { latest: "1.8.0" }, time: { "1.8.0": "2026-11-14T10:00:00.000Z" } }), { version: "1.8.0", date: "2026-11-14" });
  assert.deepEqual(npmLatest({ "dist-tags": { latest: "1.8.0" } }), { version: "1.8.0", date: null });
  assert.equal(npmLatest({}), null);
  assert.deepEqual(pypiLatest({ info: { version: "0.4.1" }, urls: [{ upload_time_iso_8601: "2026-11-02T01:00:00Z" }, { upload_time_iso_8601: "2026-11-01T23:00:00Z" }] }), { version: "0.4.1", date: "2026-11-01" });
  assert.deepEqual(githubLatest({ tag_name: "v2.0.1", published_at: "2026-10-01T00:00:00Z" }), { version: "2.0.1", date: "2026-10-01" });
  assert.equal(githubLatest({ tag_name: "v3.0.0-rc1", prerelease: true }), null);
  assert.equal(githubLatest({ missing: true }), null);
});

test("repo facts keep only plain values", () => {
  assert.deepEqual(repoFacts(ghRepo()), { name: "o/r", license: "Apache-2.0", pushedAt: "2026-11-10", archived: false, openIssues: 4 });
  assert.equal(repoFacts(ghRepo({ license: { spdx_id: "NOASSERTION" } })).license, null);
  assert.equal(repoFacts(ghRepo({ full_name: "o/r/../x" })), null);
  assert.equal(repoFacts(ghRepo({ open_issues_count: -1 })).openIssues, null);
  assert.equal(repoFacts({ missing: true }), null);
});

test("lookup: npm package license wins; the repo's is the fallback and says so", async () => {
  const fetchFn = async () => json({ "dist-tags": { latest: "1.0.0" }, time: { "1.0.0": "2026-11-01T00:00:00Z" }, versions: { "1.0.0": { license: "MIT" } } });
  const api = async () => ghRepo();
  const e = await lookup({ id: "a", ecosystem: "npm", name: "a" }, "o/r", { fetchFn, api, today: "2026-11-16" });
  assert.equal(e.license, "MIT");
  assert.equal(e.licenseFrom, undefined);
  assert.equal(e.repo.license, undefined);
  const noLic = async () => json({ "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": {} } });
  const f = await lookup({ id: "a", ecosystem: "npm", name: "a" }, "o/r", { fetchFn: noLic, api, today: "2026-11-16" });
  assert.equal(f.license, "Apache-2.0");
  assert.equal(f.licenseFrom, "repo");
});

test("lookup: a github server's latest is its latest release", async () => {
  const api = async (p) => (p.endsWith("/releases/latest") ? { tag_name: "v1.2.0", published_at: "2026-11-03T00:00:00Z" } : ghRepo());
  const e = await lookup({ id: "g", ecosystem: "github", name: "o/r" }, "o/r", { fetchFn: async () => { throw new Error("no fetch"); }, api, today: "2026-11-16" });
  assert.deepEqual(e.latest, { version: "1.2.0", date: "2026-11-03" });
  assert.equal(e.repo.name, "o/r");
});

test("collect: refreshes old entries, keeps the last one when a lookup fails, drops removed servers", async () => {
  const servers = [{ id: "a", ecosystem: "npm", name: "a" }, { id: "b", ecosystem: "npm", name: "b" }, { id: "c", ecosystem: "npm", name: "c" }];
  const previous = { servers: { a: { checkedAt: "2026-11-16", license: "A" }, b: { checkedAt: "2026-11-10", license: "B" }, gone: { checkedAt: "2026-11-01" } } };
  const fetchFn = async (url) => (url.endsWith("/b") ? json({}, 503) : json({ "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": { license: "MIT" } } }));
  const out = await collect({ servers, repos: {}, previous, today: "2026-11-16", fetchFn, api: async () => ({ missing: true }) });
  assert.deepEqual(Object.keys(out.servers), ["a", "b", "c"]);
  assert.equal(out.servers.a.license, "A"); // fresh: not looked up
  assert.equal(out.servers.b.license, "B"); // failed: kept, still dated 2026-11-10
  assert.equal(out.servers.b.checkedAt, "2026-11-10");
  assert.equal(out.servers.c.license, "MIT");
  assert.equal(out.servers.c.repo, null);
});

test("collect: at most max lookups, oldest first", async () => {
  const servers = ["a", "b", "c"].map((id) => ({ id, ecosystem: "npm", name: id }));
  const previous = { servers: { a: { checkedAt: "2026-11-12" }, b: { checkedAt: "2026-11-10" } } };
  const seen = [];
  const fetchFn = async (url) => { seen.push(url.split("/").pop()); return json({ "dist-tags": { latest: "1.0.0" } }); };
  await collect({ servers, repos: {}, previous, today: "2026-11-16", fetchFn, api: async () => ({}), max: 2 });
  assert.deepEqual(seen, ["c", "b"]);
});

test("review fixes: classifiers, several npm licenses, no repository stand-in when the package names one", async () => {
  assert.equal(pypiLicense({ classifiers: ["License :: OSI Approved"] }), null);
  assert.equal(pypiLicense({ classifiers: ["License :: OSI Approved :: MIT License", "License :: OSI Approved :: Apache Software License"] }), "MIT License, Apache Software License");
  assert.equal(pypiLicense({ license: "Other", classifiers: [] }), "Other");
  assert.equal(npmLicense({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] }), null);
  const api = async () => ghRepo({ license: { spdx_id: "MIT" } });
  const long = async () => json({ "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": { license: "x".repeat(80) } } });
  const e = await lookup({ id: "a", ecosystem: "npm", name: "a" }, "o/r", { fetchFn: long, api, today: "2026-11-16" });
  assert.equal(e.license, null, "the package names a license we cannot show: the repository's MIT is no stand-in");
  const prop = async () => json({ info: { version: "1.0", license: "UNKNOWN", classifiers: ["License :: OSI Approved"] }, urls: [] });
  assert.equal((await lookup({ id: "p", ecosystem: "pypi", name: "p" }, "o/r", { fetchFn: prop, api, today: "2026-11-16" })).license, null);
});

test("review fixes: collect stops on a GitHub rate limit and at its time budget", async () => {
  const servers = ["a", "b", "c"].map((id) => ({ id, ecosystem: "github", name: `o/${id}` }));
  const repos = { a: { repo: "o/a" }, b: { repo: "o/b" }, c: { repo: "o/c" } };
  let calls = 0;
  const limited = async () => { calls += 1; const e = new Error("403"); e.status = 403; throw e; };
  await collect({ servers, repos, previous: { servers: {} }, today: "2026-11-16", fetchFn: async () => json({}), api: limited });
  assert.equal(calls, 1, "no more GitHub calls after a 403");
  let t = 0;
  const seen = [];
  await collect({ servers, repos, previous: { servers: {} }, today: "2026-11-16", fetchFn: async () => json({}), api: async (p) => { seen.push(p); t += 1000; return ghRepo(); }, budgetMs: 1500, clock: () => t });
  assert.ok(seen.filter((p) => !p.endsWith("/releases/latest")).length < 3, "stops when the budget is used");
});

test("githubGetter: its own token and timeout; 404 is missing", async () => {
  let init;
  const get = githubGetter(async (url, i) => { init = i; return json({}, 404); }, "gt");
  assert.deepEqual(await get("/repos/o/r"), { missing: true });
  assert.equal(init.headers.authorization, "Bearer gt");
  assert.ok(init.signal, "every request has a timeout");
});
