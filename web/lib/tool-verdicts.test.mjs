// node --test lib/   (npm test in web/)
// "By tool" on a results page (site#54): which public checks called each tool, with that check's verdict.
// The fleet already drops tool names for security checks and for any server with a security finding
// (fleet/check-tools.mjs); the page applies the same rule again at build time, because stored names can go stale
// against the disclosure rules and the check classification.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toolVerdicts } from "./tool-verdicts.mjs";

const chk = (id, verdict, tools, extra = {}) => ({ id, pack: "core", label: id, critical: false, advisory: false, verdict, summary: "s", ...(tools ? { tools } : {}), ...extra });
const server = (checks, tools = ["read_file", "write_file", "list_dir"]) => ({ id: "x", tools, checks });

test("entries without the fleet's tool data show nothing", () => {
  assert.equal(toolVerdicts({ id: "x", checks: [chk("protocol", "pass")] }), null);
  // Tool names but no check recorded which tools it called (a result merged before the fleet kept them).
  assert.equal(toolVerdicts(server([chk("protocol", "pass")])), null);
});

test("one row per declared tool, in the server's order, with each public check that called it and its verdict", () => {
  const t = toolVerdicts(server([
    chk("protocol", "pass", { probed: ["read_file", "write_file"], notCovered: ["list_dir"] }),
    chk("robust-input", "fail", { probed: ["write_file"], notCovered: [] }),
  ]));
  assert.deepEqual(t.rows.map((r) => r.tool), ["read_file", "write_file", "list_dir"]);
  assert.deepEqual(t.rows[0].called, [{ id: "protocol", pack: "core", verdict: "pass" }]);
  assert.deepEqual(t.rows[1].called.map((c) => `${c.id}:${c.verdict}`), ["protocol:pass", "robust-input:fail"]);
  assert.deepEqual(t.rows[2].called, []);
  assert.deepEqual(t.rows[2].notCalled, [{ id: "protocol", pack: "core" }]);
  assert.equal(t.cut, false);
});

test("a tool a check called but the declared list lacks is still listed, after the declared ones", () => {
  const t = toolVerdicts(server([chk("protocol", "pass", { probed: ["read_file", "hidden_tool"], notCovered: [] })], ["read_file"]));
  assert.deepEqual(t.rows.map((r) => r.tool), ["read_file", "hidden_tool"]);
});

test("a server with any security finding names no tool, whatever the stored data says", () => {
  const tools = { probed: ["read_file"], notCovered: [] };
  assert.equal(toolVerdicts(server([chk("protocol", "pass", tools), chk("secret-echo", "fail")])), null);
  // A critical failure on a public id is a security check too (fail closed).
  assert.equal(toolVerdicts(server([chk("protocol", "pass", tools), chk("robust-input", "fail", undefined, { critical: true })])), null);
  // An unknown check id that failed counts as a finding.
  assert.equal(toolVerdicts(server([chk("protocol", "pass", tools), chk("some-new-check", "fail")])), null);
});

test("a server with a redacted check names no tool, even when the check itself looks public", () => {
  const tools = { probed: ["read_file"], notCovered: [] };
  assert.equal(toolVerdicts(server([chk("protocol", "pass", tools)]), new Map([["protocol", { redacted: true }]])), null);
});

test("tool names stored on a security check are never shown, even when it passed", () => {
  const t = toolVerdicts(server([
    chk("protocol", "pass", { probed: ["read_file"], notCovered: [] }),
    chk("secret-echo", "pass", { probed: ["write_file"], notCovered: [] }),
    chk("refusal-quality", "pass", { probed: ["list_dir"], notCovered: [] }, { advisory: false }),
  ]));
  assert.deepEqual(t.rows.flatMap((r) => r.called.map((c) => c.id)), ["protocol"]);
});

test("names that are not plain tool names are dropped, never cut or shown", () => {
  const bad = ["", "a".repeat(129), "evil‮exe", "zero​width", "line\nbreak", 42, null];
  const t = toolVerdicts(server([chk("protocol", "pass", { probed: ["ok_tool", ...bad], notCovered: bad })], ["ok_tool", ...bad]));
  assert.deepEqual(t.rows.map((r) => r.tool), ["ok_tool"]);
});

test("a check the fleet capped says so", () => {
  const t = toolVerdicts(server([chk("protocol", "pass", { probed: ["read_file"], notCovered: [], cut: 3 })]));
  assert.equal(t.cut, true);
});

test("real data: no entry with a security finding or a redaction gets a table", async () => {
  const data = JSON.parse(readFileSync(new URL("../content/data/server-results.json", import.meta.url), "utf8"));
  const { isSecurityFinding } = await import("./disclosure.mjs");
  for (const x of data.servers) {
    const t = toolVerdicts(x);
    if (x.checks.some(isSecurityFinding)) assert.equal(t, null, x.id);
  }
});
