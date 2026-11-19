import { serverEntries } from "@/lib/search-index.mjs";
import { SERVERS_RESULTS, deepPacks, ecosystemLabel, redactionsFor, worst, type ServerResult } from "@/lib/results";
import { coverageNote } from "@/lib/results-copy.mjs";
import { jsonResponse } from "@/lib/api-data";

export const dynamic = "force-static";

// The grade exactly as the server's page heads it (scripts/api-check.mjs rule 7 compares them).
function gradeLabel(x: ServerResult): string {
  if (coverageNote(x, deepPacks(x).length > 0).kind === "no-tools") return "No tools to test";
  const g = worst(x);
  return g ? `Grade ${g.letter}${g.provisional ? " (provisional)" : ""}` : "No grade";
}

// One search entry per graded server for the site search (components/docs/Search.tsx, lib/search-index.mjs).
export function GET() {
  return jsonResponse(serverEntries(SERVERS_RESULTS, (x) => ({ grade: gradeLabel(x), source: ecosystemLabel(x) }), redactionsFor));
}
