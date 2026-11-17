// node --test lib/   (npm test in web/)
// The /results/ table's search, facets and sorts (lib/results-view.mjs), and the grade-change line it shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AREAS, SORTS, SOURCES, facetCounts, gradeChange, readState, viewRows, worstLetter, writeState } from "./results-view.mjs";

const pk = (id, letter) => ({ id, status: "graded", letter, provisional: false });
const row = (id, o = {}) => ({ id, name: o.name ?? id, ecosystem: o.ecosystem ?? "npm", versionTested: "1.0.0", toolCount: 3, packs: o.packs ?? [pk("core", "A")], ...o });
const rows = [
  row("alpha", { packs: [pk("core", "A"), pk("effects", "B")], testedOn: "2026-11-14" }),
  row("bravo", { ecosystem: "pypi", packs: [pk("core", "B"), pk("net", "F")], testedOn: "2026-11-16", change: { date: "2026-11-16", from: "B", to: "F" } }),
  row("charlie", { ecosystem: "github", packs: [pk("core", "C")], testedOn: "2026-11-15", change: { date: "2026-11-14", from: "A", to: "C" } }),
  row("delta", { packs: [pk("core", "A"), pk("effects", "A"), pk("net", "A")], testedOn: "2026-11-17" }),
  row("echo", { packs: [{ id: "core", status: "error", letter: null, provisional: false }] }),
];
const ids = (list) => list.map((x) => x.id);
const base = { q: "", filter: "all", source: "", area: "", sort: "best" };

test("default view keeps the old order: best grade first, ties by name, no grade last", () => {
  assert.deepEqual(ids(viewRows(rows, base)), ["delta", "alpha", "charlie", "bravo", "echo"]);
  assert.deepEqual(ids(viewRows(rows, { ...base, sort: "worst" })), ["echo", "bravo", "charlie", "alpha", "delta"]);
  assert.deepEqual(ids(viewRows(rows, { ...base, sort: "name" })), ["alpha", "bravo", "charlie", "delta", "echo"]);
});

test("the old filters still work", () => {
  assert.deepEqual(ids(viewRows(rows, { ...base, filter: "failing" })), ["bravo"]);
  assert.deepEqual(ids(viewRows(rows, { ...base, filter: "clean" })), ["delta", "alpha"]);
  assert.deepEqual(ids(viewRows(rows, { ...base, filter: "hygiene" })), ["charlie"]);
});

test("search matches the name or the id, case-insensitive", () => {
  assert.deepEqual(ids(viewRows([...rows, row("x-1", { name: "@scope/Foxtrot" })], { ...base, q: "  FOX " })), ["x-1"]);
  assert.deepEqual(ids(viewRows([row("golf-mcp", { name: "@acme/server" })], { ...base, q: "golf" })), ["golf-mcp"]);
});

test("source and test-area facets narrow the list and combine with the filter", () => {
  assert.deepEqual(ids(viewRows(rows, { ...base, source: "pypi" })), ["bravo"]);
  assert.deepEqual(ids(viewRows(rows, { ...base, area: "effects" })), ["delta", "alpha"]);
  assert.deepEqual(ids(viewRows(rows, { ...base, area: "net", filter: "clean" })), ["delta"]);
  // an area counts only when it was graded: an errored pack is not "graded in that area"
  assert.deepEqual(ids(viewRows([row("h", { packs: [pk("core", "A"), { id: "fs", status: "error", letter: null, provisional: false }] })], { ...base, area: "fs" })), []);
});

test("sort by last tested: newest first, untested last, ties by name", () => {
  assert.deepEqual(ids(viewRows(rows, { ...base, sort: "tested" })), ["delta", "bravo", "charlie", "alpha", "echo"]);
});

test("sort by recent grade change: changed servers first by date, then the rest best grade first", () => {
  assert.deepEqual(ids(viewRows(rows, { ...base, sort: "changed" })), ["bravo", "charlie", "delta", "alpha", "echo"]);
});

test("facet counts apply every other active choice but not their own", () => {
  const c = facetCounts(rows, { ...base, area: "effects", source: "pypi" });
  assert.deepEqual(c.source, { npm: 2, pypi: 0, github: 0 }); // area=effects applied, source ignored
  assert.equal(c.area.net, 1); // source=pypi applied, area ignored
  assert.equal(c.area.effects, 0);
});

test("readState accepts only known values; writeState omits the defaults", () => {
  const s = readState(new URLSearchParams("q=x&filter=nope&sort=changed&source=pypi&area=__proto__&page=3"));
  assert.deepEqual(s, { q: "x", filter: "all", sort: "changed", source: "pypi", area: "", page: 3 });
  assert.deepEqual(readState(new URLSearchParams("page=-2&source=toString")), { q: "", filter: "all", sort: "best", source: "", area: "", page: 1 });
  const u = new URL("https://x.test/results/?q=old&keep=1");
  writeState(u.searchParams, { ...base, q: " ", area: "net", page: 1 });
  assert.equal(u.search, "?keep=1&area=net");
  for (const k of SORTS) assert.equal(typeof k, "string");
  assert.deepEqual(SOURCES.map(([k]) => k), ["npm", "pypi", "github"]);
  assert.ok(AREAS.every((a) => a !== "core"));
});

test("worstLetter is the lowest graded letter or null", () => {
  assert.equal(worstLetter(rows[1]), "F");
  assert.equal(worstLetter(rows[4]), null);
});

const run = (date, worst, version = "1.0.0", sealmark = "1.0.1", status = "ok") => ({ date, status, worst, version, sealmark });

test("gradeChange: the last day the worst grade moved with a new server version, between graded runs only", () => {
  const runs = [
    run("2026-11-10", "B", "1.0.0"),
    run("2026-11-12", undefined, "1.1.0", "1.0.1", "failed"), // a dash says nothing about the grade
    run("2026-11-14", "C", "1.1.0"),
    run("2026-11-15", "C", "1.1.0"),
  ];
  assert.deepEqual(gradeChange(runs, "C"), { date: "2026-11-14", from: "B", to: "C", fromVersion: "1.0.0" });
  assert.deepEqual(gradeChange([...runs].reverse(), "C"), { date: "2026-11-14", from: "B", to: "C", fromVersion: "1.0.0" }, "order of input does not matter");
});

test("gradeChange is silent when the cause is not a new server version", () => {
  assert.equal(gradeChange([run("2026-11-09", "B", "1.0.0", "1.0.0"), run("2026-11-14", "C", "1.0.0", "1.0.1")], "C"), null, "Sealmark upgrade, same server version");
  assert.equal(gradeChange([run("2026-11-09", "B", "1.0.0", "1.0.0"), run("2026-11-14", "C", "1.1.0", "1.0.1")], "C"), null, "Sealmark upgrade and a new version: cause unknown");
  assert.equal(gradeChange([run("2026-11-14", "A"), run("2026-11-16", "B")], "B"), null, "same server, same Sealmark: an accuracy case, not a server change");
  assert.equal(gradeChange([run("2026-11-01", "F", "2.0.0", null), run("2026-11-02", "D", "2.0.1", null)], "D"), null, "unknown Sealmark version");
  assert.equal(gradeChange([run("2026-11-01", "F", ""), run("2026-11-02", "D", "2.0.1")], "D"), null, "unknown server version");
  // the newest move decides: an older qualifying move is not reported when a later unexplained one followed it
  assert.equal(gradeChange([run("2026-11-10", "B", "1.0.0"), run("2026-11-12", "C", "1.1.0"), run("2026-11-14", "B", "1.1.0")], "B"), null);
  // a later run with the same grade does not hide the move
  assert.deepEqual(gradeChange([run("2026-11-10", "B", "1.0.0"), run("2026-11-12", "C", "1.1.0"), run("2026-11-14", "C", "1.2.0")], "C"), { date: "2026-11-12", from: "B", to: "C", fromVersion: "1.0.0" });
});

test("gradeChange is silent when unsure about the data", () => {
  const runs = [run("2026-11-10", "B", "1.0.0"), run("2026-11-14", "C", "1.1.0")];
  assert.equal(gradeChange(runs, "B"), null, "history's last grade is not the grade on the page");
  assert.equal(gradeChange(runs, null), null);
  assert.equal(gradeChange([run("2026-11-10", "B")], "B"), null, "one run: nothing to compare");
  assert.equal(gradeChange([run("2026-11-10", "B", "1.0.0"), run("2026-11-11", "B", "1.1.0")], "B"), null);
  assert.equal(gradeChange([run("x", "B", "1.0.0"), run("2026-11-11", "C", "1.1.0")], "C"), null, "a bad date is dropped");
  assert.equal(gradeChange([run("2026-11-10", "Z", "1.0.0"), run("2026-11-11", "C", "1.1.0")], "C"), null, "a bad letter is dropped");
  assert.equal(gradeChange([run("2026-11-10", "B", "x".repeat(65)), run("2026-11-11", "C", "1.1.0")], "C"), null, "an oversized version is dropped");
  assert.equal(gradeChange(undefined, "C"), null);
});
