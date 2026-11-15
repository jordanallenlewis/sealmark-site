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
  const long = "x".repeat(500);
  assert.equal(checkTools({ id: publicId, verdict: "pass", coverage: { probed: [long], notCovered: [] } }).probed[0].length, 128);
});

test("serverTools keeps declared tool names (strings or {name}), deduplicated and capped", () => {
  assert.deepEqual(serverTools({ tools: ["a", { name: "b" }, "a", null, 3] }), ["a", "b"]);
  assert.equal(serverTools({}), undefined);
  assert.equal(serverTools({ tools: Array.from({ length: 400 }, (_, i) => `t${i}`) }).length, MAX_TOOLS);
});
