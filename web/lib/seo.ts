// One place for everything search engines and AI assistants read: canonical URLs, JSON-LD, badge text, llms.txt text.
// Every sentence here is a claim about the product: keep it true and keep it plain (checked against the CLI source).
import { SITE } from "./site";
import { SERVERS_RESULTS, SERVER_COUNT, gradedPacks, worst, redactionsFor, PACK_LABEL, type ServerResult, type Letter } from "./results";
import { DATA } from "./results";
import { badgeEligible } from "@/worker/notify-core.mjs";
import pkg from "../package.json";
import { allTopicPages } from "./topics-data";
import { toolDirectoryData } from "./tool-directory-data";

export const ORIGIN = `https://${SITE.host}`;
export const canonical = (path: string) => `${ORIGIN}${path.endsWith("/") ? path : `${path}/`}`;
// The CLI release the site documents: the version pinned in package.json (release-sync bumps it), never typed here.
export const CLI_VERSION: string = pkg.devDependencies.sealmark;

export const WHAT_IT_IS =
  "Sealmark is an open-source command-line tool that checks how an MCP server behaves. It starts the server, calls its tools with fixed inputs (no language model in the loop), checks what actually happened, and prints a letter grade per test suite with the evidence behind it.";
export const INSTALL = "npx sealmark run --start \"<command that starts your server>\"";

export const softwareJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Sealmark",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Linux, macOS, Windows (Node.js)",
  description: WHAT_IT_IS,
  url: ORIGIN,
  softwareVersion: CLI_VERSION,
  license: "https://github.com/jordanallenlewis/sealmark/blob/main/LICENSE",
  codeRepository: "https://github.com/jordanallenlewis/sealmark",
  downloadUrl: "https://www.npmjs.com/package/sealmark",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  author: { "@type": "Person", name: "Jordan Allen Lewis", url: "https://jordanallenlewis.com" },
};

export const jsonLd = (o: object) => JSON.stringify(o).replace(/</g, "\\u003c");

// The badge names each test area the way the results page does ("protocol A · network D", not the CLI's "core A").
// A grade that includes a finding under private disclosure still counts; the tooltip says so.
export const PRIVATE_FINDING = "includes a finding under private disclosure";
export const serverBadge = (x: ServerResult): { label: string; message: string; letter: Letter; note: string | null } | null => {
  if (!badgeEligible(x)) return null;
  const g = gradedPacks(x);
  const w = worst(x);
  const message = g.map((p) => `${(PACK_LABEL[p.id] ?? p.id).toLowerCase()} ${p.letter}`).join(" · ");
  return { label: "sealmark", message, letter: (w?.letter ?? "F") as Letter, note: redactionsFor(x).size ? PRIVATE_FINDING : null };
};

// The files themselves are drawn by lib/badge.mjs (flat badge, card, shields endpoint), tested in lib/badge.test.mjs.
export const badgeServers = () => SERVERS_RESULTS.flatMap((x) => { const b = serverBadge(x); return b ? [{ x, b }] : []; });

export const serverDescription = (x: ServerResult) => {
  const g = gradedPacks(x).map((p) => `${PACK_LABEL[p.id] ?? p.id} ${p.letter}`).join(", ");
  return `Sealmark conformance results for ${x.name} ${x.versionTested}: ${g || "no suite graded"}. Automated test on ${x.testedAt} with Sealmark ${x.sealmark.version}; every check shows its evidence.`;
};

const DOCS = ["/docs/", "/docs/quickstart/", "/docs/methodology/", "/docs/guides/ci/", "/docs/guides/badge/", "/docs/reference/cli/", "/docs/reference/checks/", "/docs/safety/", "/docs/changelog/"];
export const llmsTxt = () => `# Sealmark

> ${WHAT_IT_IS} Free and open source (Apache-2.0), runs with Node.js. Current version ${CLI_VERSION}, methodology ${DATA.methodology}.

Install and first run: \`${INSTALL}\`

## Docs
${DOCS.map((p) => `- ${canonical(p)}`).join("\n")}

## Results
- [Graded MCP servers (${SERVER_COUNT} so far)](${canonical("/results/")}): one page per server with every check and its evidence. Grades are automated re-tests of one version with the default settings, not endorsements.
- [Grade history](${canonical("/results/history/")})
- [Grade changes feed (Atom)](${canonical("/results/feed.xml")}): the newest moves of a server's overall grade that came with a different server version under the same Sealmark version; servers with a security finding are left out; one feed per server at /results/<id>/feed.xml.
${allTopicPages().length ? `- [Best graded servers by topic](${canonical("/results/topics/")}): ${allTopicPages().map((t) => t.title).join(", ")}; each server is placed by a stated rule and ranked by grade.\n` : ""}${toolDirectoryData().rows.length ? `- [Tools Sealmark called with valid input](${canonical("/results/tools/")}): the tools of graded servers that a public check called with valid input, by server; servers with a security finding are left out.\n` : ""}- [Results as JSON](${ORIGIN}/data/v1/servers.json): every graded server; one server at ${ORIGIN}/data/v1/servers/<id>.json, grade changes at ${ORIGIN}/data/v1/changes.json, OpenAPI 3.1 at ${ORIGIN}/data/v1/openapi.json. No key. Fields: ${canonical("/docs/guides/results-data")}

## Guides
- [What is MCP conformance testing?](${canonical("/mcp-conformance-testing/")})
- [Sealmark compared with other MCP testing tools](${canonical("/compare/")})

## Source
- https://github.com/jordanallenlewis/sealmark
- https://www.npmjs.com/package/sealmark
`;
