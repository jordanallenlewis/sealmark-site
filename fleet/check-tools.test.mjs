// check-tools.mjs keeps which tools each check called (for per-tool verdicts on the results pages), only where the
// disclosure rules let the public data name them. Run from the repository root: node --test fleet/check-tools.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTools, serverTools, MAX_TOOLS } from "./check-tools.mjs";
import { CHECK_CLASS } from "./security-checks.mjs";

const publicId = Object.keys(CHECK_CLASS).find((id) => CHECK_CLASS[id] === "public");
const advisoryId = Object.keys(CHECK_CLASS).find((id) => CHECK_CLASS[id] === "advisory");
const privateId = Object.keys(CHECK_CLASS).find((id) => CHECK_CLASS[id] === "private");

const cov = { probed: ["read_file", "list_dir"], notCovered: [{ tool: "write_file", reason: "no target" }], validCalls: 3 };

test("a public check keeps the tool names it called and could not call, without reasons", () => {
  assert.deepEqual(checkTools({ id: publicId, verdict: "pass", coverage: cov }), { probed: ["read_file", "list_dir"], notCovered: ["write_file"] });
});

test("an advisory-class check keeps them only while the result is advisory", () => {
  assert.ok(checkTools({ id: advisoryId, advisory: true, verdict: "fail", coverage: cov }));
  assert.equal(checkTools({ id: advisoryId, verdict: "fail", coverage: cov }), undefined);
});

test("security checks, critical results and unknown ids name no tool (fail closed)", () => {
  assert.equal(checkTools({ id: privateId, verdict: "pass", coverage: cov }), undefined);
  assert.equal(checkTools({ id: publicId, critical: true, verdict: "fail", coverage: cov }), undefined);
  assert.equal(checkTools({ id: "a-check-a-newer-cli-adds", verdict: "pass", coverage: cov }), undefined);
});

test("no coverage, or malformed coverage, gives nothing", () => {
  assert.equal(checkTools({ id: publicId, verdict: "pass" }), undefined);
  assert.equal(checkTools({ id: publicId, verdict: "pass", coverage: { probed: "x" } }), undefined);
  assert.deepEqual(checkTools({ id: publicId, verdict: "pass", coverage: { probed: ["a", 7, "", "a"], notCovered: [{}, { tool: "b" }, "c"] } }), { probed: ["a"], notCovered: ["b"] });
});

test("long lists are capped and say how many were cut", () => {
  const many = Array.from({ length: MAX_TOOLS + 5 }, (_, i) => `t${i}`);
  const out = checkTools({ id: publicId, verdict: "pass", coverage: { probed: many, notCovered: [] } });
  assert.equal(out.probed.length, MAX_TOOLS);
  assert.equal(out.cut, 5);
});

test("serverTools keeps declared tool names (strings or {name}), deduplicated and capped", () => {
  assert.deepEqual(serverTools({ tools: ["a", { name: "b" }, "a", null, 3] }), ["a", "b"]);
  assert.equal(serverTools({}), undefined);
  assert.equal(serverTools({ tools: Array.from({ length: 400 }, (_, i) => `t${i}`) }).length, MAX_TOOLS);
});

test("a server with any security finding names no tool, on any check or in its tool list", () => {
  const finding = { id: privateId, verdict: "fail" };
  const pub = { id: publicId, verdict: "pass", coverage: cov };
  assert.equal(checkTools(pub, { checks: [pub, finding] }), undefined);
  assert.ok(checkTools(pub, { checks: [pub, { id: privateId, verdict: "pass" }] }));
  assert.equal(serverTools({ tools: ["a"] }, [pub, finding]), undefined);
  assert.deepEqual(serverTools({ tools: ["a"] }, [pub]), ["a"]);
});

test("names with control, bidi or zero-width characters, or over 128 characters, are dropped", () => {
  assert.deepEqual(serverTools({ tools: ["ok_tool", "a\u202eb", "a\u200bb", "a\nb", "x".repeat(129), "get-data.v2"] }), ["ok_tool", "get-data.v2"]);
});

// Tool schema drift (site#54 slice 3): per run, a short hash of each tool's input schema, and the hashes of the last
// graded run on an earlier date, so a results page can say which tools were added, are no longer listed, or changed input.
import { toolSchemas, schemasBefore } from "./check-tools.mjs";

const surface = [
  { name: "read_file", inputSchemaHash: "a".repeat(64), descriptionHash: "d", params: {}, required: [] },
  { name: "list_dir", inputSchemaHash: "b".repeat(64), descriptionHash: "d", params: {}, required: [] },
];

test("toolSchemas keeps plain names with a 12-character schema hash, nothing else", () => {
  assert.deepEqual(toolSchemas({ surface }, []), { read_file: "aaaaaaaaaaaa", list_dir: "bbbbbbbbbbbb" });
});

test("toolSchemas names nothing for a server with a security finding, and nothing without a surface", () => {
  const finding = [{ id: privateId, verdict: "fail" }];
  assert.equal(toolSchemas({ surface }, finding), undefined);
  assert.equal(toolSchemas({ tools: ["read_file"] }, []), undefined);
  assert.equal(toolSchemas(undefined, []), undefined);
});

test("toolSchemas keeps nothing when any tool cannot be kept (a gap would read as a removed tool next run)", () => {
  const odd = [
    { name: "ok", inputSchemaHash: "c".repeat(64) },
    { name: "bad‮name", inputSchemaHash: "c".repeat(64) },
    { name: "nohash" },
    { name: "short", inputSchemaHash: "zz" },
    { name: "ok", inputSchemaHash: "e".repeat(64) },
  ];
  for (const bad of odd.slice(1)) assert.equal(toolSchemas({ surface: [odd[0], bad] }, []), undefined, JSON.stringify(bad));
  assert.deepEqual(toolSchemas({ surface: [odd[0]] }, []), { ok: "cccccccccccc" });
  assert.equal(toolSchemas({ surface: [odd[0]], tools: ["ok", "other"] }, []), undefined);
});

test("toolSchemas keeps nothing over MAX_TOOLS tools", () => {
  const many = Array.from({ length: MAX_TOOLS + 3 }, (_, i) => ({ name: `t${i}`, inputSchemaHash: "f".repeat(64) }));
  assert.equal(toolSchemas({ surface: many }, []), undefined);
});

test("schemasBefore: an earlier graded run becomes the baseline", () => {
  const old = { testedAt: "2026-11-14", toolSchemas: { a: "111111111111" } };
  assert.deepEqual(schemasBefore(old, "2026-11-15"), { date: "2026-11-14", schemas: { a: "111111111111" } });
});

test("schemasBefore: a second run the same day keeps the baseline the first one had", () => {
  const old = { testedAt: "2026-11-15", toolSchemas: { a: "2" }, toolSchemasBefore: { date: "2026-11-14", schemas: { a: "1" } } };
  assert.deepEqual(schemasBefore(old, "2026-11-15"), { date: "2026-11-14", schemas: { a: "1" } });
  assert.equal(schemasBefore({ testedAt: "2026-11-15", toolSchemas: { a: "2" } }, "2026-11-15"), undefined);
});

test("schemasBefore: no old entry, no hashes on it, or a later date gives no baseline", () => {
  assert.equal(schemasBefore(undefined, "2026-11-15"), undefined);
  assert.equal(schemasBefore({ testedAt: "2026-11-14" }, "2026-11-15"), undefined);
  assert.equal(schemasBefore({ testedAt: "2026-11-16", toolSchemas: { a: "1" } }, "2026-11-15"), undefined);
});
