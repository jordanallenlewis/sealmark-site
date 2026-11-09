import { SERVERS_RESULTS, gradedPacks, PACK_LABEL } from "@/lib/results";
import { llmsTxt, canonical } from "@/lib/seo";

export const dynamic = "force-static";
// llms.txt plus one line per graded server, so an assistant can answer "what grade did X get" from one file.
export function GET() {
  const rows = SERVERS_RESULTS.map((x) => {
    const g = gradedPacks(x).map((p) => `${PACK_LABEL[p.id] ?? p.id} ${p.letter}`).join(", ") || "not graded";
    return `- ${x.name} ${x.versionTested} (${x.testedAt}, Sealmark ${x.sealmark.version}): ${g}. ${canonical(`/results/${x.id}/`)}`;
  });
  const body = `${llmsTxt()}\n## Every graded server\nAutomated tests of one version with the default settings; not endorsements.\n${rows.join("\n")}\n`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
