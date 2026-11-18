// node --test lib/   (npm test in web/)
// Tools directory (site#97): the tools a public check called with a valid call, grouped by server. Same hold rule as
// the "By tool" table (lib/tool-verdicts.mjs): no server with a security finding or a held check, plain names only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toolDirectory, toolsPageProblems } from "./tool-directory.mjs";
import { isSecurityFinding, redactedChecks } from "./disclosure.mjs";

const chk = (id, verdict, tools, extra = {}) => ({ id, pack: "core", label: id, critical: false, advisory: false, verdict, summary: "s", ...(tools ? { tools } : {}), ...extra });
const srv = (id, name, checks, tools, extra = {}) => ({ id, name, testedAt: "2026-11-17", tools, toolCount: tools.length, checks, ...extra });
const none = () => new Map();

test("lists only the tools a public check called with a valid call, never the ones it did not exercise", () => {
  const d = toolDirectory([
    srv("fs", "Files", [chk("protocol", "pass", { probed: ["read_file"], notCovered: ["write_file", "list_dir"] })], ["read_file", "write_file", "list_dir"]),
  ], none);
  assert.equal(d.rows.length, 1);
  assert.deepEqual(d.rows[0], { id: "fs", name: "Files", testedAt: "2026-11-17", tools: ["read_file"], declared: 3, missing: false });
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

test("a called name that is not plain is dropped and the row says called names are missing", () => {
  const d = toolDirectory([
    srv("x", "X", [chk("protocol", "pass", { probed: ["ok_tool", "bad\u202etool"], notCovered: [] })], ["ok_tool", "bad\u202etool"]),
  ], none);
  assert.deepEqual(d.rows[0].tools, ["ok_tool"]);
  assert.equal(d.rows[0].missing, true);
});

test("a dropped declared name that no check reached does not mark the called list incomplete", () => {
  const d = toolDirectory([
    srv("x", "X", [chk("protocol", "pass", { probed: ["ok_tool"], notCovered: ["bad\u202etool"] })], ["ok_tool", "bad\u202etool"]),
  ], none);
  assert.equal(d.rows[0].missing, false);
});

test("a capped check list marks the row as missing names", () => {
  const d = toolDirectory([srv("x", "X", [chk("protocol", "pass", { probed: ["a"], notCovered: [], cut: 4 })], ["a"])], none);
  assert.equal(d.rows[0].missing, true);
});

test("declared is the larger of the stored tool count and the names seen; a missing count falls back to the names", () => {
  const called = { probed: ["a"], notCovered: ["b"] };
  assert.equal(toolDirectory([srv("x", "X", [chk("protocol", "pass", called)], ["a", "b"], { toolCount: 40 })], none).rows[0].declared, 40);
  assert.equal(toolDirectory([srv("x", "X", [chk("protocol", "pass", called)], ["a", "b"], { toolCount: 1 })], none).rows[0].declared, 2);
  assert.equal(toolDirectory([srv("x", "X", [chk("protocol", "pass", called)], ["a", "b"], { toolCount: undefined })], none).rows[0].declared, 2);
});

test("a server with no name falls back to its id", () => {
  const d = toolDirectory([srv("plain-id", "", [chk("protocol", "pass", { probed: ["a"], notCovered: [] })], ["a"])], none);
  assert.equal(d.rows[0].name, "plain-id");
});

test("bad input gives an empty directory, not a throw", () => {
  assert.deepEqual(toolDirectory(undefined, none), { rows: [], tools: 0 });
  assert.deepEqual(toolDirectory([null, {}], none), { rows: [], tools: 0 });
});

test("real data: no listed server has a security finding or a held check", () => {
  const data = JSON.parse(readFileSync(new URL("../content/data/server-results.json", import.meta.url), "utf8"));
  const disclosure = JSON.parse(readFileSync(new URL("../content/data/disclosure.json", import.meta.url), "utf8")).findings;
  const today = new Date().toISOString().slice(0, 10);
  const byId = new Map(data.servers.map((x) => [x.id, x]));
  const d = toolDirectory(data.servers, (x) => redactedChecks(x, disclosure, today));
  for (const r of d.rows) {
    const x = byId.get(r.id);
    assert.ok(!x.checks.some(isSecurityFinding), r.id);
    assert.equal(redactedChecks(x, disclosure, today).size, 0, r.id);
  }
});

// Rule 8 of scripts/api-check.mjs, on fixture pages.
const page = (rows) => `<main><a href="/results/">Results</a><table><thead><tr><th>Server</th></tr></thead><tbody>${rows.map((id) => `<tr><td><a href="/results/${id}/">${id}</a></td></tr>`).join("")}</tbody></table></main>`;
const listed = new Set(["a", "b", "held"]);
const status = (id) => (id === "held" ? "held" : listed.has(id) ? null : "unknown");

test("rule 8: a clean page has no problems", () => {
  assert.deepEqual(toolsPageProblems(page(["a", "b"]), listed, status), []);
});

test("rule 8: a held server on the page fails", () => {
  assert.match(toolsPageProblems(page(["a", "held"]), listed, status).join("\n"), /held: a server with a security finding is listed/);
});

test("rule 8: an unlisted or unknown server, a twice-listed one, and rows without links fail", () => {
  assert.match(toolsPageProblems(page(["ghost"]), listed, status).join("\n"), /ghost: linked but has no listed page[\s\S]*ghost: not in the raw results data/);
  assert.match(toolsPageProblems(page(["a", "a"]), listed, status).join("\n"), /listed twice/);
  const noLink = page(["a"]).replace("</tbody>", "<tr><td>held</td></tr></tbody>");
  assert.match(toolsPageProblems(noLink, listed, status).join("\n"), /2 rows but 1 server links/);
});

test("rule 8: with no table, any server link on the page fails (changed markup fails closed)", () => {
  assert.deepEqual(toolsPageProblems("<main><p>No re-tested server yet.</p><a href=\"/results/\">Results</a></main>", listed, status), []);
  assert.match(toolsPageProblems("<main><div><a href=\"/results/held/\">held</a></div></main>", listed, status)[0], /no table/);
});
