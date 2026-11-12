import { badgeServers, badgeSvg } from "@/lib/seo";

export const dynamicParams = false;
export const dynamic = "force-static";
type P = { params: Promise<{ file: string }> };
// Static SVGs written at build time, one per server whose latest automated run is eligible for a badge (STANDARD run, a deeper suite graded, nothing provisional).
export function generateStaticParams() { const b = badgeServers(); return b.length ? b.map(({ x }) => ({ file: `${x.id}.svg` })) : [{ file: "none.svg" }]; }
export async function GET(_: Request, { params }: P) {
  const { file } = await params;
  const hit = badgeServers().find(({ x }) => `${x.id}.svg` === file);
  if (!hit) return new Response("not found", { status: 404 });
  return new Response(badgeSvg(hit.b.label, hit.b.message, hit.b.letter, hit.b.note), { headers: { "content-type": "image/svg+xml" } });
}
