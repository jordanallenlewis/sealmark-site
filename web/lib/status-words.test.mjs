import test from "node:test";
import assert from "node:assert/strict";
import { findStatusWord, thirdPartyStrings } from "./status-words.mjs";

test("semver pre-release tags are data, not status wording", () => {
  for (const t of ["version 0.14.0-beta.2", "v1.0.0-beta", "1.2.3-rc.1+build5 graded", "telbase 0.14.0-beta.2 and 2.0.0-preview.3", "1.0.0-mock.1"]) {
    assert.equal(findStatusWord(t), null, t);
  }
});

test("status wording is still caught", () => {
  for (const t of ["This is a beta", "early preview", "mock data", "a concept", "beta-2", "version beta", "0.14-beta.2", "1.0.0 beta"]) {
    assert.ok(findStatusWord(t), t);
  }
  assert.equal(findStatusWord("see 0.14.0-beta.2, now in beta").word, "beta");
});

test("existing exemptions hold", () => {
  assert.equal(findStatusWord("table-preview and preview_table, the preview tool, no write concept"), null);
});

test("strings another party owns are exempt on results pages, whole tokens only, and our own wording still fails", () => {
  const exempt = thirdPartyStrings([{ id: "foo-mock-server", name: "@acme/mcp-preview", versionTested: "2.0-beta.1", tools: ["preview_deploy", { name: "mock-call" }, "ab"] }]);
  assert.deepEqual(exempt.slice(0, 2), ["@acme/mcp-preview", "foo-mock-server"].sort((a, b) => b.length - a.length));
  for (const t of ["foo-mock-server", "Server @acme/mcp-preview 2.0-beta.1 graded B", "calls preview_deploy and mock-call", "next: foo-mock-server, previous: x"]) assert.equal(findStatusWord(t, { exempt }), null, t);
  for (const t of ["foo-mock-server-2 is a mock", "xfoo-mock-server", "the preview of foo-mock-server", "2.0-beta.11", "this is beta"]) assert.ok(findStatusWord(t, { exempt }), t);
  assert.ok(findStatusWord("foo-mock-server"), "without the exemption it still fails");
  assert.equal(thirdPartyStrings([{ id: "ab", tools: ["x"] }]).length, 0, "too short to matter");
});
