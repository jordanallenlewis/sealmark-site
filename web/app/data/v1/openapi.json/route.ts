import { apiOpenapi, jsonResponse } from "@/lib/api-data";

export const dynamic = "force-static";
// OpenAPI 3.1 description of /data/v1/ (docs: /docs/guides/results-data).
export function GET() { return jsonResponse(apiOpenapi()); }
