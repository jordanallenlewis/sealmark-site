// node --test lib/   (npm test in web/)
// Tool pages (site#64): one page per tool a public check called with a valid call, same hold rule as the "By tool" table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toolEvidence, toolPages, toolPagesProblems, toolSlug, toolSummary } from "./tool-pages.mjs";

const chk = (id, verdict, tools, extra = {}) => ({ id, pack: "core", label: id, critical: false, advisory: false, verdict, summary: "s", ...(tools ? { tools } : {}), ...extra });
const srv = (id, checks, tools, extra = {}) => ({ id, name: id, testedAt: "2026-11-17", tools, toolCount: tools.length, checks, ...extra });
const none = () => new Map();

test("slugs: plain names stay readable, every other character is encoded, and no two names share a slug", () => {
  assert.equal(toolSlug("read_file"), "read_file");
  assert.equal(toolSlug("files.read-v2"), "files.read-v2");
  assert.equal(toolSlug("ns:get item"), "ns~3a~get~20~item");
  assert.equal(toolSlug("a/b"), "a~2f~b");
  assert.equal(toolSlug("café"), "caf~e9~");
  assert.equal(toolSlug("."), "~2e~");
  assert.equal(toolSlug(".."), "~2e~~2e~");
  const names = ["a b", "a_b", "a-b", "a~20~b".replace(/~/g, ""), "A b", "a:b", "a.b", "a/b", "a@b", "a+b", "a#b", "a  b"];
  const slugs = names.map(toolSlug);
  assert.equal(new Set(slugs).size, names.length);
  for (const s of slugs) assert.match(s, /^[A-Za-z0-9_.~-]+$/);
});

test("a page only for a tool a public check called with a valid call", () => {
  const p = toolPages([srv("fs", [chk("protocol", "pass", { probed: ["read_file"], notCovered: ["write_file"] }), chk("robust-input", "fail", { probed: ["read_file"], notCovered: [] })], ["read_file", "write_file"])], none);
  assert.deepEqual(p.map((x) => [x.id, x.tool, x.slug]), [["fs", "read_file", "read_file"]]);
  assert.deepEqual(p[0].called.map((c) => [c.id, c.verdict]), [["protocol", "pass"], ["robust-input", "fail"]]);
});

test("no pages for a server with a security finding or a held check, or with no tool data", () => {
  const called = { probed: ["t"], notCovered: [] };
  const p = toolPages([
    srv("leak", [chk("protocol", "pass", called), chk("secret-echo", "fail")], ["t"]),
    srv("held", [chk("protocol", "pass", called)], ["t"]),
    srv("old", [chk("protocol", "pass")], ["t"]),
    srv("ok", [chk("protocol", "pass", called)], ["t"]),
    null,
    { id: 3 },
  ], (x) => (x.id === "held" ? new Map([["protocol", {}]]) : new Map()));
  assert.deepEqual(p.map((x) => x.id), ["ok"]);
  assert.deepEqual(toolPages(undefined, none), []);
});

test("a name that is not plain gets no page", () => {
  const p = toolPages([srv("x", [chk("protocol", "pass", { probed: ["ok_tool", "bad‮tool"], notCovered: [] })], ["ok_tool", "bad‮tool"])], none);
  assert.deepEqual(p.map((x) => x.tool), ["ok_tool"]);
});

test("summary: the checks that called it with their verdicts, that no tool is graded, and the server's grade", () => {
  const base = { tool: "read_file", server: "fs-mcp", version: "1.0.0", testedAt: "2026-11-17", grade: { letter: "B", provisional: false } };
  assert.equal(
    toolSummary({ ...base, called: [{ id: "protocol", verdict: "pass", advisory: false }] }),
    "read_file is a tool of fs-mcp 1.0.0. In Sealmark's automated test on 2026-11-17, one public check called it with a valid call: protocol (passed). " +
      "A check's verdict is for the whole check, not for this tool alone, so Sealmark gives no grade to a single tool. The server's overall grade is B.",
  );
  const t = toolSummary({ ...base, grade: { letter: "C", provisional: true }, called: [{ id: "a", verdict: "pass", advisory: false }, { id: "b", verdict: "fail", advisory: true }, { id: "c", verdict: "part", advisory: false }] });
  assert.match(t, /3 public checks called it with a valid call: a \(passed\), b \(failed, advisory\) and c \(partial\)\./);
  assert.match(t, /overall grade is C \(provisional\)\.$/);
  assert.match(toolSummary({ ...base, grade: null, called: [{ id: "a", verdict: "pass", advisory: false }] }), /The server has no overall grade\.$/);
});

test("evidence: only lines recorded against this tool, from checks that called it, in their order", () => {
  const ev = new Map([
    ["b", { total: 3, lines: [{ tool: "read_file", probe: "p1" }, { tool: "other", probe: "p2" }, { tool: null, probe: "p3" }] }],
    ["a", { total: 1, lines: [{ tool: "read_file", probe: "p4" }] }],
    ["z", { total: 1, lines: [{ tool: "read_file", probe: "not called" }] }],
  ]);
  const r = toolEvidence(ev, [{ id: "a" }, { id: "b" }, { id: "c" }], "read_file");
  assert.deepEqual(r.map((x) => [x.check, x.lines.map((l) => l.probe)]), [["a", ["p4"]], ["b", ["p1"]]]);
  assert.deepEqual(toolEvidence(null, [{ id: "a" }], "read_file"), []);
});

test("rule 12: built pages must be exactly the expected ones, never for a held server", () => {
  const exp = [{ id: "a", slug: "t1" }, { id: "a", slug: "t2" }];
  const st = (id) => (id === "h" ? "held" : id === "u" ? "unknown" : null);
  assert.deepEqual(toolPagesProblems(["a/t1", "a/t2"], exp, st), []);
  assert.deepEqual(toolPagesProblems(["a/t1"], exp, st), ["a/t2: no page built"]);
  assert.deepEqual(toolPagesProblems(["a/t1", "a/t2", "a/t3"], exp, st), ["a/t3: built but not a tool a public check called"]);
  assert.deepEqual(toolPagesProblems(["h/t"], [{ id: "h", slug: "t" }], st), ["h/t: a tool page for a server with a security finding"]);
  assert.deepEqual(toolPagesProblems(["u/t"], [{ id: "u", slug: "t" }], st), ["u/t: server not in the raw results data"]);
  assert.deepEqual(toolPagesProblems([], [{ id: "a", slug: "t" }, { id: "a", slug: "t" }], st), ["two tools of one server share a page path", "a/t: no page built"]);
});
