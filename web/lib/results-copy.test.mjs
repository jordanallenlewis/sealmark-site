// node --test lib/   (npm test in web/)
import { test } from "node:test";
import assert from "node:assert/strict";
import { count, coverageNote, placeholdersIn, plainWords, reproduceCommand, sentence, shellArg } from "./results-copy.mjs";

test("count pluralizes", () => {
  assert.equal(count(1, "tool", "tools"), "1 tool");
  assert.equal(count(0, "tool", "tools"), "0 tools");
  assert.equal(count(39, "tool", "tools"), "39 tools");
});

test("sentence does not capitalize after an ellipsis", () => {
  assert.equal(sentence("not applicable. server config has no {dsn}/{host}/... placeholder, so no"), "Not applicable. Server config has no {dsn}/{host}/... placeholder, so no");
});

test("plainWords says test area, not pack", () => {
  assert.equal(plainWords("the http pack needs server.url; both packs"), "the http test area needs server.url; both test areas");
  assert.equal(plainWords("package.json"), "package.json");
  assert.equal(plainWords("covered by the core checks only"), "covered by the protocol checks only");
});

test("reproduce command quotes the start command for a POSIX shell", () => {
  assert.equal(reproduceCommand("1.0.0", "npx -y @kazuph/mcp-fetch@1.6.3"), `npx -y sealmark@1.0.0 run --start "npx -y @kazuph/mcp-fetch@1.6.3"`);
  assert.equal(shellArg(`uvx --with "mcp<2" postgres-mcp@0.3.0 {dsn}`), `'uvx --with "mcp<2" postgres-mcp@0.3.0 {dsn}'`);
  assert.equal(shellArg(`sh -c 'a "$0"' {sandbox}`), `'sh -c '\\''a "$0"'\\'' {sandbox}'`);
});

test("placeholders are found once each", () => {
  assert.deepEqual(placeholdersIn("x --repository {sandbox}/repo --db {dsn} {sandbox}"), ["{sandbox}", "{dsn}"]);
  assert.deepEqual(placeholdersIn("npx -y thing@1"), []);
});

test("coverage note", () => {
  assert.equal(coverageNote({ toolCount: 0, coverage: { level: "hygiene-only", toolsCalledValid: 0, toolsTotal: 0 } }, false).kind, "no-tools");
  assert.equal(
    coverageNote({ toolCount: 3, coverage: { level: "hygiene-only", toolsCalledValid: 0, toolsTotal: 3 } }, false).text,
    "None of the 3 tools could be called with default settings, so this grade covers the handshake and tool metadata only.",
  );
  assert.equal(
    coverageNote({ toolCount: 9, coverage: { level: "low", toolsCalledValid: 1, toolsTotal: 9 } }, false).text,
    "Only 1 of 9 tools could be called with default settings, so this grade covers the handshake and tool metadata only.",
  );
  assert.equal(coverageNote({ toolCount: 9, coverage: { level: "low", toolsCalledValid: 1, toolsTotal: 9 } }, true).kind, "low");
  assert.equal(coverageNote({ toolCount: 1, coverage: { level: "covered", toolsCalledValid: 1, toolsTotal: 1 } }, true).text, "Tools reached with a valid call: 1 of 1.");
});
