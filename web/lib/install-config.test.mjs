// node --test lib/   (npm test in web/)
// "Add it to a client" on a results page (site#55): the server's start command as an mcpServers JSON block and a
// `claude mcp add` line, built from the tested launch so a reader installs the version that was graded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installConfig, splitLaunch } from "./install-config.mjs";

const srv = (launch, extra = {}) => ({ id: "demo", transport: "stdio", launch, versionTested: launch.match(/(?:@|==)([0-9][^\s"]*)/)?.[1] ?? "9.9.9", ...extra });

test("splits a start command the way a POSIX shell would, quotes included", () => {
  assert.deepEqual(splitLaunch("npx -y @a/b@1.0.0 --flag {dsn}"), ["npx", "-y", "@a/b@1.0.0", "--flag", "{dsn}"]);
  assert.deepEqual(splitLaunch(`uvx --with "mcp<2" x==1`), ["uvx", "--with", "mcp<2", "x==1"]);
  assert.deepEqual(splitLaunch(`uvx --with 'a b' x`), ["uvx", "--with", "a b", "x"]);
  // Anything a JSON args list cannot say: expansions, operators, an open quote.
  for (const bad of ["npx x && y", "npx $HOME", "npx x | y", "npx `x`", `npx "x`, "npx x; y", "npx a\\ b", "npx x > f"]) assert.equal(splitLaunch(bad), null, bad);
});

test("an npx server becomes an mcpServers block with the tested version and a claude mcp add line", () => {
  const c = installConfig(srv("npx -y @bytebase/dbhub@1.6.1 --transport stdio --dsn {dsn}", { id: "dbhub" }));
  assert.deepEqual(JSON.parse(c.json), { mcpServers: { dbhub: { command: "npx", args: ["-y", "@bytebase/dbhub@1.6.1", "--transport", "stdio", "--dsn", "postgresql://USER:PASSWORD@HOST:5432/DATABASE"] } } });
  assert.equal(c.claude, `claude mcp add dbhub -- npx -y "@bytebase/dbhub@1.6.1" --transport stdio --dsn "postgresql://USER:PASSWORD@HOST:5432/DATABASE"`);
  assert.deepEqual(c.fill, ["{dsn}"]);
});

test("placeholders become values for the reader to replace, inside a longer argument too", () => {
  const c = installConfig(srv("uvx mcp-server-git==2026.11.11 --repository {sandbox}/repo"));
  assert.deepEqual(JSON.parse(c.json).mcpServers.demo.args, ["mcp-server-git==2026.11.11", "--repository", "/path/to/folder/repo"]);
  assert.deepEqual(c.fill, ["{sandbox}"]);
  const plain = installConfig(srv("npx -y @a/b@2.0.0"));
  assert.deepEqual(plain.fill, []);
  assert.equal(plain.claude, `claude mcp add demo -- npx -y "@a/b@2.0.0"`);
});

test("a fleet harness wrapper, another program, a remote server or a withheld command gets no snippet", () => {
  assert.equal(installConfig(srv(`sh -c 'exec uvx x "$0"' {dsn}`)), null);
  assert.equal(installConfig(srv("node /tmp/x/index.js")), null);
  assert.equal(installConfig(srv("npx -y a@1", { transport: "http" })), null);
  assert.equal(installConfig(srv("npx -y a@1"), { withheld: true }), null);
  // An unknown placeholder is never passed through as if it were a value.
  assert.equal(installConfig(srv("npx -y a@1 --x {mystery}")), null);
});

test("the JSON key is a plain name; an id with a space or a dot gets no snippet", () => {
  assert.equal(installConfig(srv("npx -y a@1", { id: "bad id" })), null);
  assert.equal(installConfig(srv("npx -y a@1", { id: "io.github.x" })), null);
});

test("a command that does not pin the graded version gets no snippet", () => {
  assert.equal(installConfig(srv("npx -y github:exa-labs/exa-mcp-server", { versionTested: "3.4.3" })), null);
  assert.equal(installConfig(srv("uvx --from git+https://github.com/a/b b", { versionTested: "2.5.0" })), null);
  assert.equal(installConfig(srv("npx -y a@1.2.3", { versionTested: "1.2.4" })), null);
  assert.ok(installConfig(srv("uvx a==1.2.3", { versionTested: "1.2.3" })));
});

test("real data: every published stdio server that pins its version and is not wrapped in sh gets a snippet, and no braces survive", () => {
  const data = JSON.parse(readFileSync(new URL("../content/data/server-results.json", import.meta.url), "utf8"));
  let made = 0;
  for (const x of data.servers) {
    const c = installConfig(x);
    if (!c) { assert.ok(x.launch.startsWith("sh ") || x.transport !== "stdio" || x.ecosystem === "github", `${x.id}: ${x.launch}`); continue; }
    made++;
    assert.doesNotMatch(c.json + c.claude, /[{][a-z_]+(:[a-z]+)?[}]/, x.id);
  }
  assert.ok(made > 150, `only ${made} snippets`);
});
