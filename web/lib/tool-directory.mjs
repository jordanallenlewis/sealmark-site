// Tools directory (site#97, slice 2 of site#56): the tools a public check called with a valid call, grouped by server,
// for /results/tools/. Pure functions, no I/O: covered by lib/tool-directory.test.mjs; scripts/api-check.mjs (rule 8)
// checks the built page.
//
// Built on lib/tool-verdicts.mjs, so the hold rule is the "By tool" table's: no server with a held check or any
// security finding (a list of called tools could point at the tool behind a finding), plain names only. A tool is
// listed only when a check called it with a valid call; declared tools no check exercised are counted, never listed as
// called. Nothing here grades a tool: a check's verdict is for the whole check.
import { toolVerdicts } from "./tool-verdicts.mjs";

/**
 * @param {any[]} servers ServerResult entries
 * @param {(x: any) => Map<string, unknown>} redactionsOf redactionsFor
 * @returns {{ rows: { id: string, name: string, tools: string[], declared: number, missing: boolean }[], tools: number }}
 */
export function toolDirectory(servers, redactionsOf) {
  const rows = [];
  for (const x of Array.isArray(servers) ? servers : []) {
    if (!x || typeof x.id !== "string" || !Array.isArray(x.checks)) continue;
    const tv = toolVerdicts(x, redactionsOf(x));
    if (!tv) continue;
    const tools = tv.rows.filter((r) => r.called.length > 0).map((r) => r.tool);
    if (tools.length === 0) continue;
    const declared = Math.max(Number(x.toolCount) || 0, tv.rows.length);
    rows.push({ id: x.id, name: typeof x.name === "string" && x.name !== "" ? x.name : x.id, tools, declared, missing: tv.missing });
  }
  const key = (r) => r.name.toLowerCase();
  rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { rows, tools: rows.reduce((n, r) => n + r.tools.length, 0) };
}
