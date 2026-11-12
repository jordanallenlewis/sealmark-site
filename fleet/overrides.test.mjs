// Unit tests for fleet/overrides.mjs, plus a check of the real fleet/overrides.json.
// Run from the repository root: node --test fleet/overrides.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canPlan, unplannableOverrides } from "./overrides.mjs";

test("canPlan accepts a launch a fleet VM can run", () => {
  assert.equal(canPlan("npx -y fetch-mcp@0.0.5"), true);
  assert.equal(canPlan('uvx --with "mcp<2" postgres-mcp@0.3.0 {dsn}'), true);
});

test("canPlan refuses a local checkout and anything that is not a string", () => {
  assert.equal(canPlan("node <workspace>"), false);
  assert.equal(canPlan("node <workspace>/dist/index.js --stdio"), false);
  assert.equal(canPlan(undefined), false);
  assert.equal(canPlan(42), false);
});

test("unplannableOverrides is empty for good overrides and for none", () => {
  assert.deepEqual(unplannableOverrides({ a: "npx -y a@1.0.0", b: "uvx b@2.0.0" }), []);
  assert.deepEqual(unplannableOverrides({}), []);
  assert.deepEqual(unplannableOverrides(undefined), []);
});

test("unplannableOverrides names every override the planner would never run, sorted", () => {
  const overrides = {
    zeta: "node <workspace>",
    ok: "npx -y ok@1.0.0",
    blank: "   ",
    empty: "",
    number: 7,
    nothing: null,
  };
  assert.deepEqual(unplannableOverrides(overrides), ["blank", "empty", "nothing", "number", "zeta"]);
});

test("fleet/overrides.json has no override the planner would skip forever", () => {
  const overrides = JSON.parse(readFileSync(new URL("./overrides.json", import.meta.url), "utf8"));
  assert.deepEqual(unplannableOverrides(overrides), []);
});
