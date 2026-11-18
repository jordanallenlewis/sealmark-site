// Tool pages (site#64), built once per build from the published results with the page's own redactions.
import { toolPages, type ToolPage } from "@/lib/tool-pages.mjs";
import { SERVERS_RESULTS, redactionsFor } from "@/lib/results";

let pages: ToolPage[] | undefined;
export function allToolPages() {
  if (!pages) pages = toolPages(SERVERS_RESULTS, redactionsFor);
  return pages;
}
/** The page path of a tool, or null when it has no page. */
export function toolPagePath(id: string, tool: string) {
  const p = allToolPages().find((t) => t.id === id && t.tool === tool);
  return p ? `/results/tools/${id}/${p.slug}/` : null;
}
