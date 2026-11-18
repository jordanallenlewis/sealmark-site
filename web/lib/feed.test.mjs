// node --test lib/   (npm test in web/)
// Atom feeds of grade changes (site#59). A feed entry is a public claim that someone else's server changed grade, so it
// follows the results list's change rule (lib/results-view.mjs gradeChange): only a move in the overall grade that came
// with a new server version under the same, known Sealmark version. Everything else stays out of the feed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { atomFeed, changeEntry, feedChanges, xmlText } from "./feed.mjs";

const SITE = "https://sealmark.dev";
const ch = (extra = {}) => ({
  date: "2026-11-17", id: "pg", name: "Postgres MCP", from: "B", to: "A", packs: { core: { from: "B", to: "A" } },
  previousVersion: "1.0.0", version: "1.1.0", previousSealmark: "1.0.1", sealmark: "1.0.1", page: `${SITE}/results/pg/`, ...extra,
});
const notHeld = () => false;

test("keeps a grade move that came with a new server version under the same known Sealmark", () => {
  assert.equal(feedChanges([ch()], notHeld).length, 1);
});

test("drops moves that are not a claim about the server", () => {
  const out = feedChanges([
    ch({ sealmark: "1.0.2" }), // Sealmark upgrade
    ch({ previousSealmark: null, sealmark: null }), // unknown Sealmark version (null === null must not match)
    ch({ previousSealmark: "", sealmark: "" }),
    ch({ version: "1.0.0" }), // same server version: a case for Sealmark's own accuracy checks
    ch({ previousVersion: "", version: "" }),
    ch({ to: "B" }), // only a test area moved; the overall grade did not
    ch({ page: null }), // no public page
    ch({ from: "X" }), // malformed letter
    ch({ date: "yesterday" }), // malformed date
  ], notHeld);
  assert.deepEqual(out, []);
});

test("drops every change of a server with a held finding", () => {
  assert.deepEqual(feedChanges([ch()], (id) => id === "pg"), []);
});

test("newest first, then by id; bad input gives an empty list", () => {
  const out = feedChanges([ch({ id: "b", date: "2026-11-15" }), ch({ id: "z" }), ch({ id: "a" })], notHeld);
  assert.deepEqual(out.map((c) => c.id), ["a", "z", "b"]);
  assert.deepEqual(feedChanges(undefined, notHeld), []);
  assert.deepEqual(feedChanges([null, 3, "x"], notHeld), []);
});

test("an entry names what changed: both versions, the shared Sealmark version and the test areas that moved", () => {
  const e = changeEntry(ch({ packs: { core: { from: "B", to: "A" }, effects: { from: null, to: "A" } } }), (p) => ({ core: "Protocol", effects: "Effects" })[p] ?? p);
  assert.equal(e.title, "Postgres MCP: grade B to A");
  assert.equal(e.url, `${SITE}/results/pg/`);
  assert.equal(e.updated, "2026-11-17T00:00:00Z");
  assert.match(e.summary, /version 1\.1\.0 \(was 1\.0\.0\)/);
  assert.match(e.summary, /Sealmark 1\.0\.1, the same version as the run before/);
  assert.match(e.summary, /Protocol B to A/);
  assert.match(e.summary, /Effects newly graded A/);
  assert.match(e.summary, /not an endorsement/);
  // Stable across builds: the id depends only on the change.
  assert.equal(e.id, changeEntry(ch(), (p) => p).id);
  assert.notEqual(e.id, changeEntry(ch({ version: "1.2.0" }), (p) => p).id);
});

test("xmlText escapes markup and strips characters XML 1.0 cannot carry", () => {
  assert.equal(xmlText(`a<b>&"c'`), "a&lt;b&gt;&amp;&quot;c&apos;");
  assert.equal(xmlText("x\u0000y\u001bz￾"), "xyz");
  assert.equal(xmlText(undefined), "");
});

test("atomFeed writes a valid Atom document with escaped third-party text", () => {
  const xml = atomFeed({
    id: `${SITE}/results/feed.xml`, title: "Sealmark grade changes", self: `${SITE}/results/feed.xml`, page: `${SITE}/results/history/`,
    updated: "2026-11-18T00:00:00Z",
    entries: [changeEntry(ch({ name: "<script>alert(1)</script> & co" }), (p) => p)],
  });
  assert.match(xml, /^<\?xml version="1\.0" encoding="utf-8"\?>\n<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.match(xml, /<link rel="self" type="application\/atom\+xml" href="https:\/\/sealmark\.dev\/results\/feed\.xml"\/>/);
  assert.match(xml, /<updated>2026-11-18T00:00:00Z<\/updated>/);
  assert.equal(xml.includes("<script>"), false);
  assert.match(xml, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; co: grade B to A/);
  assert.equal((xml.match(/<entry>/g) ?? []).length, 1);
  assert.match(xml, /<author><name>Sealmark<\/name><\/author>/);
});

test("a feed with no entries is still valid and dated", () => {
  const xml = atomFeed({ id: "i", title: "t", self: "s", page: "p", updated: "2026-11-18T00:00:00Z", entries: [] });
  assert.match(xml, /<updated>2026-11-18T00:00:00Z<\/updated>/);
  assert.equal(xml.includes("<entry>"), false);
});

// Rule 9 of scripts/api-check.mjs, on fixture feeds.
import { feedProblems } from "./feed.mjs";
const feedOf = (changes) => atomFeed({ id: "i", title: "t", self: "s", page: "p", updated: "2026-11-18T00:00:00Z", entries: changes.map((c) => changeEntry(c, (p) => p)) });
const listed = new Set(["pg", "held"]);
const status = (id) => (id === "held" ? "held" : listed.has(id) ? null : "unknown");

test("rule 9: a clean feed has no problems, also as pg's own feed", () => {
  assert.deepEqual(feedProblems(feedOf([ch()]), SITE, listed, status), []);
  assert.deepEqual(feedProblems(feedOf([ch()]), SITE, listed, status, "pg"), []);
});

test("rule 9: a held server's entry, an unknown server, another server's entry and a repeated id fail", () => {
  assert.match(feedProblems(feedOf([ch({ id: "held", page: `${SITE}/results/held/` })]), SITE, listed, status).join("\n"), /held: entry for a server with a security finding/);
  assert.match(feedProblems(feedOf([ch({ id: "ghost", page: `${SITE}/results/ghost/` })]), SITE, listed, status).join("\n"), /ghost: entry for a server with no listed page/);
  assert.match(feedProblems(feedOf([ch()]), SITE, listed, status, "held").join("\n"), /pg: entry in the feed of held/);
  assert.match(feedProblems(feedOf([ch(), ch()]), SITE, listed, status).join("\n"), /repeated/);
  assert.match(feedProblems(feedOf([ch({ page: "https://example.com/x" })]), SITE, listed, status).join("\n"), /outside a server page/);
});

test("rule 9: something that is not our Atom document fails", () => {
  assert.deepEqual(feedProblems("<html></html>", SITE, listed, status), ["not an Atom document"]);
});
