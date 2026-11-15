// Which tools each check called, kept in server-results.json for per-tool verdicts on the results pages.
// Pure functions, no I/O; fleet/merge.mjs calls them for every graded report. Tests: fleet/check-tools.test.mjs.
//
// server-results.json is public (this repository is public), so a check's tool names are kept only where the
// disclosure rules let the site show that check's evidence: the same fail-closed rule as web/lib/disclosure.mjs.
// A critical result, a check classified "private", an advisory-class check that a newer CLI scores, and any id
// fleet/security-checks.mjs does not know name no tool. Only tool names are kept: never the CLI's reasons, the
// arguments or any server output. No verdict or grade is read or changed here.
import { CHECK_CLASS, securityFindings } from "./security-checks.mjs";

/** At most this many names per list; a name over 128 characters or with unusual characters is dropped. */
export const MAX_TOOLS = 200;
const MAX_NAME = 128;

/** @param {unknown[]} list */
function names(list) {
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
function namesTools(check) {
  if (check.critical === true) return false;
  const cls = CHECK_CLASS[check.id];
  return cls === "public" || (cls === "advisory" && check.advisory === true);
}

/** A server with any security finding (held or not) names no tool anywhere: a sibling check could point to the tool behind it. */
const hasFinding = (server) => securityFindings({ checks: server.checks ?? [] }).length > 0;

/**
 * The tools one check called with a valid call (`probed`) and the ones it could not (`notCovered`), or undefined.
 * @param {{ id: string, critical?: boolean, advisory?: boolean, coverage?: { probed?: unknown, notCovered?: unknown } }} check
 * @returns {{ probed: string[], notCovered: string[], cut?: number } | undefined}
 */
export function checkTools(check, server) {
  if (!check || !namesTools(check) || (server && hasFinding(server))) return undefined;
  const c = check.coverage;
  if (!c || !Array.isArray(c.probed)) return undefined;
  const probed = names(c.probed);
  const notCovered = names((Array.isArray(c.notCovered) ? c.notCovered : []).map((n) => (n && typeof n === "object" ? n.tool : undefined)));
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
  return names(server.tools.map((t) => (t && typeof t === "object" ? t.name : t))).slice(0, MAX_TOOLS);
}
