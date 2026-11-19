// Tools directory data (site#97), built once per build from the published results with the page's own redactions.
import { toolDirectory, type ToolDirectoryRow } from "@/lib/tool-directory.mjs";
import { SERVERS_RESULTS, redactionsFor } from "@/lib/results";

let dir: { rows: ToolDirectoryRow[]; tools: number } | undefined;
export function toolDirectoryData() {
  if (!dir) dir = toolDirectory(SERVERS_RESULTS, redactionsFor);
  return dir;
}
