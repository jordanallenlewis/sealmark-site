import { SERVERS_RESULTS, gradedPacks, PACK_LABEL } from "@/lib/results";
import { llmsTxt, canonical } from "@/lib/seo";
import { allToolPages } from "@/lib/tool-pages-data";

export const dynamic = "force-static";
// llms.txt plus one line per graded server, so an assistant can answer "what grade did X get" from one file.
export function GET() {
  const rows = SERVERS_RESULTS.map((x) => {
    if (x.gradeWithdrawn) return `- ${x.name} (no current grade, last graded ${x.versionTested} on ${x.testedAt}): ${canonical(`/results/${x.id}/`)}`;
    const g = gradedPacks(x).map((p) => `${PACK_LABEL[p.id] ?? p.id} ${p.letter}`).join(", ") || "not graded";
    return `- ${x.name} ${x.versionTested} (${x.testedAt}, Sealmark ${x.sealmark.version}): ${g}. ${canonical(`/results/${x.id}/`)}`;
  });
  const names = new Map(SERVERS_RESULTS.map((x) => [x.id, x.name]));
  const tools = allToolPages().map((t) => `- ${t.tool} (${names.get(t.id)}): ${canonical(`/results/tools/${t.id}/${t.slug}/`)}`);
  const toolPart = tools.length ? `\n## Tools a public check called with valid input\nOne page per tool with a plain name: the checks that called it and their verdicts (a verdict is for the whole check, not one tool), and what was sent and observed. Servers with a security finding are left out.\n${tools.join("\n")}\n` : "";
  const body = `${llmsTxt()}\n## Every graded server\nAutomated tests of one version with the default settings; not endorsements.\n${rows.join("\n")}\n${toolPart}`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
