import test from "node:test";
import assert from "node:assert/strict";
import { MAX_LINES, MAX_TEXT, SOURCE_WORDS, checkEvidence } from "./check-evidence.mjs";

const check = (id, over = {}) => ({ id, pack: "core", label: id, critical: false, advisory: false, verdict: "pass", summary: `${id} said pass`, ...over });
const server = (over = {}) => ({
  id: "s",
  testedAt: "2026-11-17",
  sealmark: { version: "1.0.1", methodology: "0.3-draft" },
  configHash: "sha256:d13e7893a0ac",
  checks: [check("protocol"), check("robust-input"), check("tool-poisoning", { pack: "core" })],
  ...over,
});
const line = (over = {}) => ({ probe: "initialize + tools/list", outcome: "server answered; 12 tool(s)", by: "protocol", ...over });
const record = (over = {}) => ({
  testedAt: "2026-11-17",
  sealmark: "1.0.1",
  configHash: "sha256:d13e7893a0ac",
  checks: {
    protocol: { total: 1, lines: [line()] },
    "robust-input": { total: 1, lines: [line({ probe: "53 invalid call(s) across 11 tool(s)", outcome: "all rejected cleanly", tool: "search" })] },
  },
  ...over,
});
const view = (r, x = server(), o = {}) => checkEvidence(r, x, { held: false, ...o });

test("no record: nothing", () => {
  assert.equal(view(undefined), null);
  assert.equal(view(null), null);
  assert.equal(view("x"), null);
  assert.equal(view(record({ checks: null })), null);
});

test("lines per public check, in the page's words", () => {
  const ev = view(record());
  assert.deepEqual([...ev.keys()], ["protocol", "robust-input"]);
  assert.deepEqual(ev.get("protocol"), { total: 1, lines: [{ probe: "initialize + tools/list", outcome: "server answered; 12 tool(s)", by: "protocol", how: SOURCE_WORDS.protocol, tool: null }] });
  assert.equal(ev.get("robust-input").lines[0].tool, "search");
});

test("evidence from another run than the page is never shown", () => {
  assert.equal(view(record({ testedAt: "2026-11-16" })), null);
  assert.equal(view(record({ sealmark: "1.0.0" })), null);
  assert.equal(view(record({ configHash: "sha256:000000000000" })), null);
  assert.equal(view(record({ configHash: undefined })), null);
});

test("a held page shows no evidence at all", () => {
  assert.equal(view(record(), server(), { held: true }), null);
});

test("a server with any security finding shows no evidence, even after its disclosure ends", () => {
  const x = server({ checks: [check("protocol"), check("robust-input"), check("secret-echo", { verdict: "fail" })] });
  assert.equal(view(record(), x), null);
  const part = server({ checks: [check("protocol"), check("tool-poisoning", { verdict: "part", summary: "a strong indicator" })] });
  assert.equal(view(record(), part), null);
});

test("a weak signal alone is not a finding: evidence stays", () => {
  const x = server({ checks: [check("protocol"), check("tool-poisoning", { verdict: "part", summary: "2 weak indicator(s) worth reading, none conclusive." })] });
  assert.ok(view(record(), x).has("protocol"));
});

test("only scored public checks that are on the page; never a security, advisory or critical one", () => {
  const r = record({
    checks: {
      protocol: { total: 1, lines: [line()] },
      "secret-echo": { total: 1, lines: [line()] },
      "write-gate": { total: 1, lines: [line()] },
      "db-rowcap": { total: 1, lines: [line()] },
      "made-up": { total: 1, lines: [line()] },
    },
  });
  const x = server({ checks: [check("protocol"), check("secret-echo"), check("write-gate", { advisory: true }), check("made-up")] });
  assert.deepEqual([...view(r, x).keys()], ["protocol"]);
  const crit = server({ checks: [check("protocol", { critical: true })] });
  assert.equal(view(record(), crit), null);
});

test("prototype keys and non-own properties are ignored", () => {
  const checks = Object.create({ protocol: { total: 1, lines: [line()] } });
  assert.equal(view(record({ checks })), null);
  const x = server({ checks: [check("__proto__"), check("protocol")] });
  assert.deepEqual([...view(JSON.parse('{"testedAt":"2026-11-17","sealmark":"1.0.1","configHash":"sha256:d13e7893a0ac","checks":{"__proto__":{"total":1,"lines":[{"probe":"p","outcome":"o"}]},"protocol":{"total":1,"lines":[{"probe":"p","outcome":"o"}]}}}'), x).keys()], ["protocol"]);
});

test("texts are cleaned again at render: one line, no control or format characters, cut at the limit", () => {
  const long = "a".repeat(MAX_TEXT + 50);
  const r = record({ checks: { protocol: { total: 1, lines: [line({ probe: "two\nlines‮ here\u0007", outcome: long })] } } });
  const l = view(r).get("protocol").lines[0];
  assert.equal(l.probe, "two lines here");
  assert.equal(l.outcome.length, MAX_TEXT + 1);
  assert.ok(l.outcome.endsWith("…"));
});

test("a line with neither probe nor outcome is dropped; a check left with none is dropped", () => {
  const r = record({ checks: { protocol: { total: 1, lines: [line({ probe: "", outcome: " " }), 3, null] }, "robust-input": record().checks["robust-input"] } });
  assert.deepEqual([...view(r).keys()], ["robust-input"]);
});

test("unknown sources and unplain tool names are dropped from the line, not shown raw", () => {
  const r = record({ checks: { protocol: { total: 1, lines: [line({ by: "<script>", tool: "evil‮tool" })] } } });
  const l = view(r).get("protocol").lines[0];
  assert.equal(l.by, null);
  assert.equal(l.how, null);
  assert.equal(l.tool, null);
});

test("a known source without words keeps its id; every source the fleet keeps is known", () => {
  for (const by of ["db-state", "response", "protocol", "static", "fs-observer", "listener", "process", "http", "upstream", "log", "authserver"]) {
    const l = view(record({ checks: { protocol: { total: 1, lines: [line({ by })] } } })).get("protocol").lines[0];
    assert.equal(l.by, by);
  }
});

test("at most MAX_LINES lines; total says how many the run had", () => {
  const many = Array.from({ length: MAX_LINES + 3 }, (_, i) => line({ probe: `p${i}` }));
  const r = record({ checks: { protocol: { total: 9, lines: many } } });
  const e = view(r).get("protocol");
  assert.equal(e.lines.length, MAX_LINES);
  assert.equal(e.total, 9);
  // A total below the lines shown, or not a whole number, is replaced by the count shown.
  assert.equal(view(record({ checks: { protocol: { total: 0, lines: [line(), line()] } } })).get("protocol").total, 2);
  assert.equal(view(record({ checks: { protocol: { total: "9", lines: [line()] } } })).get("protocol").total, 1);
});
