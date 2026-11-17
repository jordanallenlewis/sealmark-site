// node --test lib/   (npm test in web/)
// Topic pages (site#56): which graded servers a "best graded for <topic>" page lists, why, and in what order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MIN_SERVERS, TOPICS, topicMatch, topicPages, topicRows, whyText } from "./topics.mjs";

const pk = (id, letter = "A", over = {}) => ({ id, status: "graded", letter, provisional: false, ...over });
const srv = (id, packs, over = {}) => ({ id, name: id, testedAt: "2026-11-17", packs: [pk("core"), ...packs], coverage: { validCalls: 10 }, ...over });
const DB = TOPICS.find((t) => t.id === "databases");
const no = () => false;

test("a server joins a topic by graded test area, declared keyword, name, then description, and says which", () => {
  assert.deepEqual(topicMatch(srv("a", [pk("db", "F")]), null, DB), { from: "area", term: "db" });
  assert.deepEqual(topicMatch(srv("b", []), { keywords: ["mcp", "postgresql"] }, DB), { from: "keyword", term: "postgresql" });
  assert.deepEqual(topicMatch(srv("c", [], { name: "@x/mysql-server" }), null, DB), { from: "name", term: "mysql" });
  assert.deepEqual(topicMatch(srv("d", []), { description: "Query your SQLite files." }, DB), { from: "description", term: "sqlite" });
  // an area counts only when it was graded: n/a or inconclusive says nothing about what the server is for
  assert.equal(topicMatch(srv("e", [{ id: "db", status: "na", letter: null }]), null, DB), null);
  assert.equal(topicMatch(srv("f", [{ id: "db", status: "inconclusive", letter: null }]), null, DB), null);
});

test("terms match whole words only; hyphens, slashes and spaces are the same", () => {
  assert.equal(topicMatch(srv("a", []), { description: "A NoSQL-free note taker", keywords: ["mysqlish"] }, DB), null);
  const git = TOPICS.find((t) => t.id === "git-devops");
  assert.deepEqual(topicMatch(srv("b", []), { keywords: ["ci-cd"] }, git), { from: "keyword", term: "ci/cd" });
  assert.equal(topicMatch(srv("c", []), { description: "digital art tools" }, git), null);
  const web = TOPICS.find((t) => t.id === "browser-automation");
  assert.deepEqual(topicMatch(srv("d", []), { keywords: ["browser-automation"] }, web), { from: "keyword", term: "browser automation" });
});

test("malformed or missing facts never match and never throw", () => {
  for (const about of [undefined, null, {}, { keywords: "postgres" }, { keywords: [7, null] }, { description: 42 }]) assert.equal(topicMatch(srv("x", []), about, DB), null);
});

test("only graded servers are listed; deeper-graded first, then grade, firm before provisional, more areas, more calls, name", () => {
  const facts = Object.fromEntries(["a", "b", "c", "d", "e", "f", "g", "none"].map((id) => [id, { about: { keywords: ["database"] } }]));
  const servers = [
    srv("g", [pk("effects", "C")]),
    srv("f", [], { coverage: { validCalls: 3 } }),
    srv("e", [], { coverage: { validCalls: 30 } }),
    srv("d", [pk("effects"), pk("net")]),
    srv("c", [pk("effects", "A", { provisional: true })]),
    srv("b", [pk("db", "F")]),
    srv("a", [], { name: "aa", coverage: { validCalls: 30 } }),
    { id: "none", name: "none", testedAt: "2026-11-17", packs: [{ id: "core", status: "inconclusive", letter: null }] },
  ];
  const rows = topicRows(servers, facts, DB, (x) => x.id === "b");
  assert.deepEqual(rows.map((r) => r.id), ["d", "c", "g", "b", "a", "e", "f"]);
  assert.equal(rows.find((r) => r.id === "b").held, true);
  assert.equal(rows.find((r) => r.id === "c").provisional, true);
  assert.deepEqual(rows.find((r) => r.id === "d").areas, ["effects", "net"]);
  assert.ok(!rows.some((r) => r.id === "none"), "a server with no grade is never listed as graded");
});

test("a topic gets a page only with MIN_SERVERS graded servers", () => {
  const facts = {};
  const mk = (n) => Array.from({ length: n }, (_, i) => srv(`s${i}`, [pk("sqlite")]));
  assert.equal(topicPages(mk(MIN_SERVERS - 1), facts, no).length, 0);
  const pages = topicPages(mk(MIN_SERVERS), facts, no);
  assert.deepEqual(pages.map((p) => p.id), ["databases"]);
  assert.equal(pages[0].rows.length, MIN_SERVERS);
});

test("topic slugs are unique and URL-safe; every topic has terms", () => {
  assert.equal(new Set(TOPICS.map((t) => t.id)).size, TOPICS.length);
  for (const t of TOPICS) { assert.match(t.id, /^[a-z0-9-]+$/); assert.ok(t.terms.length > 0); }
});

test("why text names the rule", () => {
  const label = (id) => ({ db: "Database" })[id] ?? id;
  assert.equal(whyText({ from: "area", term: "db" }, label), "graded in the Database test area");
  assert.equal(whyText({ from: "keyword", term: "sql" }, label), "package keyword “sql”");
  assert.equal(whyText({ from: "description", term: "sql" }, label), "package description says “sql”");
});

test("real data: at least 8 topic pages, each row graded and its rule true", () => {
  const servers = JSON.parse(readFileSync(new URL("../content/data/server-results.json", import.meta.url), "utf8")).servers;
  let facts = {};
  try { facts = JSON.parse(readFileSync(new URL("../../fleet/server-facts.json", import.meta.url), "utf8")).servers; } catch { return; }
  const pages = topicPages(servers, facts, no);
  assert.ok(pages.length >= 8, `${pages.length} topic pages`);
  for (const p of pages) for (const r of p.rows) {
    const x = servers.find((v) => v.id === r.id);
    assert.ok(x.packs.some((k) => k.status === "graded" && k.letter === r.letter));
    assert.deepEqual(topicMatch(x, facts[x.id]?.about, p), r.why);
  }
});
