// Which tools each check called, kept in server-results.json for per-tool verdicts on the results pages.
// Pure functions, no I/O; fleet/merge.mjs calls them for every graded report. Tests: fleet/check-tools.test.mjs.
//
// server-results.json is public (this repository is public), so a check's tool names are kept only where the
// disclosure rules let the site show that check's evidence: the same fail-closed rule as web/lib/disclosure.mjs.
// A critical result, a check classified "private", an advisory-class check that a newer CLI scores, and any id
// fleet/security-checks.mjs does not know name no tool. Only tool names are kept: never the CLI's reasons, the
// arguments or any server output. No verdict or grade is read or changed here.
import { CHECK_CLASS, securityFindings } from "./security-checks.mjs";
import { isSecurityFinding } from "../web/lib/disclosure.mjs";

/** At most this many names per list; a name over 128 characters or with unusual characters is dropped. */
export const MAX_TOOLS = 200;
const MAX_NAME = 128;

/** @param {unknown[]} list */
export function plainNames(list) {
  const out = [];
  for (const n of list) {
    // Only plain tool names: printable ASCII and letters, no control, bidi or zero-width characters, and a name that is
    // too long is dropped rather than cut (a cut name could merge two tools).
    if (typeof n !== "string" || n === "" || n.length > MAX_NAME || !/^[\p{L}\p{N} _.:\/@+#-]+$/u.test(n)) continue;
    const name = n;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** May the public data name the tools this check called? Same rule as web/lib/disclosure.mjs isSecurityCheck, negated. */
export function namesTools(check) {
  if (check.critical === true) return false;
  const cls = CHECK_CLASS[check.id];
  return cls === "public" || (cls === "advisory" && check.advisory === true);
}

/**
 * A server with any security finding (held or not) names no tool anywhere: a sibling check could point to the tool behind it.
 * Both rules: the fleet's, and the site's (web/lib/disclosure.mjs), which also holds an unknown or private id flagged advisory.
 */
export const hasFinding = (server) =>
  securityFindings({ checks: server.checks ?? [] }).length > 0 || (server.checks ?? []).some((c) => c && typeof c === "object" && isSecurityFinding(c));

/**
 * The tools one check called with a valid call (`probed`) and the ones it could not (`notCovered`), or undefined.
 * @param {{ id: string, critical?: boolean, advisory?: boolean, coverage?: { probed?: unknown, notCovered?: unknown } }} check
 * @returns {{ probed: string[], notCovered: string[], cut?: number } | undefined}
 */
export function checkTools(check, server) {
  if (!check || !namesTools(check) || (server && hasFinding(server))) return undefined;
  const c = check.coverage;
  if (!c || !Array.isArray(c.probed)) return undefined;
  const probed = plainNames(c.probed);
  const notCovered = plainNames((Array.isArray(c.notCovered) ? c.notCovered : []).map((n) => (n && typeof n === "object" ? n.tool : undefined)));
  const cut = Math.max(0, probed.length - MAX_TOOLS) + Math.max(0, notCovered.length - MAX_TOOLS);
  const out = { probed: probed.slice(0, MAX_TOOLS), notCovered: notCovered.slice(0, MAX_TOOLS) };
  if (cut) out.cut = cut;
  return out;
}

/**
 * The tool names the server declared in this run (a report's `server.tools`), or undefined when the report has none.
 * @param {{ tools?: unknown } | undefined} server @param {object[]} [checks] the report's checks
 * @returns {string[] | undefined}
 */
export function serverTools(server, checks) {
  if (!server || !Array.isArray(server.tools) || (checks && hasFinding({ checks }))) return undefined;
  return plainNames(server.tools.map((t) => (t && typeof t === "object" ? t.name : t))).slice(0, MAX_TOOLS);
}

const HASH = /^[0-9a-f]{12,}$/;

/**
 * Tool schema drift (site#54): each declared tool's input schema, as the first 12 hex characters of the CLI's
 * `inputSchemaHash` (sha256 of the schema's canonical JSON, from the report's `server.surface`). Only a hash: never the
 * schema, the description or any other server text. Same rule as serverTools: nothing for a server with a security finding,
 * and nothing at all when any tool cannot be kept (unplain name, bad hash, repeat, over MAX_TOOLS).
 * @param {{ surface?: unknown } | undefined} server @param {object[]} [checks] the report's checks
 * @returns {Record<string, string> | undefined}
 */
export function toolSchemas(server, checks) {
  if (!server || !Array.isArray(server.surface) || (checks && hasFinding({ checks }))) return undefined;
  // All or nothing: a dropped, repeated or capped tool would read as "added" or "no longer listed" on the next run.
  if (server.surface.length > MAX_TOOLS) return undefined;
  if (Array.isArray(server.tools) && server.tools.length !== server.surface.length) return undefined;
  const out = {};
  for (const t of server.surface) {
    const name = t && typeof t === "object" ? t.name : undefined;
    const hash = t && typeof t === "object" ? t.inputSchemaHash : undefined;
    if (name === "__proto__" || plainNames([name]).length !== 1 || typeof hash !== "string" || !HASH.test(hash)) return undefined;
    if (Object.prototype.hasOwnProperty.call(out, name)) return undefined;
    out[name] = hash.slice(0, 12);
  }
  return out;
}

/**
 * The schema hashes of the last graded run on an earlier date than `testedAt`, kept on the new entry as its baseline.
 * The entry being replaced is the last graded run: from an earlier day, its hashes are the baseline; from the same day,
 * the baseline it carried is kept (the page compares with the previous day's run, as fleet/history.jsonl does).
 * @param {{ testedAt?: string, toolSchemas?: Record<string, string>, toolSchemasBefore?: { date: string, schemas: Record<string, string> } } | undefined} old
 * @param {string} testedAt
 */
export function schemasBefore(old, testedAt) {
  if (!old || typeof old.testedAt !== "string") return undefined;
  if (old.testedAt < testedAt) return old.toolSchemas ? { date: old.testedAt, schemas: old.toolSchemas } : undefined;
  if (old.testedAt === testedAt) return old.toolSchemasBefore ?? undefined;
  return undefined;
}
