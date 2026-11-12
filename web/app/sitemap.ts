import type { MetadataRoute } from "next";
import { listDocs } from "@/app/docs/content";
import { SERVERS_RESULTS } from "@/lib/results";
import { canonical } from "@/lib/seo";

export const dynamic = "force-static";
export default function sitemap(): MetadataRoute.Sitemap {
  const latest = SERVERS_RESULTS.map((x) => x.testedAt).sort().at(-1);
  const fixed = ["/", "/results/", "/results/history/", "/mcp-conformance-testing/", "/compare/", "/disclosure/", "/privacy/", "/docs/reference/cli/", "/docs/reference/checks/", "/docs/reference/configuration/"];
  return [
    ...fixed.map((p) => ({ url: canonical(p), ...(p.startsWith("/results") && latest ? { lastModified: latest } : {}) })),
    ...listDocs().filter((d) => d.slug.length).map((d) => ({ url: canonical(`/docs/${d.slug.join("/")}/`) })),
    ...SERVERS_RESULTS.map((x) => ({ url: canonical(`/results/${x.id}/`), lastModified: x.testedAt })),
  ];
}
