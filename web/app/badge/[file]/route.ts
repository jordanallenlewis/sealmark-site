import { badgeServers } from "@/lib/seo";
import { badgeCardSvg, badgeFiles, badgeSvg, shieldsDoc } from "@/lib/badge.mjs";

export const dynamicParams = false;
export const dynamic = "force-static";
type P = { params: Promise<{ file: string }> };
// Static files written at build time for each server whose latest automated run is eligible for a badge (STANDARD run,
// a deeper suite graded, nothing provisional): <id>.svg (flat), <id>-card.svg (card), <id>.json (shields.io endpoint).
const files = () => { const b = badgeServers(); return { b, f: badgeFiles(b.map(({ x }) => x.id)) }; };
export function generateStaticParams() { const { f } = files(); return f.length ? f.map(({ file }) => ({ file })) : [{ file: "none.svg" }]; }
export async function GET(_: Request, { params }: P) {
  const { file } = await params;
  const { b, f } = files();
  const want = f.find((x) => x.file === file);
  const hit = want && b.find(({ x }) => x.id === want.id);
  if (!want || !hit) return new Response("not found", { status: 404 });
  const { x, b: g } = hit;
  if (want.kind === "json") return new Response(JSON.stringify(shieldsDoc(g.label, g.message, g.letter)), { headers: { "content-type": "application/json" } });
  const svg = want.kind === "card"
    ? badgeCardSvg({ name: x.name, version: x.versionTested, testedAt: x.testedAt, message: g.message, letter: g.letter, note: g.note })
    : badgeSvg(g.label, g.message, g.letter, g.note);
  return new Response(svg, { headers: { "content-type": "image/svg+xml" } });
}
