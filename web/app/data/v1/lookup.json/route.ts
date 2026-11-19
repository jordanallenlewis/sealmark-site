import { apiLookup, jsonResponse } from "@/lib/api-data";

export const dynamic = "force-static";
// Package name, repository or id to the graded servers it names (lib/lookup.mjs; docs: /docs/guides/results-data).
export function GET() { return jsonResponse(apiLookup()); }
