import { apiServers, jsonResponse } from "@/lib/api-data";

export const dynamic = "force-static";
// Every graded server (docs: /docs/guides/results-data).
export function GET() { return jsonResponse(apiServers()); }
