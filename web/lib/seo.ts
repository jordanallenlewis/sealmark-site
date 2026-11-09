// One place for everything search engines and AI assistants read: canonical URLs, JSON-LD, badge text, llms.txt text.
// Every sentence here is a claim about the product: keep it true and keep it plain (checked against the CLI source).
import { SITE } from "./site";
import { SERVERS_RESULTS, SERVER_COUNT, gradedPacks, worst, RANK, PACK_LABEL, type ServerResult, type Letter } from "./results";
import { DATA } from "./results";

export const ORIGIN = `https://${SITE.host}`;
export const canonical = (path: string) => `${ORIGIN}${path.endsWith("/") ? path : `${path}/`}`;
export const CLI_VERSION = "1.0.0";

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

export const serverBadge = (x: ServerResult): { label: string; message: string; letter: Letter } | null => {
  if (x.standard !== true || x.badge?.eligible === false) return null;
  const g = gradedPacks(x);
  const deep = g.filter((p) => p.id !== "core");
  if (!deep.length || g.some((p) => p.provisional)) return null;
  const w = worst(x);
  return { label: "sealmark", message: g.map((p) => `${p.id} ${p.letter}`).join(" · "), letter: (w?.letter ?? "F") as Letter };
};

const COLOR: Record<Letter, string> = { A: "#2ea44f", B: "#4c9f38", C: "#c7a400", D: "#d9822b", F: "#d73a49" };
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
export const badgeSvg = (label: string, message: string, letter: Letter) => {
  const w = (t: string) => Math.round(t.length * 6.4 + 14);
  const lw = w(label), mw = w(message), tot = lw + mw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tot}" height="20" role="img" aria-label="${esc(label)}: ${esc(message)}"><title>${esc(label)}: ${esc(message)}</title><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${mw}" height="20" fill="${COLOR[letter]}"/><g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle"><text x="${lw / 2}" y="14">${esc(label)}</text><text x="${lw + mw / 2}" y="14">${esc(message)}</text></g></svg>`;
};

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

## Guides
- [What is MCP conformance testing?](${canonical("/mcp-conformance-testing/")})
- [Sealmark compared with other MCP testing tools](${canonical("/compare/")})

## Source
- https://github.com/jordanallenlewis/sealmark
- https://www.npmjs.com/package/sealmark
`;
