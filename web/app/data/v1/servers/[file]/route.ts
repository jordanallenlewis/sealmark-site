import { apiServer, jsonResponse } from "@/lib/api-data";
import { SERVERS_RESULTS } from "@/lib/results";

export const dynamicParams = false;
export const dynamic = "force-static";
type P = { params: Promise<{ file: string }> };
// One file per graded server, <id>.json, with the same redactions as its results page (lib/api.mjs).
export function generateStaticParams() { return SERVERS_RESULTS.length ? SERVERS_RESULTS.map((x) => ({ file: `${x.id}.json` })) : [{ file: "none.json" }]; }
export async function GET(_: Request, { params }: P) {
  const { file } = await params;
  const x = SERVERS_RESULTS.find((v) => `${v.id}.json` === file);
  if (!x) return new Response("not found", { status: 404 });
  return jsonResponse(apiServer(x));
}
