// Site-wide search (site#57 slice 2): one entry per graded server for /results-index.json, which the docs search bar
// loads next to /docs-index.json, so one search finds docs pages, servers (by name or id) and the tools they declare.
// Pure functions, no I/O: covered by lib/search-index.test.mjs; scripts/api-check.mjs (rule 7) checks the built file.
//
// An entry has the docs index shape (url, title, group, section, headings, text) plus the grade label the server's page
// heads. It carries no check, summary or start command. Tool names come from lib/tool-verdicts.mjs, the same rule as
// the "By tool" table on the page: none for a server with a held or unknown security finding, plain names only.
import { toolVerdicts } from "./tool-verdicts.mjs";

export const SERVER_GROUP = "Graded server";
const MAX_TEXT = 400;

/**
 * @param {any} x a ServerResult
 * @param {{ grade: string, source: string }} label grade as the page heads it ("Grade B", "No grade", ...) and the source label
 * @param {Map<string, unknown>} redactions redactionsFor(x)
 */
export function serverEntry(x, label, redactions) {
  const tv = toolVerdicts(x, redactions);
  const tools = tv ? tv.rows.map((r) => r.tool) : [];
  const count = Number(x.toolCount) || 0;
  let text = `${label.grade} · ${label.source} · ${count} ${count === 1 ? "tool" : "tools"}`;
  if (tools.length) {
    let list = "";
    let cut = false;
    for (const t of tools) {
      const next = list ? `${list}, ${t}` : t;
      if (`${text}: ${next}`.length > MAX_TEXT - 3) {
        cut = true;
        break;
      }
      list = next;
    }
    // Cut here for length, or names the page cannot show either (capped or not plain): the list must not read as complete.
    text += `: ${list}${cut || tv.missing ? ", …" : ""}`;
  }
  return {
    url: `/results/${x.id}/`,
    title: x.name || x.id,
    group: SERVER_GROUP,
    section: "",
    headings: [x.id, ...tools],
    text,
    grade: label.grade,
  };
}

/**
 * @param {any[]} servers
 * @param {(x: any) => { grade: string, source: string }} labelOf
 * @param {(x: any) => Map<string, unknown>} redactionsOf
 */
export const serverEntries = (servers, labelOf, redactionsOf) => servers.map((x) => serverEntry(x, labelOf(x), redactionsOf(x)));
