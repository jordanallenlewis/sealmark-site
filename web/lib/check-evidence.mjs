// The evidence viewer on a server page (site#65): what each public check sent and saw in this run, from
// fleet/evidence.json (written by the fleet's re-test run, fleet/evidence.mjs). Pure; covered by
// lib/check-evidence.test.mjs.
//
// The fleet already keeps only scored public checks and nothing for a server with a security finding. This applies the
// same rule again at render and fails closed, because the page and the evidence file are written by different steps:
// - nothing at all on a held page, or on a server with any security finding by the site's rule (even after its
//   disclosure ends: a published finding's evidence is the report's business, not this viewer's);
// - nothing when the record is from another run than the page shows (date, Sealmark version or config hash differ),
//   so a line can never sit beside a verdict it did not produce;
// - only checks on the page that are scored, public, not advisory and not critical (fleet/security-checks.mjs);
// - every text cleaned again: one line, no control or format characters, cut at MAX_TEXT.
import { isPublicCheck } from "../../fleet/security-checks.mjs";
import { plainNames } from "../../fleet/check-tools.mjs";
import { MAX_LINES, MAX_TEXT } from "../../fleet/evidence.mjs";
import { isSecurityFinding } from "./disclosure.mjs";

/** Lines shown per check and characters per text: the fleet's own limits. */
export { MAX_LINES, MAX_TEXT };

/** How the CLI decided a line (its `VerifiedBy`), in words that follow "Decided". A known source without words shows its id only. */
export const SOURCE_WORDS = {
  "db-state": "by reading the database itself",
  response: "from what the server returned",
  protocol: "from the MCP exchange",
  static: "from the declared tool metadata",
  listener: "by Sealmark's own listener",
  process: "by reading the process table",
  "fs-observer": "by reading the sandbox files itself",
  http: "from the HTTP exchange with the server",
};
const SOURCES = new Set([...Object.keys(SOURCE_WORDS), "upstream", "log", "authserver"]);

/** @param {unknown} v */
function clean(v) {
  if (typeof v !== "string") return "";
  const t = v.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (c) => (/\s/.test(c) ? " " : "")).replace(/\s+/g, " ").trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}…` : t;
}

/** @param {unknown} e */
function viewLine(e) {
  if (!e || typeof e !== "object") return null;
  const probe = clean(e.probe);
  const outcome = clean(e.outcome);
  if (!probe && !outcome) return null;
  const by = typeof e.by === "string" && SOURCES.has(e.by) ? e.by : null;
  const how = by && Object.prototype.hasOwnProperty.call(SOURCE_WORDS, by) ? SOURCE_WORDS[by] : null;
  const tool = typeof e.tool === "string" ? plainNames([e.tool])[0] ?? null : null;
  return { probe, outcome, by, how, tool };
}

/**
 * @param {unknown} record this server's entry in fleet/evidence.json
 * @param {{ testedAt: string, sealmark: { version: string }, configHash: string, checks: Array<{ id: string, critical?: boolean, advisory?: boolean, verdict?: string, summary?: string }> }} server
 * @param {{ held: boolean }} o held: a finding on this page is under private disclosure
 * @returns {Map<string, { total: number, lines: Array<{ probe: string, outcome: string, by: string | null, how: string | null, tool: string | null }> }> | null}
 */
export function checkEvidence(record, server, { held }) {
  if (held || !record || typeof record !== "object") return null;
  const r = /** @type {Record<string, any>} */ (record);
  if (!r.checks || typeof r.checks !== "object") return null;
  if (typeof r.configHash !== "string" || r.testedAt !== server.testedAt || r.sealmark !== server.sealmark?.version || r.configHash !== server.configHash) return null;
  const checks = Array.isArray(server.checks) ? server.checks : [];
  if (checks.some((c) => isSecurityFinding(c))) return null;
  const out = new Map();
  for (const c of checks) {
    if (typeof c.id !== "string" || c.id === "__proto__" || !isPublicCheck(c) || !Object.prototype.hasOwnProperty.call(r.checks, c.id)) continue;
    const rec = r.checks[c.id];
    if (!rec || !Array.isArray(rec.lines)) continue;
    const lines = rec.lines.map(viewLine).filter(Boolean).slice(0, MAX_LINES);
    if (!lines.length) continue;
    const total = Number.isInteger(rec.total) && rec.total >= lines.length ? rec.total : lines.length;
    out.set(c.id, { total, lines });
  }
  return out.size ? out : null;
}
