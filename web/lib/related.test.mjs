// node --test lib/   (npm test in web/)
// "Related servers" on a results page (site#55): other graded servers that were graded in the same specific test
// area (database, files, git, network, ...). Protocol and Effects are graded on most servers, so they relate nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { relatedServers } from "./related.mjs";

const pk = (id, letter = "A") => ({ id, status: "graded", letter, provisional: false });
const srv = (id, packs, name = id) => ({ id, name, packs: [pk("core"), ...packs] });

test("servers that share a specific test area, most shared first, then better grade, then name", () => {
  const me = srv("me", [pk("db"), pk("sqlite"), pk("effects")]);
  const all = [me, srv("b", [pk("db", "C")]), srv("a", [pk("db", "C")]), srv("both", [pk("db", "F"), pk("sqlite", "F")]), srv("top", [pk("db", "A")]), srv("fx", [pk("effects")]), srv("none", [])];
  const r = relatedServers(me, all);
  assert.deepEqual(r.map((x) => x.id), ["both", "top", "a", "b"]);
  assert.deepEqual(r[0].shared, ["db", "sqlite"]);
  assert.equal(r[0].letter, "F");
});

test("only Protocol or Effects in common relates nothing; an ungraded area does not count", () => {
  const me = srv("me", [pk("effects")]);
  assert.deepEqual(relatedServers(me, [me, srv("x", [pk("effects")])]), []);
  const db = srv("db1", [{ id: "db", status: "na", letter: null }]);
  assert.deepEqual(relatedServers(srv("me2", [pk("db")]), [db]), []);
});

test("at most five, never itself", () => {
  const me = srv("me", [pk("fs")]);
  const many = Array.from({ length: 9 }, (_, i) => srv(`s${i}`, [pk("fs")]));
  const r = relatedServers(me, [me, ...many]);
  assert.equal(r.length, 5);
  assert.ok(!r.some((x) => x.id === "me"));
});

test("real data: every link points at a published server and shares an area with it", () => {
  const data = JSON.parse(readFileSync(new URL("../content/data/server-results.json", import.meta.url), "utf8"));
  const ids = new Set(data.servers.map((x) => x.id));
  let pages = 0;
  for (const x of data.servers) {
    const r = relatedServers(x, data.servers);
    if (r.length) pages++;
    for (const y of r) { assert.ok(ids.has(y.id)); assert.ok(y.shared.length > 0); assert.notEqual(y.id, x.id); }
  }
  assert.ok(pages > 0);
});

test("a server with a withdrawn grade is not listed as related and has no related list", () => {
  const p = [{ id: "db", status: "graded", letter: "A" }, { id: "core", status: "graded", letter: "A" }];
  const a = { id: "a", name: "a", packs: p }, b = { id: "b", name: "b", packs: p, gradeWithdrawn: { kind: "failed", since: "2026-11-10" } };
  assert.deepEqual(relatedServers(a, [a, b]), []);
  assert.deepEqual(relatedServers(b, [a, b]), []);
});
