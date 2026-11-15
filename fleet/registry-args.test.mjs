// Unit tests for fleet/registry-args.mjs: which registry arguments the fleet's launch line carries, and when a server
// that failed before is tried again. Run from the repository root: node --test fleet/registry-args.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { registryArgs, registryLaunch, failedKey, failedKeys, recordArgs, usablePackage, packageId, knownPackage } from "./registry-args.mjs";

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

test("a required argument is never dropped: if it cannot be passed, the package is not usable", () => {
  const req = pos("mcp", { isRequired: true });
  assert.equal(registryArgs({ runtimeArguments: [named("-y")], packageArguments: [req] }), null);
  assert.equal(registryArgs({ packageArguments: [pos(undefined, { valueHint: "dir" }), req] }), null);
  assert.equal(registryArgs({ packageArguments: [named("bad name", "x"), req] }), null);
  assert.equal(registryArgs({ packageArguments: [{ type: "other", value: "x" }, req] }), null);
});

const npmPkg = (identifier, extra = {}) => ({ registryType: "npm", identifier, version: "1.0.0", transport: { type: "stdio" }, ...extra });

test("usablePackage takes the first stdio npm or PyPI package it can start, with its arguments", () => {
  assert.deepEqual(usablePackage({ packages: [npmPkg("a", { packageArguments: [pos("mcp")] })] }).args, ["mcp"]);
  // A package whose required argument cannot be passed is skipped for the next one, as before.
  const server = { packages: [npmPkg("first", { runtimeArguments: [named("-y")], packageArguments: [pos("mcp", { isRequired: true })] }), npmPkg("second")] };
  const r = usablePackage(server);
  assert.equal(r.pkg.identifier, "second");
  assert.deepEqual(r.args, []);
  assert.equal(usablePackage({ packages: [npmPkg("e", { environmentVariables: [{ name: "K", isRequired: true }] })] }).pkg, null);
  assert.equal(usablePackage({ packages: [{ ...npmPkg("h"), transport: { type: "streamable-http" } }] }).pkg, null);
  const other = usablePackage({ packages: [{ registryType: "oci", identifier: "x" }] });
  assert.equal(other.pkg, null);
  assert.equal(other.hasOtherPkg, true);
  assert.equal(usablePackage({}).pkg, null);
});

test("packageId and knownPackage: a server is known if any of its packages is, so it never gets a second listing", () => {
  assert.equal(packageId("@Scope/My.Pkg"), "scope-my-pkg");
  const known = new Set(["second"]);
  assert.equal(knownPackage({ packages: [npmPkg("first"), { ...npmPkg("second"), registryType: "pypi" }] }, known), true);
  assert.equal(knownPackage({ packages: [npmPkg("first")] }, known), false);
  assert.equal(knownPackage({}, known), false);
});

test("the key merge.mjs writes for a failed try is the key plan.mjs looks up", () => {
  const meta = { id: "tares", version: "0.4.0", args: ["mcp"] };
  const line = JSON.stringify({ id: meta.id, version: meta.version, ...recordArgs(meta), status: "failed" });
  assert.ok(failedKeys(line).has(failedKey("tares", "0.4.0", ["mcp"])));
});
