// "By tool" on a results page (site#54): for each tool the server declared, the public checks that called it with a
// valid call (and that check's verdict), and the public checks that did not exercise it (the CLI's notCovered: a cap
// Sealmark sets, a tool left out by design, input the run could not fill in, or a call that returned an error). Pure functions, no I/O:
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
 * @returns {{ rows: { tool: string, called: { id: string, pack: string, verdict: string, advisory: boolean }[], notCalled: { id: string, pack: string, advisory: boolean }[] }[], missing: boolean } | null}
 */
export function toolVerdicts(x, redactions) {
  const checks = Array.isArray(x?.checks) ? x.checks : [];
  if (redactions && redactions.size > 0) return null;
  if (checks.some(isSecurityFinding)) return null;
  const withTools = checks.filter((c) => !isSecurityCheck(c) && c.tools && Array.isArray(c.tools.probed));
  if (withTools.length === 0) return null;

  const order = [];
  let dropped = false;
  const add = (n) => { if (!plain(n)) dropped = true; else if (!order.includes(n)) order.push(n); };
  for (const n of Array.isArray(x.tools) ? x.tools : []) add(n);
  for (const c of withTools) {
    for (const n of c.tools.probed) add(n);
    for (const n of Array.isArray(c.tools.notCovered) ? c.tools.notCovered : []) add(n);
  }

  const rows = order.map((tool) => ({
    tool,
    called: withTools.filter((c) => c.tools.probed.includes(tool)).map((c) => ({ id: c.id, pack: c.pack, verdict: c.verdict, advisory: c.advisory === true })),
    notCalled: withTools.filter((c) => !c.tools.probed.includes(tool) && Array.isArray(c.tools.notCovered) && c.tools.notCovered.includes(tool)).map((c) => ({ id: c.id, pack: c.pack, advisory: c.advisory === true })),
  }));
  // Names can be missing three ways: a check's list was capped (cut), the fleet capped the declared list (it records no
  // cut, but the tool count still says how many there were), or a name was dropped as not plain.
  const missing = dropped || withTools.some((c) => Number(c.tools.cut) > 0) || rows.length < (Number(x.toolCount) || 0);
  return { rows, missing };
}
