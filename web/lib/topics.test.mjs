// node --test lib/   (npm test in web/)
// Topic pages (site#56): which graded servers a "best graded for <topic>" page lists, why, and in what order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MIN_SERVERS, TOPICS, grade, topicMatch, topicPages, topicRows, whyText } from "./topics.mjs";

const pk = (id, letter = "A", over = {}) => ({ id, status: "graded", letter, provisional: false, ...over });
const srv = (id, packs, over = {}) => ({ id, name: id, testedAt: "2026-11-17", packs: [pk("core"), ...packs], coverage: { validCalls: 10 }, ...over });
const DB = TOPICS.find((t) => t.id === "databases");
const no = () => false;

test("a server joins a topic by graded test area, declared keyword, then name, and says which", () => {
  assert.deepEqual(topicMatch(srv("a", [pk("db", "F")]), null, DB), { from: "area", term: "db" });
  assert.deepEqual(topicMatch(srv("b", []), { keywords: ["mcp", "postgresql"] }, DB), { from: "keyword", term: "postgresql" });
  assert.deepEqual(topicMatch(srv("c", [], { name: "@x/mysql-server" }), null, DB), { from: "name", term: "mysql" });
  // an area counts only when it was graded: n/a or inconclusive says nothing about what the server is for
  assert.equal(topicMatch(srv("e", [{ id: "db", status: "na", letter: null }]), null, DB), null);
  assert.equal(topicMatch(srv("f", [{ id: "db", status: "inconclusive", letter: null }]), null, DB), null);
});

test("terms match whole words only; hyphens, slashes and spaces are the same", () => {
  assert.equal(topicMatch(srv("a", [], { name: "nosql-notes" }), { keywords: ["mysqlish"] }, DB), null);
  const git = TOPICS.find((t) => t.id === "git-devops");
  assert.deepEqual(topicMatch(srv("b", []), { keywords: ["ci-cd"] }, git), { from: "keyword", term: "ci/cd" });
  assert.equal(topicMatch(srv("c", [], { name: "digital-art" }), null, git), null);
  const web = TOPICS.find((t) => t.id === "browser-automation");
  assert.deepEqual(topicMatch(srv("d", []), { keywords: ["browser-automation"] }, web), { from: "keyword", term: "browser automation" });
});

test("malformed or missing facts never match and never throw", () => {
  for (const about of [undefined, null, {}, { keywords: "postgres" }, { keywords: [7, null] }, { description: 42 }]) assert.equal(topicMatch(srv("x", []), about, DB), null);
});

test("free text never places a server: descriptions are ignored (review on site#56: 'row level security', a badge URL)", () => {
  const sec = TOPICS.find((t) => t.id === "security");
  const git = TOPICS.find((t) => t.id === "git-devops");
  assert.equal(topicMatch(srv("acct", []), { description: "Accounting with row level security", keywords: ["accounting"] }, sec), null);
  assert.equal(topicMatch(srv("badge", []), { description: "[![npm](https://github.com/x/y/badge.svg)]" }, git), null);
});

test("the grade matches the rest of the site: the first of the tied lowest areas decides provisional", () => {
  assert.deepEqual(grade(srv("t", [pk("net", "A", { provisional: true })])), { letter: "A", provisional: false });
  assert.deepEqual(grade({ packs: [pk("net", "B", { provisional: true }), pk("core", "B")] }), { letter: "B", provisional: true });
  assert.deepEqual(grade(srv("lo", [pk("db", "C", { provisional: true })])), { letter: "C", provisional: true });
  assert.equal(grade({ packs: [{ id: "core", status: "inconclusive", letter: null }] }), null);
});

test("only graded servers are listed; tiers (topic area, other deeper area, protocol only), then grade, firm before provisional, more areas, more calls, name", () => {
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
  assert.deepEqual(rows.map((r) => r.id), ["b", "d", "c", "g", "a", "e", "f"]); // b: F but graded in the Database area
  assert.deepEqual(rows.map((r) => r.tier), [0, 1, 1, 1, 2, 2, 2]);
  assert.equal(rows.find((r) => r.id === "b").held, true);
  assert.equal(rows.find((r) => r.id === "c").provisional, false); // Protocol A (firm) is the first lowest area, as on its own page
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
  assert.equal(whyText({ from: "keyword", term: "sql" }, label), "declared keyword or topic “sql”");
  assert.equal(whyText({ from: "name", term: "sql" }, label), "its name says “sql”");
});

test("real data: at least 8 topic pages, each row graded and its rule true", () => {
  const servers = JSON.parse(readFileSync(new URL("../content/data/server-results.json", import.meta.url), "utf8")).servers;
  const facts = JSON.parse(readFileSync(new URL("../../fleet/server-facts.json", import.meta.url), "utf8")).servers; // committed: a missing file is a failure
  const pages = topicPages(servers, facts, no);
  assert.ok(pages.length >= 8, `${pages.length} topic pages`);
  const norm = (s) => ` ${String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  for (const p of pages) for (const r of p.rows) {
    const x = servers.find((v) => v.id === r.id);
    assert.ok(x.packs.some((k) => k.status === "graded" && k.letter === r.letter));
    // the stated reason holds on the raw data, checked here without topicMatch
    if (r.why.from === "area") assert.ok(x.packs.some((k) => k.id === r.why.term && k.status === "graded"), `${x.id} ${r.why.term}`);
    else if (r.why.from === "keyword") assert.ok(facts[x.id].about.keywords.some((k) => norm(k) === norm(r.why.term)), `${x.id} ${r.why.term}`);
    else assert.ok(norm(x.name).includes(norm(r.why.term)), `${x.id} ${r.why.term}`);
  }
});
