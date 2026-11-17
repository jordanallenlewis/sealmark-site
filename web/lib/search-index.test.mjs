// node --test lib/   (npm test in web/)
// Site-wide search (site#57 slice 2): one search entry per graded server, so the docs search bar also finds servers by
// name, id and tool name. Tool names follow the "By tool" rule (lib/tool-verdicts.mjs): none for a server with a held
// or unknown security finding, plain names only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { serverEntry, serverEntries, SERVER_GROUP } from "./search-index.mjs";

const pass = (id, pack, tools) => ({ id, pack, verdict: "pass", tools: { probed: tools, notCovered: [] } });
const srv = (over = {}) => ({
  id: "acme-files",
  name: "Acme Files",
  ecosystem: "npm",
  toolCount: 2,
  tools: ["read_file", "write_file"],
  checks: [pass("protocol", "core", ["read_file", "write_file"])],
  ...over,
});
const none = new Map();

test("a server entry links to its page and carries its grade, source and tool names", () => {
  const e = serverEntry(srv(), { grade: "Grade B", source: "npm" }, none);
  assert.equal(e.url, "/results/acme-files/");
  assert.equal(e.title, "Acme Files");
  assert.equal(e.group, SERVER_GROUP);
  assert.equal(e.grade, "Grade B");
  assert.deepEqual(e.headings, ["acme-files", "read_file", "write_file"]);
  assert.match(e.text, /^Grade B · npm · 2 tools: read_file, write_file$/);
});

test("no tool names for a server with a held finding (any redaction)", () => {
  const e = serverEntry(srv(), { grade: "Grade F", source: "npm" }, new Map([["T2-SECRET", {}]]));
  assert.deepEqual(e.headings, ["acme-files"]);
  assert.doesNotMatch(e.text, /read_file|write_file/);
  assert.equal(e.text, "Grade F · npm · 2 tools");
});

test("no tool names for a server with a security finding even before it is in disclosure.json", () => {
  const x = srv({ checks: [pass("protocol", "core", ["read_file"]), { id: "T2-SECRET", pack: "core", verdict: "fail" }] });
  const e = serverEntry(x, { grade: "Grade F", source: "npm" }, none);
  assert.deepEqual(e.headings, ["acme-files"]);
  assert.doesNotMatch(e.text, /read_file/);
});

test("a name that is not plain is never indexed; declared names are used even with no per-check names", () => {
  const x = srv({ tools: ["ok_tool", "bad‮tool", "x".repeat(200)], toolCount: 3 });
  const e = serverEntry(x, { grade: "Grade A", source: "npm" }, none);
  assert.ok(e.headings.includes("ok_tool"));
  assert.ok(!e.headings.some((h) => h.includes("‮") || h.length > 128));
  const bare = serverEntry(srv({ checks: [] }), { grade: "Grade A", source: "PyPI" }, none);
  assert.deepEqual(bare.headings, ["acme-files"], "no public check with tool data: no names (same as the page)");
});

test("no summary, start command or check text ever reaches an entry", () => {
  const x = srv({ launch: "npx -y secret-thing", checks: [{ ...pass("protocol", "core", ["read_file"]), summary: "UNIQUE-SUMMARY" }] });
  const s = JSON.stringify(serverEntry(x, { grade: "Grade A", source: "npm" }, none));
  assert.doesNotMatch(s, /UNIQUE-SUMMARY|secret-thing|"protocol"/);
});

test("one tool and no tools read right; the name falls back to the id", () => {
  assert.equal(serverEntry(srv({ toolCount: 1, tools: ["read_file"], checks: [pass("robust-input", "core", ["read_file"])] }), { grade: "Grade A", source: "npm" }, none).text, "Grade A · npm · 1 tool: read_file");
  const e = serverEntry(srv({ name: "", toolCount: 0, tools: [], checks: [] }), { grade: "No tools to test", source: "GitHub" }, none);
  assert.equal(e.title, "acme-files");
  assert.equal(e.text, "No tools to test · GitHub · 0 tools");
});

test("the text stays short: tool names past the cut are dropped whole, still searchable through headings", () => {
  const tools = Array.from({ length: 80 }, (_, i) => `tool_number_${i}`);
  const x = srv({ tools, toolCount: 80, checks: [pass("robust-input", "core", tools)] });
  const e = serverEntry(x, { grade: "Grade A", source: "npm" }, none);
  assert.ok(e.text.length <= 400, `${e.text.length}`);
  assert.match(e.text, /tool_number_0, /);
  assert.match(e.text, /…$/);
  assert.equal(e.headings.length, 81);
});

test("serverEntries keeps one entry per server in order", () => {
  const xs = [srv(), srv({ id: "b", name: "B" })];
  const out = serverEntries(xs, () => ({ grade: "Grade A", source: "npm" }), () => none);
  assert.deepEqual(out.map((e) => e.url), ["/results/acme-files/", "/results/b/"]);
});

test("a partial tool list never reads as complete: names the page could not show end the list with an ellipsis", () => {
  const x = srv({ tools: ["read_file"], toolCount: 3, checks: [pass("protocol", "core", ["read_file"])] });
  assert.equal(serverEntry(x, { grade: "Grade A", source: "npm" }, none).text, "Grade A · npm · 3 tools: read_file, …");
});
