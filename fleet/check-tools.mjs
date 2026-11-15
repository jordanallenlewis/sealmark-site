// Which tools each check called, kept in server-results.json for per-tool verdicts on the results pages.
// Pure functions, no I/O; fleet/merge.mjs calls them for every graded report. Tests: fleet/check-tools.test.mjs.
//
// server-results.json is public (this repository is public), so a check's tool names are kept only where the
// disclosure rules let the site show that check's evidence: the same fail-closed rule as web/lib/disclosure.mjs.
// A critical result, a check classified "private", an advisory-class check that a newer CLI scores, and any id
// fleet/security-checks.mjs does not know name no tool. Only tool names are kept: never the CLI's reasons, the
// arguments or any server output. No verdict or grade is read or changed here.
import { CHECK_CLASS } from "./security-checks.mjs";

/** At most this many names per list; tool names are cut to 128 characters. */
export const MAX_TOOLS = 200;
const MAX_NAME = 128;

/** @param {unknown[]} list */
function names(list) {
  const out = [];
  for (const n of list) {
    if (typeof n !== "string" || n === "") continue;
    const name = n.slice(0, MAX_NAME);
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

/**
 * The tools one check called with a valid call (`probed`) and the ones it could not (`notCovered`), or undefined.
 * @param {{ id: string, critical?: boolean, advisory?: boolean, coverage?: { probed?: unknown, notCovered?: unknown } }} check
 * @returns {{ probed: string[], notCovered: string[], cut?: number } | undefined}
 */
export function checkTools(check) {
  if (!check || !namesTools(check)) return undefined;
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
 * @param {{ tools?: unknown } | undefined} server
 * @returns {string[] | undefined}
 */
export function serverTools(server) {
  if (!server || !Array.isArray(server.tools)) return undefined;
  return names(server.tools.map((t) => (t && typeof t === "object" ? t.name : t))).slice(0, MAX_TOOLS);
}
