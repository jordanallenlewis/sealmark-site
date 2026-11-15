// node --test lib/   (npm test in web/)
// Tool drift on a results page (site#54): which tools were newly listed, are no longer listed, or changed input schema
// since the graded run the "Since the run on" block compares with. Hashes from fleet/check-tools.mjs; the disclosure
// rule is applied again here, fail closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toolDrift } from "./tool-drift.mjs";

const change = { from: { date: "2026-11-14" }, to: { date: "2026-11-15" } };
const h = (c) => c.repeat(12);
const server = (now, before, extra = {}) => ({ id: "x", testedAt: "2026-11-15", checks: [{ id: "protocol", pack: "core", verdict: "pass" }], toolSchemas: now, toolSchemasBefore: before, ...extra });

test("added, no longer listed and changed input, in a stable order", () => {
  const d = toolDrift(server({ b: h("1"), c: h("9"), d: h("4") }, { date: "2026-11-14", schemas: { a: h("0"), b: h("1"), c: h("2") } }), change);
  assert.deepEqual(d, { added: ["d"], removed: ["a"], changed: ["c"] });
});

test("the same tools with the same schemas give empty lists, not null", () => {
  assert.deepEqual(toolDrift(server({ a: h("1") }, { date: "2026-11-14", schemas: { a: h("1") } }), change), { added: [], removed: [], changed: [] });
});

test("nothing when the baseline is not the run the page compares with", () => {
  assert.equal(toolDrift(server({ a: h("1") }, { date: "2026-11-13", schemas: { a: h("2") } }), change), null);
  assert.equal(toolDrift(server({ a: h("1") }, { date: "2026-11-14", schemas: { a: h("2") } }, { testedAt: "2026-11-16" }), change), null);
  assert.equal(toolDrift(server({ a: h("1") }, { date: "2026-11-14", schemas: { a: h("2") } }), null), null);
});

test("nothing without both sets of hashes", () => {
  assert.equal(toolDrift(server({ a: h("1") }, undefined), change), null);
  assert.equal(toolDrift(server(undefined, { date: "2026-11-14", schemas: { a: h("1") } }), change), null);
  assert.equal(toolDrift(server({ a: h("1") }, { date: "2026-11-14", schemas: "x" }), change), null);
});

test("nothing for a server with a held check or a security finding (fail closed)", () => {
  const ok = { date: "2026-11-14", schemas: { a: h("2") } };
  assert.equal(toolDrift(server({ a: h("1") }, ok), change, new Map([["some-check", {}]])), null);
  assert.equal(toolDrift(server({ a: h("1") }, ok, { checks: [{ id: "a-check-no-one-classified", pack: "core", verdict: "fail" }] }), change), null);
});

test("nothing when any stored name is not plain or any hash is malformed", () => {
  const ok = { date: "2026-11-14", schemas: { a: h("2") } };
  assert.equal(toolDrift(server({ "bad‮name": h("1") }, ok), change), null);
  assert.equal(toolDrift(server({ a: "zz" }, ok), change), null);
  assert.equal(toolDrift(server({ a: h("1") }, { date: "2026-11-14", schemas: { "x​y": h("2") } }), change), null);
});
