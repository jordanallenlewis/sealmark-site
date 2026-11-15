// "By tool" on a results page (site#54): for each tool the server declared, the public checks that called it with a
// valid call (and that check's verdict), and the public checks that could not call it. Pure functions, no I/O:
// covered by lib/tool-verdicts.test.mjs.
//
// A check's verdict is for the check as a whole: it does not say which tool caused it, and this file never derives a
// per-tool grade from it. The data comes from fleet/check-tools.mjs, which already names no tool for a security check
// or for a server with a security finding. The disclosure rules are applied again here at build time, fail closed:
// stored names can go stale against disclosure.json, and a newer CLI can add a check the fleet file did not know.
import { isSecurityCheck, isSecurityFinding } from "./disclosure.mjs";

// Same plain-name rule as fleet/check-tools.mjs: letters, digits and a few separators; no control, bidi or
// zero-width characters; a name over 128 characters is dropped, never cut (a cut name could merge two tools).
const PLAIN = /^[\p{L}\p{N} _.:\/@+#-]+$/u;
const plain = (n) => typeof n === "string" && n !== "" && n.length <= 128 && PLAIN.test(n);

/**
 * @param {{ tools?: unknown, checks?: any[] }} x a ServerResult
 * @param {Map<string, unknown>} [redactions] redactionsFor(x): any entry means a finding is held, so no tool is named
 * @returns {{ rows: { tool: string, called: { id: string, pack: string, verdict: string }[], notCalled: { id: string, pack: string }[] }[], cut: boolean } | null}
 */
export function toolVerdicts(x, redactions) {
  const checks = Array.isArray(x?.checks) ? x.checks : [];
  if (redactions && redactions.size > 0) return null;
  if (checks.some(isSecurityFinding)) return null;
  const withTools = checks.filter((c) => !isSecurityCheck(c) && c.tools && Array.isArray(c.tools.probed));
  if (withTools.length === 0) return null;

  const order = [];
  const add = (n) => { if (plain(n) && !order.includes(n)) order.push(n); };
  for (const n of Array.isArray(x.tools) ? x.tools : []) add(n);
  for (const c of withTools) {
    for (const n of c.tools.probed) add(n);
    for (const n of Array.isArray(c.tools.notCovered) ? c.tools.notCovered : []) add(n);
  }

  const rows = order.map((tool) => ({
    tool,
    called: withTools.filter((c) => c.tools.probed.includes(tool)).map((c) => ({ id: c.id, pack: c.pack, verdict: c.verdict })),
    notCalled: withTools.filter((c) => !c.tools.probed.includes(tool) && Array.isArray(c.tools.notCovered) && c.tools.notCovered.includes(tool)).map((c) => ({ id: c.id, pack: c.pack })),
  }));
  return { rows, cut: withTools.some((c) => Number(c.tools.cut) > 0) };
}
