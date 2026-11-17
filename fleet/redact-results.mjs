// Keeps the text of a held security finding out of web/content/data/server-results.json, which is public (this
// repository is public). The results pages and the API already withhold it (web/lib/disclosure.mjs); this is the same rule
// applied where the file is written, so the file itself no longer carries what the pages hide.
//
// What is blanked (summary becomes null): a check that is a finding under private disclosure, and a security check in the
// same test area that is not a weak signal (the pages hold those back too). A weak signal in that test area is cut down to
// the part that classifies it as weak (WEAK_PART in fleet/security-checks.mjs: the rest can name tools), never blanked:
// the text is what makes it a weak signal, so a blank would turn it into a finding. The start command (`launch`) stays: the planner needs it to re-test the server, and nothing outside this
// public repository keeps it between runs.
//
// The blanked text is handed to the private report path for this run only, as `fleet/owner-private-results.json`
// (gitignored, never committed). A held server that was not re-tested in the run has no text there, and no private report
// is sent for it until its next re-test (fleet/notify-owners.mjs).
//
// Run `node fleet/redact-results.mjs` to redact the committed file in place.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSecurityCheck, isWeakSignal, redactedChecks } from "../web/lib/disclosure.mjs";
import { WEAK_PART } from "./security-checks.mjs";

export const PRIVATE_RESULTS = "fleet/owner-private-results.json";

/**
 * The ids of the checks on one server whose summary must not be public today.
 * @param {{ id: string, checks?: object[] }} server
 * @param {Record<string, object>} entries disclosure.json findings
 * @param {string} today YYYY-MM-DD
 */
export function withheldCheckIds(server, entries, today) {
  const red = redactedChecks(server, entries, today);
  if (!red.size) return new Set();
  const packs = new Set((server.checks ?? []).filter((c) => red.has(c.id)).map((c) => c.pack));
  const out = new Set();
  for (const c of server.checks ?? []) {
    if (red.has(c.id) || (packs.has(c.pack) && isSecurityCheck(c) && !isWeakSignal(c))) out.add(c.id);
  }
  return out;
}

/** The summary a weak signal keeps: the match of its WEAK_PART pattern, nothing after it. */
export const weakCore = (c) => String(c.summary ?? "").trim().match(WEAK_PART[c.id] ?? /(?!)/)?.[0] ?? null;

/**
 * Blank the withheld summaries in `results` (in place). Idempotent.
 * @returns {Record<string, { testedAt: string, versionTested: string, sealmark: string | null, summaries: Record<string, string> }>}
 *   the text that was removed in this call, per server id (only servers that had some)
 */
export function redactResults(results, entries, today) {
  const removed = {};
  for (const s of results.servers ?? []) {
    const red = redactedChecks(s, entries ?? {}, today);
    const packs = new Set((s.checks ?? []).filter((c) => red.has(c.id)).map((c) => c.pack));
    for (const c of red.size ? s.checks : []) {
      if (!red.has(c.id) && packs.has(c.pack) && isSecurityCheck(c) && isWeakSignal(c)) {
        const core = weakCore(c);
        if (core && core !== c.summary) (removed[s.id] ??= { testedAt: s.testedAt, versionTested: s.versionTested, sealmark: s.sealmark?.version ?? null, summaries: {} }).summaries[c.id] = c.summary;
        if (core) c.summary = core;
      }
    }
    for (const id of withheldCheckIds(s, entries ?? {}, today)) {
      const c = s.checks.find((y) => y.id === id);
      if (typeof c.summary !== "string" || !c.summary) { c.summary = null; continue; }
      (removed[s.id] ??= { testedAt: s.testedAt, versionTested: s.versionTested, sealmark: s.sealmark?.version ?? null, summaries: {} }).summaries[id] = c.summary;
      c.summary = null;
    }
  }
  return removed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const FILE = path.join(root, "web", "content", "data", "server-results.json");
  const results = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const entries = JSON.parse(fs.readFileSync(path.join(root, "web", "content", "data", "disclosure.json"), "utf8")).findings;
  const removed = redactResults(results, entries, new Date().toISOString().slice(0, 10));
  fs.writeFileSync(FILE, JSON.stringify(results, null, 2) + "\n");
  console.log(`redacted ${Object.values(removed).reduce((n, r) => n + Object.keys(r.summaries).length, 0)} summaries on ${Object.keys(removed).length} servers`);
}
