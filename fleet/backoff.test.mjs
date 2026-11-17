import test from "node:test";
import assert from "node:assert/strict";
import { backedOff } from "./backoff.mjs";
import { cleanError } from "./clean-error.mjs";

const f = (d, v = "1.0.0", id = "a") => ({ id, version: v, testedAt: d, status: "failed" });
test("backoff: two recent failures at the same version wait; a new version, an old failure, or a later success do not", () => {
  assert.equal(backedOff([f("2026-11-16"), f("2026-11-17")], "a", "1.0.0", "2026-11-17"), true);
  assert.equal(backedOff([f("2026-11-17")], "a", "1.0.0", "2026-11-17"), false, "one failure is not enough");
  assert.equal(backedOff([f("2026-11-16"), f("2026-11-17")], "a", "1.0.1", "2026-11-17"), false, "a new version is tried at once");
  assert.equal(backedOff([f("2026-11-10"), f("2026-11-11")], "a", "1.0.0", "2026-11-17"), false, "tried again after the window");
  assert.equal(backedOff([f("2026-11-15"), f("2026-11-16"), { id: "a", version: "1.0.0", testedAt: "2026-11-16", status: "ok" }], "a", "1.0.0", "2026-11-17"), false);
  assert.equal(backedOff([f("2026-11-16", "1.0.0", "b"), f("2026-11-17", "1.0.0", "b")], "a", "1.0.0", "2026-11-17"), false, "another server");
});

test("cleanError: npm notices and warnings are not a cause, the real lines stay", () => {
  const raw = "MCP error -32000: Connection closed\nsh: 1: kordoc: not found\nnpm notice\nnpm notice New major version of npm available! 10.9.0 -> 11.0.0\nnpm warn deprecated x@1: gone\n";
  assert.equal(cleanError(raw), "MCP error -32000: Connection closed\nsh: 1: kordoc: not found");
  assert.equal(cleanError("npm notice only"), "");
  assert.equal(cleanError(undefined), undefined);
  assert.equal(cleanError("env: 'bun': No such file or directory"), "env: 'bun': No such file or directory");
});
