// node --test lib/   (npm test in web/)
// The site's redaction list (lib/disclosure.mjs) must agree with the fleet's security list (fleet/security-checks.mjs)
// on every check the CLI ships, and the redaction must hide what the disclosure policy promises.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as fleet from "../../fleet/security-checks.mjs";
import { PUBLIC_CHECKS, WEAK_PART, STATUSES, disclosureFor, isSecurityCheck, isSecurityFinding, isWeakSignal, redactedChecks } from "./disclosure.mjs";

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const registry = json("../content/generated/checks.json");
const results = json("../content/data/server-results.json");
const disclosure = json("../content/data/disclosure.json");

test("site and fleet agree on which registry checks are security findings", () => {
  const disagree = registry.filter((c) => isSecurityCheck(c) !== fleet.isSecurityCheck(c)).map((c) => c.id);
  assert.deepEqual(disagree, [], `update lib/disclosure.mjs PUBLIC_CHECKS or fleet/security-checks.mjs: ${disagree.join(", ")}`);
});

test("every public check is a real check id (no stale entries)", () => {
  const ids = new Set(registry.map((c) => c.id));
  assert.deepEqual([...PUBLIC_CHECKS].filter((id) => !ids.has(id)), []);
});

test("weak-signal partials are security checks and never a partial bypass in the fleet list", () => {
  for (const id of WEAK_PART) {
    assert.equal(isSecurityCheck({ id }), true, id);
    assert.equal(fleet.PART_IS_FINDING.has(id), false, id);
  }
  for (const id of fleet.PART_IS_FINDING) assert.equal(isSecurityFinding({ id, critical: true, verdict: "part" }), true, id);
});

test("fails closed: an unknown check id is security, and a critical flag always is", () => {
  assert.equal(isSecurityCheck({ id: "brand-new-check" }), true);
  assert.equal(isSecurityCheck({ id: "protocol", critical: true }), true);
  assert.equal(isSecurityFinding({ id: "brand-new-check", verdict: "part" }), true);
  assert.equal(isSecurityFinding({ id: "protocol", verdict: "fail" }), false);
  assert.equal(isSecurityFinding({ id: "net-loopback-ssrf", critical: true, verdict: "inconclusive" }), false);
});

test("weak signals", () => {
  assert.equal(isWeakSignal({ id: "annotation-honesty", critical: true, verdict: "part" }), true);
  assert.equal(isWeakSignal({ id: "tool-poisoning", critical: true, verdict: "part" }), true);
  assert.equal(isWeakSignal({ id: "tool-poisoning", critical: true, verdict: "fail" }), false);
  assert.equal(isSecurityFinding({ id: "annotation-honesty", critical: true, verdict: "part" }), false);
});

test("disclosure state: default, reported, day 90, fixed, published", () => {
  const e = {
    "a/x": { status: "reported", reportedAt: "2026-11-01", publishAfter: null },
    "a/y": { status: "fixed", reportedAt: "2026-11-01" },
    "a/z": { status: "published" },
    "a/w": { status: "reported", reportedAt: "2026-11-01", publishAfter: "2026-11-20" },
    "a/bad": { status: "nonsense" },
  };
  assert.deepEqual(disclosureFor(e, "a", "missing", "2026-11-12"), { status: "pending-report", reportedAt: null, publishAfter: null, redacted: true });
  assert.equal(disclosureFor(e, "a", "bad", "2030-01-01").redacted, true);
  assert.deepEqual(disclosureFor(e, "a", "x", "2026-11-12"), { status: "reported", reportedAt: "2026-11-01", publishAfter: "2027-01-30", redacted: true });
  assert.equal(disclosureFor(e, "a", "x", "2027-01-30").redacted, false);
  assert.equal(disclosureFor(e, "a", "w", "2026-11-19").redacted, true);
  assert.equal(disclosureFor(e, "a", "w", "2026-11-20").redacted, false);
  assert.equal(disclosureFor(e, "a", "y", "2026-11-12").redacted, false);
  assert.equal(disclosureFor(e, "a", "z", "2026-11-12").redacted, false);
});

test("disclosure.json uses only known statuses and dates", () => {
  for (const [k, v] of Object.entries(disclosure.findings)) {
    assert.match(k, /^[^/]+\/[^/]+$/, k);
    assert.ok(STATUSES.includes(v.status), `${k}: ${v.status}`);
    for (const d of [v.reportedAt, v.publishAfter]) if (d != null) assert.match(d, /^\d{4}-\d{2}-\d{2}$/, k);
  }
});

test("the published data: a security fail is redacted, a weak signal is not", () => {
  const byId = (id) => results.servers.find((x) => x.id === id);
  const kazuph = byId("kazuph-fetch");
  if (kazuph && kazuph.checks.some((c) => c.id === "net-loopback-ssrf" && c.verdict === "fail")) {
    assert.ok(redactedChecks(kazuph, {}, "2026-11-12").has("net-loopback-ssrf"));
  }
  const tv = byId("atilaahmettaner-tradingview-mcp");
  if (tv) assert.equal(redactedChecks(tv, {}, "2026-11-12").size, 0);
  // With the committed statuses, every server with a security finding is redacted unless its entry says otherwise.
  for (const x of results.servers) {
    const found = x.checks.filter(isSecurityFinding).map((c) => c.id);
    const shown = found.filter((id) => !redactedChecks(x, disclosure.findings, "2026-11-12").has(id));
    for (const id of shown) assert.notEqual(disclosure.findings[`${x.id}/${id}`]?.status ?? "pending-report", "pending-report", `${x.id}/${id}`);
  }
});
