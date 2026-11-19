import { atomResponse, serverFeed } from "@/lib/feed-data";
import { SERVERS_RESULTS } from "@/lib/results";

export const dynamicParams = false;
export const dynamic = "force-static";
type P = { params: Promise<{ id: string }> };
// Atom feed of one server's grade changes (site#59), next to its results page.
export function generateStaticParams() { return SERVERS_RESULTS.length ? SERVERS_RESULTS.map((x) => ({ id: x.id })) : [{ id: "pending" }]; }
export async function GET(_: Request, { params }: P) {
  const { id } = await params;
  if (!SERVERS_RESULTS.some((v) => v.id === id)) return new Response("not found", { status: 404 });
  return atomResponse(serverFeed(id));
}
