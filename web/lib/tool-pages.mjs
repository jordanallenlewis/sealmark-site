// One page per tool a public check called (site#64): /results/tools/<id>/<slug>/. Pure functions, no I/O: covered by
// lib/tool-pages.test.mjs; scripts/api-check.mjs (rule 12, through toolPagesProblems) checks the built pages.
//
// Built on lib/tool-verdicts.mjs, so the hold rule is the "By tool" table's and the tools directory's: no page for any
// tool of a server with a held check or any security finding, plain names only, and a page only for a tool that a public
// check reached with a valid call (the CLI's tools.probed). Nothing here grades a tool: a check's verdict is for the whole
// check, and the page says so. Evidence lines are the server page's (lib/check-evidence.mjs), narrowed to the lines the
// fleet recorded against this tool.
import { toolVerdicts } from "./tool-verdicts.mjs";

const SAFE = /^[A-Za-z0-9_.-]$/;
/**
 * The URL segment for a tool name: letters, digits, "_", "-" and "." as they are; any other character as ~<hex code point>~
 * ("~" is never in a plain name, so two names never share a slug). A name of dots only is fully encoded ("." and ".." are
 * not page paths).
 * @param {string} name
 */
export function toolSlug(name) {
  const dotsOnly = /^\.+$/.test(name);
  return [...name].map((c) => (SAFE.test(c) && !(dotsOnly && c === ".") ? c : `~${c.codePointAt(0).toString(16)}~`)).join("");
}

/**
 * Every tool page, server by server in data order, tools in the "By tool" table's order.
 * @param {any[]} servers ServerResult entries
 * @param {(x: any) => Map<string, unknown>} redactionsOf redactionsFor
 */
export function toolPages(servers, redactionsOf) {
  const out = [];
  for (const x of Array.isArray(servers) ? servers : []) {
    if (!x || typeof x.id !== "string" || !Array.isArray(x.checks)) continue;
    const tv = toolVerdicts(x, redactionsOf(x));
    if (!tv) continue;
    for (const r of tv.rows) {
      if (r.called.length === 0) continue;
      out.push({ id: x.id, tool: r.tool, slug: toolSlug(r.tool), called: r.called, notCalled: r.notCalled });
    }
  }
  return out;
}

const WORD = { pass: "passed", fail: "failed", part: "partial", inconclusive: "inconclusive", na: "not applicable" };
const list = (items) => (items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/**
 * The answer-style summary at the top of a tool page.
 * @param {{ tool: string, server: string, version: string, testedAt: string, called: { id: string, verdict: string, advisory: boolean }[], grade: { letter: string, provisional: boolean } | null }} a
 */
export function toolSummary(a) {
  const checks = a.called.map((c) => `${c.id} (${WORD[c.verdict] ?? c.verdict}${c.advisory ? ", advisory" : ""})`);
  const n = a.called.length;
  const out = [
    `${a.tool} is a tool of ${a.server} ${a.version}.`,
    `In Sealmark's automated test on ${a.testedAt}, ${n === 1 ? "one public check" : `${n} public checks`} called it with a valid call: ${list(checks)}.`,
    `A check's verdict is for the whole check, not for this tool alone, so Sealmark gives no grade to a single tool.`,
  ];
  out.push(a.grade ? `The server's overall grade is ${a.grade.letter}${a.grade.provisional ? " (provisional)" : ""}.` : "The server has no overall grade.");
  return out.join(" ");
}

/**
 * The evidence lines the fleet recorded against this tool, per check that called it, in the called order.
 * @param {Map<string, { total: number, lines: { tool: string | null }[] }> | null} evidence checkEvidenceFor(x, false)
 * @param {{ id: string }[]} called
 * @param {string} tool
 */
export function toolEvidence(evidence, called, tool) {
  if (!evidence) return [];
  return called.flatMap((c) => {
    const ev = evidence.get(c.id);
    const lines = ev ? ev.lines.filter((l) => l.tool === tool) : [];
    return lines.length ? [{ check: c.id, lines }] : [];
  });
}

/**
 * What api-check rule 12 checks: the tool pages built under out/results/<id>/tools/ are exactly the expected ones,
 * and none belongs to a server with a held or any security finding.
 * @param {string[]} built "<id>/<slug>" for every out/results/tools/<id>/<slug>/index.html
 * @param {{ id: string, slug: string }[]} expected toolPages() from the raw data
 * @param {(id: string) => "held" | "unknown" | null} status
 * @returns {string[]}
 */
export function toolPagesProblems(built, expected, status) {
  const out = [];
  const want = new Set(expected.map((p) => `${p.id}/${p.slug}`));
  if (want.size !== expected.length) out.push("two tools of one server share a page path");
  const have = new Set(built);
  for (const k of built) {
    const id = k.split("/")[0];
    if (!want.has(k)) out.push(`${k}: built but not a tool a public check called`);
    const st = status(id);
    if (st === "held") out.push(`${k}: a tool page for a server with a security finding`);
    else if (st === "unknown") out.push(`${k}: server not in the raw results data`);
  }
  for (const k of want) if (!have.has(k)) out.push(`${k}: no page built`);
  return out;
}
