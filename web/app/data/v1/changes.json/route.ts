import { apiChanges, jsonResponse } from "@/lib/api-data";

export const dynamic = "force-static";
// Grade changes between re-tests, newest first, from fleet/history.jsonl (docs: /docs/guides/results-data).
export function GET() { return jsonResponse(apiChanges()); }
