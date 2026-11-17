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
  assert.equal(c.all, 0);
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

test("gradeChange: the last day the worst grade moved, between graded runs only", () => {
  const runs = [
    { date: "2026-11-10", status: "ok", worst: "B" },
    { date: "2026-11-12", status: "failed" }, // a dash says nothing about the grade
    { date: "2026-11-14", status: "ok", worst: "C" },
    { date: "2026-11-15", status: "ok", worst: "C" },
  ];
  assert.deepEqual(gradeChange(runs, "C"), { date: "2026-11-14", from: "B", to: "C" });
  assert.deepEqual(gradeChange([...runs].reverse(), "C"), { date: "2026-11-14", from: "B", to: "C" }, "order of input does not matter");
});

test("gradeChange is silent when unsure", () => {
  const runs = [{ date: "2026-11-10", status: "ok", worst: "B" }, { date: "2026-11-14", status: "ok", worst: "C" }];
  assert.equal(gradeChange(runs, "B"), null, "history's last grade is not the grade on the page");
  assert.equal(gradeChange(runs, null), null);
  assert.equal(gradeChange([{ date: "2026-11-10", status: "ok", worst: "B" }], "B"), null, "one run: nothing to compare");
  assert.equal(gradeChange([{ date: "2026-11-10", status: "ok", worst: "B" }, { date: "2026-11-11", status: "ok", worst: "B" }], "B"), null);
  assert.equal(gradeChange([{ date: "x", status: "ok", worst: "B" }, { date: "2026-11-11", status: "ok", worst: "C" }], "C"), null, "a bad date is dropped");
  assert.equal(gradeChange([{ date: "2026-11-10", status: "ok", worst: "Z" }, { date: "2026-11-11", status: "ok", worst: "C" }], "C"), null, "a bad letter is dropped");
  assert.equal(gradeChange(undefined, "C"), null);
});
