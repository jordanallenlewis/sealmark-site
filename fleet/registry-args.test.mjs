// Unit tests for fleet/registry-args.mjs: which registry arguments the fleet's launch line carries, and when a server
// that failed before is tried again. Run from the repository root: node --test fleet/registry-args.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { registryArgs, registryLaunch, failedKey, failedKeys, recordArgs } from "./registry-args.mjs";

const pos = (value, extra = {}) => ({ type: "positional", value, ...extra });
const named = (name, value, extra = {}) => ({ type: "named", name, ...(value === undefined ? {} : { value }), ...extra });

test("no declared arguments: a bare launch", () => {
  assert.deepEqual(registryArgs({}), []);
  assert.deepEqual(registryArgs({ packageArguments: [] }), []);
  assert.deepEqual(registryArgs(undefined), []);
});

test("a fixed subcommand and fixed named arguments are passed in order", () => {
  assert.deepEqual(registryArgs({ packageArguments: [pos("mcp")] }), ["mcp"]);
  assert.deepEqual(registryArgs({ packageArguments: [pos("serve"), named("--transport", "stdio")] }), ["serve", "--transport", "stdio"]);
  assert.deepEqual(registryArgs({ packageArguments: [pos("mcp"), pos("serve")] }), ["mcp", "serve"]);
});

test("a required argument with a fixed value is fine; one without a fixed value makes the package unusable", () => {
  assert.deepEqual(registryArgs({ packageArguments: [pos("mcp", { isRequired: true })] }), ["mcp"]);
  assert.equal(registryArgs({ packageArguments: [pos(undefined, { isRequired: true, valueHint: "path" })] }), null);
  assert.equal(registryArgs({ packageArguments: [named("--api-key", undefined, { isRequired: true })] }), null);
  assert.equal(registryArgs({ packageArguments: [named("--region", "{region}", { isRequired: true })] }), null);
});

test("a hint or placeholder is never guessed: a positional without a fixed value keeps the bare launch", () => {
  assert.deepEqual(registryArgs({ packageArguments: [pos(undefined, { valueHint: "mcp" })] }), []);
  assert.deepEqual(registryArgs({ packageArguments: [pos("https://eks-mcp.{region}.api.aws/mcp"), named("--profile", undefined, { default: "default" })] }), []);
});

test("an optional named argument with no fixed value is left to the server's default", () => {
  assert.deepEqual(registryArgs({ packageArguments: [pos("mcp"), named("--profile", undefined, { default: "default" })] }), ["mcp"]);
});

test("runtime arguments keep the bare launch: they change which program npx or uvx runs", () => {
  assert.deepEqual(registryArgs({ runtimeArguments: [named("--package", "@clize/inbox")], packageArguments: [named("--profile", "inbox")] }), []);
  assert.deepEqual(registryArgs({ runtimeArguments: [named("--python", "3.12")], packageArguments: [pos("mcp")] }), []);
});

test("a value the CLI would split or a shell would read is never quoted or guessed", () => {
  for (const bad of ["two words", "a;b", "$(id)", "`id`", "a|b", "a&b", "'x'", '"x"', "{x}", "", "a\nb"]) {
    // As a positional it would shift the arguments after it: bare launch.
    assert.deepEqual(registryArgs({ packageArguments: [pos(bad)] }), [], JSON.stringify(bad));
    // As an optional named argument it is left out, like one with no fixed value.
    assert.deepEqual(registryArgs({ packageArguments: [pos("mcp"), named("--x", bad)] }), ["mcp"], JSON.stringify(bad));
    // As a required argument the package is not usable.
    assert.equal(registryArgs({ packageArguments: [named("--x", bad, { isRequired: true })] }), null, JSON.stringify(bad));
  }
  assert.deepEqual(registryArgs({ packageArguments: [named("rm -rf", "x")] }), []);
  assert.deepEqual(registryArgs({ packageArguments: [named("-x;y", "1")] }), []);
  assert.deepEqual(registryArgs({ packageArguments: [{ type: "other", value: "x" }] }), []);
  assert.deepEqual(registryArgs({ packageArguments: [pos("--connection=production"), pos("https://example.com/mcp")] }), ["--connection=production", "https://example.com/mcp"]);
});

test("registryLaunch builds the npx and uvx lines with the arguments after the pinned package", () => {
  assert.equal(registryLaunch("npm", "@a/b", "1.2.3", []), "npx -y @a/b@1.2.3");
  assert.equal(registryLaunch("npm", "@a/b", "1.2.3", ["mcp"]), "npx -y @a/b@1.2.3 mcp");
  assert.equal(registryLaunch("pypi", "tares", "0.4.0", ["mcp", "--transport", "stdio"]), "uvx tares==0.4.0 mcp --transport stdio");
  assert.equal(registryLaunch("pypi", "x", "1"), "uvx x==1");
});

test("an old failure (no args recorded) blocks a bare retry at that version, not a first try with arguments", () => {
  const text = [
    JSON.stringify({ id: "kadmo-cli", version: "0.9.0", status: "failed", error: "x" }),
    JSON.stringify({ id: "tares", version: "0.4.0", status: "failed", args: ["mcp"] }),
    JSON.stringify({ id: "ok-one", version: "1.0.0", status: "ok" }),
    "not json",
    "",
  ].join("\n");
  const failed = failedKeys(text);
  assert.ok(failed.has(failedKey("kadmo-cli", "0.9.0", [])));
  assert.ok(!failed.has(failedKey("kadmo-cli", "0.9.0", ["mcp"])));
  assert.ok(!failed.has(failedKey("kadmo-cli", "1.0.0", [])), "a new version is tried again");
  assert.ok(failed.has(failedKey("tares", "0.4.0", ["mcp"])), "a failure with the same arguments is not retried");
  assert.ok(!failed.has(failedKey("tares", "0.4.0", ["mcp", "--transport", "stdio"])));
  assert.ok(!failed.has(failedKey("ok-one", "1.0.0", [])));
  assert.equal(failedKeys(undefined).size, 0);
});

test("recordArgs keeps only a non-empty array of strings", () => {
  assert.deepEqual(recordArgs({ args: ["mcp"] }), { args: ["mcp"] });
  assert.deepEqual(recordArgs({ args: [] }), {});
  assert.deepEqual(recordArgs({}), {});
  assert.deepEqual(recordArgs({ args: "mcp" }), {});
  assert.deepEqual(recordArgs({ args: ["mcp", 1] }), {});
  assert.deepEqual(recordArgs(null), {});
});
