// node --test lib/   (npm test in web/)
// Grade lookup (site#66): /data/v1/lookup.json maps a package name, a repository or a results id to the graded servers, so
// an agent can read a server's grade before it installs it. Keys are normalised the way docs/guides/results-data says.
import { test } from "node:test";
import assert from "node:assert/strict";
import { githubKey, lookupIndex, lookupKeys, lookupProblems, npmKey, pypiKey, resolveLookup } from "./lookup.mjs";

const SITE = "https://sealmark.dev";
const srv = (over = {}) => ({ id: "dbhub", ecosystem: "npm", name: "@bytebase/dbhub", repo: "bytebase/dbhub", testedAt: "2026-11-18", ...over });
const fixture = () => [
  srv(),
  srv({ id: "fetch", ecosystem: "pypi", name: "mcp-server-fetch", repo: "modelcontextprotocol/servers", testedAt: "2026-11-17" }),
  srv({ id: "git", ecosystem: "pypi", name: "mcp-server-git", repo: "modelcontextprotocol/servers", testedAt: "2026-11-19" }),
  srv({ id: "reddit-research-mcp", ecosystem: "github", name: "jordanallenlewis/reddit-research-mcp", repo: "jordanallenlewis/reddit-research-mcp" }),
  srv({ id: "held-one", ecosystem: "npm", name: "held-one-mcp", repo: null }),
];

test("npm names: scope kept, version dropped, lowercased", () => {
  assert.equal(npmKey("@bytebase/dbhub"), "npm:@bytebase/dbhub");
  assert.equal(npmKey("@ByteBase/DBHub@2.0.0"), "npm:@bytebase/dbhub");
  assert.equal(npmKey("overwing-mcp@latest"), "npm:overwing-mcp");
  assert.equal(npmKey("not a name"), null);
  assert.equal(npmKey("@scope-only"), null);
  assert.equal(npmKey(""), null);
});

test("PyPI names: PEP 503 normalised, version and extras dropped", () => {
  assert.equal(pypiKey("MCP_Server.Fetch"), "pypi:mcp-server-fetch");
  assert.equal(pypiKey("mcp-server-fetch==2025.4.7"), "pypi:mcp-server-fetch");
  assert.equal(pypiKey("markitdown-mcp[all]>=0.0.1"), "pypi:markitdown-mcp");
  assert.equal(pypiKey("-bad"), null);
});

test("GitHub repositories: every common URL form, case-insensitive", () => {
  for (const s of [
    "bytebase/dbhub",
    "ByteBase/DBHub",
    "https://github.com/bytebase/dbhub",
    "https://github.com/bytebase/dbhub.git",
    "https://www.github.com/bytebase/dbhub/tree/main/src",
    "git+https://github.com/bytebase/dbhub.git",
    "git@github.com:bytebase/dbhub.git",
    "ssh://git@github.com/bytebase/dbhub",
    "github.com/bytebase/dbhub#readme",
  ]) assert.equal(githubKey(s), "github:bytebase/dbhub", s);
  assert.equal(githubKey("https://gitlab.com/bytebase/dbhub"), null);
  assert.equal(githubKey("bytebase"), null);
  assert.equal(githubKey("a/b/../c"), null);
});

test("lookupKeys reads prefixed keys, URLs and bare names", () => {
  assert.deepEqual(lookupKeys("npm:@ByteBase/dbhub@2.0.0"), ["npm:@bytebase/dbhub"]);
  assert.deepEqual(lookupKeys("https://www.npmjs.com/package/@bytebase/dbhub/v/2.0.0"), ["npm:@bytebase/dbhub"]);
  assert.deepEqual(lookupKeys("https://pypi.org/project/MCP-Server-Fetch/2025.4.7/"), ["pypi:mcp-server-fetch"]);
  assert.deepEqual(lookupKeys("https://github.com/Bytebase/dbhub"), ["github:bytebase/dbhub"]);
  assert.deepEqual(lookupKeys("@bytebase/dbhub"), ["npm:@bytebase/dbhub"]);
  assert.deepEqual(lookupKeys("bytebase/dbhub"), ["github:bytebase/dbhub"]);
  // A bare name could be any of three: the most specific first.
  assert.deepEqual(lookupKeys("mcp-server-fetch"), ["npm:mcp-server-fetch", "pypi:mcp-server-fetch", "id:mcp-server-fetch"]);
  assert.deepEqual(lookupKeys("id:dbhub"), ["id:dbhub"]);
  assert.deepEqual(lookupKeys("id:Has Space"), []);
  assert.deepEqual(lookupKeys(""), []);
  assert.deepEqual(lookupKeys(42), []);
});

test("the index: id, package and repository keys, several servers per repository, newest test date", () => {
  const ix = lookupIndex(fixture(), SITE);
  assert.equal(ix.version, "v1");
  assert.equal(ix.count, 5);
  assert.equal(ix.updated, "2026-11-19");
  assert.equal(ix.server, `${SITE}/data/v1/servers/{id}.json`);
  assert.deepEqual(ix.keys["npm:@bytebase/dbhub"], ["dbhub"]);
  assert.deepEqual(ix.keys["github:bytebase/dbhub"], ["dbhub"]);
  assert.deepEqual(ix.keys["id:dbhub"], ["dbhub"]);
  assert.deepEqual(ix.keys["pypi:mcp-server-fetch"], ["fetch"]);
  assert.deepEqual(ix.keys["github:modelcontextprotocol/servers"], ["fetch", "git"]);
  // A repository-sourced server is its repository: one key, no twin.
  assert.deepEqual(ix.keys["github:jordanallenlewis/reddit-research-mcp"], ["reddit-research-mcp"]);
  // Keys are sorted, so the file is stable between builds.
  assert.deepEqual(Object.keys(ix.keys), [...Object.keys(ix.keys)].sort());
});

test("a server whose page shows no repository gets no repository key", () => {
  const ix = lookupIndex(fixture(), SITE);
  const keys = Object.entries(ix.keys).filter(([, ids]) => ids.includes("held-one")).map(([k]) => k).sort();
  assert.deepEqual(keys, ["id:held-one", "npm:held-one-mcp"]);
});

test("resolveLookup: package, URL and id find the graded server; unknown and prototype names find nothing", () => {
  const ix = JSON.parse(JSON.stringify(lookupIndex(fixture(), SITE)));
  assert.deepEqual(resolveLookup(ix, "@bytebase/dbhub@2.0.0"), ["dbhub"]);
  assert.deepEqual(resolveLookup(ix, "https://github.com/modelcontextprotocol/servers/tree/main/src/git"), ["fetch", "git"]);
  assert.deepEqual(resolveLookup(ix, "mcp_server_git"), ["git"]); // bare name: npm misses, PyPI hits
  assert.deepEqual(resolveLookup(ix, "dbhub"), ["dbhub"]); // bare name: falls through to the id
  assert.deepEqual(resolveLookup(ix, "never-graded-mcp"), []);
  assert.deepEqual(resolveLookup(ix, "id:__proto__"), []);
  assert.deepEqual(resolveLookup(ix, "constructor"), []);
  assert.deepEqual(resolveLookup(null, "dbhub"), []);
});

test("an empty list (results switched off) gives an empty index", () => {
  assert.deepEqual(lookupIndex([], SITE), { version: "v1", updated: null, count: 0, server: `${SITE}/data/v1/servers/{id}.json`, keys: {} });
});

test("a name that is not a valid package name gets no package key but keeps its id", () => {
  const ix = lookupIndex([srv({ id: "odd", name: "Odd Name!", repo: null })], SITE);
  assert.deepEqual(ix.keys, { "id:odd": ["odd"] });
});

// lookupProblems: scripts/api-check.mjs rule 13 compares the built index with the list and the pages.
const listed = (over = {}) => fixture().map((x) => ({ id: x.id, ecosystem: x.ecosystem, name: x.name, held: x.id === "held-one", ...over }));
const pageLinks = (id) => fixture().find((x) => x.id === id)?.repo ?? null;

test("lookupProblems: the index built from the same servers is clean", () => {
  assert.deepEqual(lookupProblems(lookupIndex(fixture(), SITE), listed(), pageLinks), []);
});

test("lookupProblems: an id with no server file, a missing id or package key, a wrong count", () => {
  const ix = lookupIndex(fixture(), SITE);
  ix.keys["npm:ghost"] = ["ghost"];
  delete ix.keys["id:git"];
  delete ix.keys["pypi:mcp-server-fetch"];
  ix.count = 9;
  const p = lookupProblems(ix, listed(), pageLinks).join("\n");
  assert.match(p, /npm:ghost names ghost, which is not a listed server/);
  assert.match(p, /git: not found by id:git/);
  assert.match(p, /fetch: not found by pypi:mcp-server-fetch/);
  assert.match(p, /count 9 but 5 servers listed/);
});

test("lookupProblems: a held server with any key past its id and package, a repository its page does not link", () => {
  const ix = lookupIndex(fixture(), SITE);
  ix.keys["github:someone/held-one"] = ["held-one"];
  ix.keys["github:other/place"] = ["dbhub"];
  const p = lookupProblems(ix, listed(), pageLinks).join("\n");
  assert.match(p, /held-one: a server with a private finding is found by github:someone\/held-one/);
  assert.match(p, /dbhub: github:other\/place is not the repository its page shows/);
});

test("lookupProblems: a repository the page shows but the index lacks, and one that is only elsewhere on the page", () => {
  const ix = lookupIndex(fixture(), SITE);
  delete ix.keys["github:bytebase/dbhub"];
  ix.keys["github:jordanallenlewis/sealmark"] = ["fetch"]; // a link every page carries, not fetch's repository
  const p = lookupProblems(ix, listed(), pageLinks).join("\n");
  assert.match(p, /dbhub: its page shows github:bytebase\/dbhub but it is not found by it/);
  assert.match(p, /fetch: github:jordanallenlewis\/sealmark is not the repository its page shows/);
});

test("a malformed npm URL finds nothing instead of throwing", () => {
  assert.deepEqual(lookupKeys("https://www.npmjs.com/package/%E0%A4%A"), []);
});

test("lookupProblems: the shape is fixed", () => {
  const ix = { ...lookupIndex(fixture(), SITE), servers: [] };
  assert.match(lookupProblems(ix, listed(), pageLinks).join("\n"), /unexpected fields/);
  const bad = lookupIndex(fixture(), SITE);
  bad.keys["id:dbhub"] = "dbhub";
  assert.match(lookupProblems(bad, listed(), pageLinks).join("\n"), /id:dbhub: not a list of ids/);
  assert.match(lookupProblems(null, listed(), pageLinks).join("\n"), /not an object/);
});
