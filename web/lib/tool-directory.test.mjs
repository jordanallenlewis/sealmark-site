// node --test lib/   (npm test in web/)
// Tools directory (site#97): the tools a public check called with a valid call, grouped by server. Same hold rule as
// the "By tool" table (lib/tool-verdicts.mjs): no server with a security finding or a held check, plain names only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toolDirectory } from "./tool-directory.mjs";
import { toolVerdicts } from "./tool-verdicts.mjs";
import { isSecurityFinding } from "./disclosure.mjs";

const chk = (id, verdict, tools, extra = {}) => ({ id, pack: "core", label: id, critical: false, advisory: false, verdict, summary: "s", ...(tools ? { tools } : {}), ...extra });
const srv = (id, name, checks, tools, extra = {}) => ({ id, name, tools, toolCount: tools.length, checks, ...extra });
const none = () => new Map();

test("lists only the tools a public check called with a valid call, never the ones it did not exercise", () => {
  const d = toolDirectory([
    srv("fs", "Files", [chk("protocol", "pass", { probed: ["read_file"], notCovered: ["write_file", "list_dir"] })], ["read_file", "write_file", "list_dir"]),
  ], none);
  assert.equal(d.rows.length, 1);
  assert.deepEqual(d.rows[0], { id: "fs", name: "Files", tools: ["read_file"], declared: 3, missing: false });
  assert.equal(d.tools, 1);
});

test("servers are sorted by name, case-insensitive, then id; a server with no called tool is left out", () => {
  const called = { probed: ["t"], notCovered: [] };
  const d = toolDirectory([
    srv("b", "beta", [chk("protocol", "pass", called)], ["t"]),
    srv("a2", "Alpha", [chk("protocol", "pass", called)], ["t"]),
    srv("a1", "alpha", [chk("protocol", "pass", called)], ["t"]),
    srv("z", "Zed", [chk("protocol", "pass", { probed: [], notCovered: ["t"] })], ["t"]),
    srv("y", "Why", [chk("protocol", "pass")], ["t"]),
  ], none);
  assert.deepEqual(d.rows.map((r) => r.id), ["a1", "a2", "b"]);
  assert.equal(d.tools, 3);
});

test("a server with any security finding is left out, whatever its stored tool data says", () => {
  const called = { probed: ["t"], notCovered: [] };
  const d = toolDirectory([
    srv("leak", "Leak", [chk("protocol", "pass", called), chk("secret-echo", "fail")], ["t"]),
    srv("crit", "Crit", [chk("protocol", "pass", called), chk("robust-input", "fail", undefined, { critical: true })], ["t"]),
    srv("ok", "Ok", [chk("protocol", "pass", called)], ["t"]),
  ], none);
  assert.deepEqual(d.rows.map((r) => r.id), ["ok"]);
});

test("a server with a held (redacted) check is left out", () => {
  const called = { probed: ["t"], notCovered: [] };
  const servers = [srv("held", "Held", [chk("protocol", "pass", called)], ["t"]), srv("ok", "Ok", [chk("protocol", "pass", called)], ["t"])];
  const d = toolDirectory(servers, (x) => (x.id === "held" ? new Map([["protocol", { redacted: true }]]) : new Map()));
  assert.deepEqual(d.rows.map((r) => r.id), ["ok"]);
});

test("names that are not plain are dropped and the row says names are missing", () => {
  const d = toolDirectory([
    srv("x", "X", [chk("protocol", "pass", { probed: ["ok_tool", "bad‮tool"], notCovered: [] })], ["ok_tool", "bad‮tool"]),
  ], none);
  assert.deepEqual(d.rows[0].tools, ["ok_tool"]);
  assert.equal(d.rows[0].missing, true);
});

test("a capped check list marks the row as missing names", () => {
  const d = toolDirectory([srv("x", "X", [chk("protocol", "pass", { probed: ["a"], notCovered: [], cut: 4 })], ["a"])], none);
  assert.equal(d.rows[0].missing, true);
});

test("a server with no name falls back to its id", () => {
  const d = toolDirectory([srv("plain-id", "", [chk("protocol", "pass", { probed: ["a"], notCovered: [] })], ["a"])], none);
  assert.equal(d.rows[0].name, "plain-id");
});

test("bad input gives an empty directory, not a throw", () => {
  assert.deepEqual(toolDirectory(undefined, none), { rows: [], tools: 0 });
  assert.deepEqual(toolDirectory([null, {}], none), { rows: [], tools: 0 });
});

test("real data: no listed server has a security finding, and every listed tool is one the By tool table shows as called", () => {
  const data = JSON.parse(readFileSync(new URL("../content/data/server-results.json", import.meta.url), "utf8"));
  const byId = new Map(data.servers.map((x) => [x.id, x]));
  const d = toolDirectory(data.servers, none);
  for (const r of d.rows) {
    const x = byId.get(r.id);
    assert.ok(!x.checks.some(isSecurityFinding), r.id);
    const called = toolVerdicts(x).rows.filter((t) => t.called.length > 0).map((t) => t.tool);
    assert.deepEqual(r.tools, called, r.id);
  }
});
