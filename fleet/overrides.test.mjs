// Unit tests for fleet/overrides.mjs, plus a check of the real fleet/overrides.json.
// Run from the repository root: node --test fleet/overrides.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canPlan, unplannableOverrides, launchChanged, stuckOverrides } from "./overrides.mjs";

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

test("cyanheads-fs passes {sandbox} as its root, or the fs pack is never graded", () => {
  const overrides = JSON.parse(readFileSync(new URL("./overrides.json", import.meta.url), "utf8"));
  const launch = overrides["cyanheads-fs"];
  assert.match(launch, /\{sandbox\}/);
  assert.match(launch, /FS_BASE_DIRECTORY/);
});

test("launchChanged: an override that differs from the launch the stored grade was made with makes the server due", () => {
  const pin = (l, v) => l.replace(/@[0-9.]+/, "@" + v);
  assert.equal(launchChanged("npx -y a@1.0.0", "npx -y a@1.0.0", "1.0.0", pin), false);
  // The stored launch is pinned to the version tested; the override is compared at that same version.
  assert.equal(launchChanged("npx -y a@2.0.0", "npx -y a@1.0.0", "2.0.0", pin), false);
  assert.equal(launchChanged("npx -y a@1.0.0", "npx -y a@1.0.0 --flag", "1.0.0", pin), true);
});

test("launchChanged: nothing to compare means not changed", () => {
  const pin = (l) => l;
  assert.equal(launchChanged("npx -y a@1", undefined, "1", pin), false);
  assert.equal(launchChanged(undefined, "npx -y a@1", "1", pin), false);
  assert.equal(launchChanged("npx -y a@1", "node <workspace>", "1", pin), false);
});

test("stuckOverrides names an override that has failed every re-test for 7 days, and only that", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  const o = { a: "x", b: "x", c: "x", d: "x" };
  const run = (id, testedAt, status) => ({ id, testedAt, status });
  const history = [
    run("a", "2026-11-01", "failed"), run("a", "2026-11-12", "failed"), // failing for 12 days
    run("b", "2026-11-01", "failed"), run("b", "2026-11-10", "ok"), run("b", "2026-11-12", "failed"), // failed only since the 12th
    run("c", "2026-11-01", "ok"), // fine
    run("e", "2026-10-01", "failed"), // no override: not our business
  ];
  assert.deepEqual(stuckOverrides(o, history, 7, now), ["a"]);
  assert.deepEqual(stuckOverrides(o, [], 7, now), []);
  assert.deepEqual(stuckOverrides(undefined, undefined, 7, now), []);
});
