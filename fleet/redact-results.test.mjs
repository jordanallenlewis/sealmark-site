// node --test fleet/   The text of a held finding stays out of the public results file (fleet/redact-results.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { redactResults, withheldCheckIds } from "./redact-results.mjs";
import { keptSummary, privateEntry } from "./notify-owners.mjs";

const TODAY = "2026-11-17";
const chk = (id, pack, verdict, summary, over = {}) => ({ id, pack, label: id, critical: false, advisory: false, verdict, summary, ...over });
const server = (id, checks, over = {}) => ({ id, name: id, testedAt: "2026-11-16", versionTested: "1.0.0", sealmark: { version: "1.0.1" }, launch: "npx -y x", checks, ...over });
const held = () => server("held", [
  chk("fs-read-escape", "fs", "fail", "SECRET read_file via evil-dotdot", { critical: true }),
  chk("fs-write-escape", "fs", "pass", "SIBLING write ok", { critical: true }),
  chk("annotation-honesty", "fs", "part", "declared read-only; only caches changed", { critical: true }),
  chk("protocol", "core", "pass", "handshake ok"),
  chk("tool-poisoning", "core", "pass", "scanned, nothing", { critical: true }),
]);
const other = () => server("fine", [chk("fs-read-escape", "fs", "pass", "all reads stayed inside", { critical: true })]);
const E = {}; // no disclosure entry: pending-report, held

test("a finding and its security siblings are blanked; a weak signal, another area and another server keep their text", () => {
  const r = { servers: [held(), other()] };
  const removed = redactResults(r, E, TODAY);
  const [h, f] = r.servers;
  const by = (x, id) => x.checks.find((c) => c.id === id).summary;
  assert.equal(by(h, "fs-read-escape"), null);
  assert.equal(by(h, "fs-write-escape"), null);
  assert.equal(by(h, "annotation-honesty"), "declared read-only; only caches changed"); // weak: classification needs the text
  assert.equal(by(h, "protocol"), "handshake ok");
  assert.equal(by(h, "tool-poisoning"), "scanned, nothing");
  assert.equal(by(f, "fs-read-escape"), "all reads stayed inside");
  assert.deepEqual(removed.held.summaries, { "fs-read-escape": "SECRET read_file via evil-dotdot", "fs-write-escape": "SIBLING write ok" });
  assert.equal(removed.held.versionTested, "1.0.0");
  assert.equal(removed.fine, undefined);
  assert.equal(h.launch, "npx -y x"); // the planner re-tests from it
});

test("the redacted file still classifies the same: the finding stays a finding", () => {
  const r = { servers: [held()] };
  const before = [...withheldCheckIds(r.servers[0], E, TODAY)].sort();
  redactResults(r, E, TODAY);
  assert.deepEqual([...withheldCheckIds(r.servers[0], E, TODAY)].sort(), before);
});

test("idempotent: a second pass removes nothing and changes nothing", () => {
  const r = { servers: [held()] };
  redactResults(r, E, TODAY);
  const snap = JSON.stringify(r);
  assert.deepEqual(redactResults(r, E, TODAY), {});
  assert.equal(JSON.stringify(r), snap);
});

test("a finding that is public (fixed) or past its date is not blanked", () => {
  const fixed = { "held/fs-read-escape": { status: "fixed" } };
  const r = { servers: [held()] };
  assert.deepEqual(redactResults(r, fixed, TODAY), {});
  assert.equal(r.servers[0].checks[0].summary, "SECRET read_file via evil-dotdot");
  const due = { "held/fs-read-escape": { status: "reported", reportedAt: "2026-08-01" } };
  assert.deepEqual(redactResults({ servers: [held()] }, due, TODAY), {});
  const early = { "held/fs-read-escape": { status: "reported", reportedAt: "2026-11-01" } };
  assert.ok(redactResults({ servers: [held()] }, early, TODAY).held);
});

test("the private report path gets the text only for the result it was taken from", () => {
  const r = { servers: [held()] };
  const kept = redactResults(r, E, TODAY);
  const x = r.servers[0];
  const c = x.checks[0];
  assert.equal(keptSummary(x, c, kept), "SECRET read_file via evil-dotdot");
  assert.equal(keptSummary(x, c, {}), "");
  assert.equal(keptSummary({ ...x, testedAt: "2026-11-17" }, c, kept), "");
  assert.equal(keptSummary({ ...x, versionTested: "1.0.1" }, c, kept), "");
  assert.equal(keptSummary({ ...x, sealmark: { version: "1.0.2" } }, c, kept), "");
  assert.equal(keptSummary({ ...x, sealmark: undefined }, c, kept), "");
  const e = privateEntry({ repo: "o/r", servers: [x] }, { today: TODAY, kept });
  assert.equal(e.servers[0].security[0].summary, "SECRET read_file via evil-dotdot");
  assert.equal(privateEntry({ repo: "o/r", servers: [x] }, { today: TODAY }).servers[0].security[0].summary, "");
});

test("the committed file holds no summary the rule withholds", () => {
  const results = JSON.parse(fs.readFileSync("web/content/data/server-results.json", "utf8"));
  const entries = JSON.parse(fs.readFileSync("web/content/data/disclosure.json", "utf8")).findings;
  const today = new Date().toISOString().slice(0, 10);
  for (const s of results.servers) for (const id of withheldCheckIds(s, entries, today)) {
    assert.equal(s.checks.find((c) => c.id === id).summary, null, `${s.id}/${id}`);
  }
});
