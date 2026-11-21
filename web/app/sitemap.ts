import type { MetadataRoute } from "next";
import { listDocs } from "@/app/docs/content";
import { SERVERS_RESULTS } from "@/lib/results";
import { canonical } from "@/lib/seo";
import { allTopicPages } from "@/lib/topics-data";
import { toolDirectoryData } from "@/lib/tool-directory-data";
import { allToolPages } from "@/lib/tool-pages-data";

export const dynamic = "force-static";
export default function sitemap(): MetadataRoute.Sitemap {
  const latest = SERVERS_RESULTS.map((x) => x.testedAt).sort().at(-1);
  const fixed = ["/", "/results/", "/results/history/", "/status/", "/report/", "/mcp-conformance-testing/", "/compare/", "/disclosure/", "/privacy/", "/docs/reference/cli/", "/docs/reference/checks/", "/docs/reference/configuration/"];
  return [
    ...fixed.map((p) => ({ url: canonical(p), ...((p.startsWith("/results") || p === "/status/") && latest ? { lastModified: latest } : {}) })),
    ...listDocs().filter((d) => d.slug.length).map((d) => ({ url: canonical(`/docs/${d.slug.join("/")}/`) })),
    ...SERVERS_RESULTS.map((x) => ({ url: canonical(`/results/${x.id}/`), lastModified: x.testedAt })),
    ...(SERVERS_RESULTS.length ? [{ url: canonical("/results/topics/"), ...(latest ? { lastModified: latest } : {}) }] : []),
    ...(toolDirectoryData().rows.length ? [{ url: canonical("/results/tools/"), lastModified: toolDirectoryData().rows.map((r) => r.testedAt).sort().at(-1) }] : []),
    ...allToolPages().map((t) => ({ url: canonical(`/results/tools/${t.id}/${t.slug}/`), lastModified: SERVERS_RESULTS.find((x) => x.id === t.id)?.testedAt })),
    ...allTopicPages().map((t) => ({ url: canonical(`/results/topics/${t.id}/`), lastModified: t.rows.map((r) => r.testedAt).sort().at(-1) })),
  ];
}
