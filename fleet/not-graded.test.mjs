// not-graded.mjs lists the servers the fleet tried but never graded, each with one typed reason and no server text.
// Run from the repository root: node --test fleet/not-graded.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNotGraded, reasonOf, REASONS } from "./not-graded.mjs";

const fail = (id, testedAt, error, version = "1.0.0") => ({ id, version, testedAt, status: "failed", error });
const ok = (id, testedAt) => ({ id, version: "1.0.0", testedAt, status: "ok", worst: "A" });

test("a server that was graded once, or is on the results page, is not listed", () => {
  const out = buildNotGraded({
    history: [fail("a", "2026-11-01", "Connection closed"), ok("a", "2026-11-02"), fail("a", "2026-11-03", "Connection closed"), fail("b", "2026-11-01", "Connection closed"), fail("c", "2026-11-01", "Connection closed")],
    graded: ["c"],
  });
  assert.deepEqual(out.servers.map((s) => s.id), ["b"]);
  assert.equal(out.count, 1);
});

test("the latest attempt decides the version, date and reason, and attempts are counted", () => {
  const out = buildNotGraded({
    history: [
      fail("x", "2026-11-01", "could not start or talk to the server: MCP error -32000: Not signed in. Run `x login`", "0.1.0"),
      fail("x", "2026-11-09", "the server did not answer initialize within 60 s (--connect-timeout).", "0.2.0"),
    ],
    graded: [],
  });
  assert.deepEqual(out.servers, [{ id: "x", version: "0.2.0", lastTried: "2026-11-09", attempts: 2, reason: "initialize-timeout" }]);
});

test("the CLI's typed start kind from telemetry wins over reading the error text", () => {
  const out = buildNotGraded({
    history: [fail("y", "2026-11-14", "could not start or talk to the server: MCP error -32000: Connection closed")],
    telemetry: [{ id: "y", testedAt: "2026-11-14", status: "failed", startKind: "missing-runtime" }, { id: "y", testedAt: "2026-11-13", status: "failed", startKind: "bad-launch" }],
    graded: [],
  });
  assert.equal(out.servers[0].reason, "missing-runtime");
});

test("an unknown start kind in telemetry is ignored, not published", () => {
  const out = buildNotGraded({
    history: [fail("y", "2026-11-14", "Connection closed")],
    telemetry: [{ id: "y", testedAt: "2026-11-14", status: "failed", startKind: "<script>" }],
    graded: [],
  });
  assert.equal(out.servers[0].reason, "unknown");
});

test("reasonOf types the error text conservatively; anything it cannot place is unknown", () => {
  const cases = [
    ["the server did not answer initialize within 60 s (--connect-timeout).", "initialize-timeout"],
    ["MCP error -32000: Not signed in. Run `cfo-cli login` (or set TOPY_API_KEY)..", "needs-credentials"],
    ["Connection closed (server stderr: Error: OPENAI_API_KEY is required)", "needs-credentials"],
    ["npm error code E404 | npm error 404 Not Found - GET https://registry.npmjs.org/nope", "dependency-resolution"],
    ["npm error code ETARGET | No matching version found for x@9", "dependency-resolution"],
    ["ModuleNotFoundError: No module named 'foo'", "dependency-resolution"],
    ["spawn uvx ENOENT", "missing-runtime"],
    ["sh: 1: docker: not found", "missing-runtime"],
    ["Connection closed (server stderr: Installed 29 packages in 7ms | usage: dsail [-h] [--url URL])", "bad-launch"],
    ["error: unrecognized arguments: --stdio", "bad-launch"],
    ["no report", "harness-error"],
    // a stack trace is usually the server's own stderr, not our failure; its credential line still types it
    ["Connection closed (server stderr: TypeError: x at /srv/index.js:12 | Error: OPENAI_API_KEY is required)", "needs-credentials"],
    ["TypeError: Cannot read properties of undefined (reading 'x') at grade.js:12", "unknown"],
    // a warning that a token is not set is not why it stopped
    ["Connection closed (server stderr: GITHUB_TOKEN not set, using unauthenticated requests)", "unknown"],
    ["EACCES: permission denied, open '/home/runner/x'", "unknown"],
    // npm's update notice is not a cause: the real error was cut off, so the reason stays unknown
    ["Connection closed (server stderr: npm notice New major version of npm available! 11.19.1 -> 12.2.2 | npm notice)", "unknown"],
    ["MCP error -32603: fetch failed (server stderr: cannot reach http://localhost:9300)", "unknown"],
    ["", "unknown"],
  ];
  for (const [text, want] of cases) assert.equal(reasonOf(text), want, text);
});

test("every reason the module can return is in REASONS", () => {
  const out = buildNotGraded({ history: [fail("a", "2026-11-01", "no report"), fail("b", "2026-11-01", "spawn x ENOENT")], graded: [] });
  for (const s of out.servers) assert.ok(REASONS.includes(s.reason), s.reason);
  assert.deepEqual(out.byReason, { "harness-error": 1, "missing-runtime": 1 });
});

test("servers are sorted newest attempt first, then by id; the output carries no error text", () => {
  const out = buildNotGraded({
    history: [fail("b", "2026-11-01", "secret sk-abcdefghijklmnop"), fail("a", "2026-11-01", "x"), fail("c", "2026-11-05", "x")],
    graded: [],
  });
  assert.deepEqual(out.servers.map((s) => s.id), ["c", "a", "b"]);
  assert.ok(!JSON.stringify(out).includes("sk-abc"));
  assert.deepEqual(Object.keys(out.servers[0]).sort(), ["attempts", "id", "lastTried", "reason", "version"]);
});

test("bad lines and records without an id are skipped", () => {
  const out = buildNotGraded({ history: [null, { status: "failed" }, "nope", fail("a", "2026-11-01", "x")], graded: [] });
  assert.equal(out.count, 1);
});
