// Tools directory (site#97, slice 2 of site#56): the tools a public check called with a valid call, grouped by server,
// for /results/tools/. Pure functions, no I/O: covered by lib/tool-directory.test.mjs; scripts/api-check.mjs (rule 8,
// through toolsPageProblems) checks the built page.
//
// Built on lib/tool-verdicts.mjs, so the hold rule is the "By tool" table's: no server with a held check or any
// security finding (a list of called tools could point at the tool behind a finding), plain names only. A tool is
// listed only when a public check reached it with a valid call (the CLI's tools.probed). A declared tool no check
// reached that way is counted, never listed: it may still have been sent malformed input (tools.notCovered), so the page
// never says it was not called. Nothing here grades a tool: a check's verdict is for the whole check.
import { isSecurityCheck } from "./disclosure.mjs";
import { plain, toolVerdicts } from "./tool-verdicts.mjs";

/**
 * @param {any[]} servers ServerResult entries
 * @param {(x: any) => Map<string, unknown>} redactionsOf redactionsFor
 * @returns {{ rows: { id: string, name: string, testedAt: string, tools: string[], declared: number, missing: boolean }[], tools: number }}
 */
export function toolDirectory(servers, redactionsOf) {
  const rows = [];
  for (const x of Array.isArray(servers) ? servers : []) {
    if (!x || typeof x.id !== "string" || !Array.isArray(x.checks)) continue;
    const tv = toolVerdicts(x, redactionsOf(x));
    if (!tv) continue;
    const tools = tv.rows.filter((r) => r.called.length > 0).map((r) => r.tool);
    if (tools.length === 0) continue;
    // A called name can be missing two ways: a check's list was capped, or a name it reached was not plain. A dropped
    // declared name that no check reached does not make the called list incomplete.
    const probing = x.checks.filter((c) => c && !isSecurityCheck(c) && c.tools && Array.isArray(c.tools.probed));
    const missing = probing.some((c) => Number(c.tools.cut) > 0 || c.tools.probed.some((n) => !plain(n)));
    const declared = Math.max(Number(x.toolCount) || 0, tv.rows.length);
    rows.push({ id: x.id, name: typeof x.name === "string" && x.name !== "" ? x.name : x.id, testedAt: typeof x.testedAt === "string" ? x.testedAt : "", tools, declared, missing });
  }
  const key = (r) => r.name.toLowerCase();
  rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { rows, tools: rows.reduce((n, r) => n + r.tools.length, 0) };
}

/**
 * What api-check rule 8 checks on the built page: its table links only to listed servers, never to a held one, each
 * server once, one row per link. A held server's allowed shape on this page is absence.
 * @param {string} html out/results/tools/index.html
 * @param {Set<string>} listed ids with a results page
 * @param {(id: string) => "held" | "unknown" | null} status from the raw data: "held" for a private or any security finding
 * @returns {string[]} problems, empty when the page is fine
 */
export function toolsPageProblems(html, listed, status) {
  const out = [];
  const table = String(html).match(/<table[\s\S]*?<\/table>/)?.[0];
  // No table (the empty state): then no server may be linked anywhere on the page, so a changed markup fails closed.
  if (!table) return /href="\/results\/[^"/]+\/"/.test(String(html)) ? ["server links but no table on the tools page"] : [];
  const linked = [...table.matchAll(/href="\/results\/([^"/]+)\/"/g)].map((m) => decodeURIComponent(m[1]));
  const rows = (table.match(/<tr[\s>]/g) ?? []).length - 1;
  if (rows !== linked.length) out.push(`${rows} rows but ${linked.length} server links`);
  if (new Set(linked).size !== linked.length) out.push("a server is listed twice");
  for (const id of linked) {
    if (!listed.has(id)) out.push(`${id}: linked but has no listed page`);
    const st = status(id);
    if (st === "held") out.push(`${id}: a server with a security finding is listed`);
    else if (st === "unknown") out.push(`${id}: not in the raw results data`);
  }
  return out;
}
