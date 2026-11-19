// Tool drift on a results page (site#54): against the graded run the "Since the run on" block compares with, which
// tools are newly listed, which are no longer listed, and which changed their input schema. Pure function, no I/O:
// covered by lib/tool-drift.test.mjs.
//
// The data is fleet/check-tools.mjs toolSchemas: a 12-character prefix of the CLI's sha256 of each tool's input schema,
// all tools or none, and none for a server with a security finding. The disclosure rule is applied again here at build
// time, fail closed, because stored names can go stale against disclosure.json and the check classification. Facts
// only: a missing tool can come from how one run read the list, so the page never says the server removed it.
import { isSecurityFinding } from "./disclosure.mjs";

const PLAIN = /^[\p{L}\p{N} _.:\/@+#-]+$/u;
const HASH = /^[0-9a-f]{12}$/;

/** A clean { name: hash } map, or null when anything in it is not plain (all or nothing, like the fleet). */
function clean(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const out = new Map();
  for (const [name, hash] of Object.entries(m)) {
    if (name === "" || name.length > 128 || !PLAIN.test(name) || typeof hash !== "string" || !HASH.test(hash)) return null;
    out.set(name, hash);
  }
  return out;
}

/**
 * @param {{ testedAt?: string, checks?: any[], toolSchemas?: unknown, toolSchemasBefore?: unknown }} x a ServerResult
 * @param {{ from: { date: string, sealmark?: string }, to: { date: string, sealmark?: string } } | null} change changeSinceLast() for this page
 * @param {Map<string, unknown>} [redactions] redactionsFor(x): any entry means a finding is held, so no tool is named
 * @returns {{ added: string[], removed: string[], changed: string[] } | null}
 */
export function toolDrift(x, change, redactions) {
  if (!change || !x || x.testedAt !== change.to?.date) return null;
  if (redactions && redactions.size > 0) return null;
  if ((Array.isArray(x.checks) ? x.checks : []).some(isSecurityFinding)) return null;
  // A new Sealmark version can read a schema differently, which would flag every tool: compare like with like only.
  if (!change.from?.sealmark || change.from.sealmark !== change.to?.sealmark) return null;
  const before = x.toolSchemasBefore;
  if (!before || typeof before !== "object" || before.date !== change.from?.date) return null;
  const now = clean(x.toolSchemas);
  const was = clean(before.schemas);
  if (!now || !was) return null;
  return {
    added: [...now.keys()].filter((n) => !was.has(n)),
    removed: [...was.keys()].filter((n) => !now.has(n)),
    changed: [...now.keys()].filter((n) => was.has(n) && was.get(n) !== now.get(n)),
  };
}
