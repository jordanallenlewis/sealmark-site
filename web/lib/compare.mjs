// The words and sources behind /compare/ (other graders) and /compare/glama/. Data only, no I/O: covered by
// lib/compare.test.mjs. Every claim about another tool links that tool's own page and carries the date it was read.
// Ideas only: describe what each tool checks in our words; never copy their text, data or design.

/** @typedef {{ name: string, url: string, what: string, checked: string }} Grader */
/** @typedef {{ aspect: string, sealmark: string, glama: string, sources: string[] }} GlamaRow */

/** Other tools that hand an MCP server a letter grade. @type {Grader[]} */
export const OTHER_GRADERS = [
  {
    name: "Glama",
    url: "https://glama.ai/mcp/methodology",
    what: "a registry that grades each listed server's tool descriptions (with a language model), its license and its maintenance, and watches its build in a sandbox for risky behavior.",
    checked: "2026-11-15",
  },
  {
    name: "YawLabs mcp-compliance",
    url: "https://github.com/YawLabs/mcp-compliance",
    what: "a CLI that runs 88 protocol tests across 8 categories and grades a server A to F on spec compliance.",
    checked: "2026-11-15",
  },
  {
    name: "Vinkius MCP Inspector",
    url: "https://mcp-inspector.vinkius.com/",
    what: "an online check of a server against the protocol specification: 34 checks in 7 categories and a grade from A+ to F.",
    checked: "2026-11-15",
  },
  {
    name: "MCP-Scorecard (aak204)",
    url: "https://github.com/aak204/MCP-Scorecard",
    what: "a deterministic CI scanner that scores the risk of what a server exposes.",
    checked: "2026-11-15",
  },
  {
    name: "mcp-scorecard (davidmosiah)",
    url: "https://github.com/davidmosiah/mcp-scorecard",
    what: "a local command that scores a server's quality and readiness for agents and lists fixes.",
    checked: "2026-11-15",
  },
];

const METHOD = "https://glama.ai/mcp/methodology";
const TDQS = "https://tdqs.dev/";

/** Sealmark and Glama side by side. Glama's column cites only Glama's own pages. */
export const GLAMA = {
  checked: "2026-11-15",
  rows: /** @type {GlamaRow[]} */ ([
    {
      aspect: "What the grade is about",
      sealmark: "What a server's tools did when called: database rows, files, outbound requests and processes.",
      glama: "How well each tool is described (its Tool Definition Quality Score), plus separate license and maintenance grades.",
      sources: [METHOD, TDQS, "https://glama.ai/mcp/servers"],
    },
    {
      aspect: "Calls the tools",
      sealmark: "Yes. Every check calls a tool with fixed, published inputs.",
      glama: "Its sandbox lists tools, resources and prompts and stores their schemas. The methodology does not describe calling tools with set inputs, and connector health checks say they do not call tools.",
      sources: [METHOD],
    },
    {
      aspect: "Watches the running server",
      sealmark: "Through targets the harness owns: its own database connection, file diffs, a listener for outbound requests, the process table.",
      glama: "At the syscall and network layers inside a microVM, for patterns such as reads of credential paths and unexpected outbound traffic.",
      sources: [METHOD],
    },
    {
      aspect: "Language model in the grade",
      sealmark: "None.",
      glama: "Yes, for descriptions: a model scores six dimensions from 1 to 5; code handles what the schema already states.",
      sources: [TDQS],
    },
    {
      aspect: "Can a maintainer rerun it",
      sealmark: "Yes. The same CLI version and config hash give the same verdicts on any machine.",
      glama: "The description rubric is published. The sandbox ruleset is deliberately not fully disclosed.",
      sources: [METHOD, TDQS],
    },
    {
      aspect: "What a finding shows",
      sealmark: "Each check: the call, what was observed, and why it passed or failed.",
      glama: "Sandbox findings are labelled Malicious or Risky; description scores come with a written reason.",
      sources: [METHOD, TDQS],
    },
  ]),
  /** Where Glama is the better pick. Keep this list honest. */
  stronger: [
    { text: "It lists far more servers, so it is the better place to discover what exists.", sources: ["https://glama.ai/mcp/servers"] },
    { text: "You can connect to a remote server and call its tools from the browser, with nothing to install.", sources: ["https://glama.ai/mcp/inspector"] },
    { text: "It tells authors how to improve tool descriptions so models pick the right tool.", sources: [TDQS] },
    { text: "It shows license and maintenance signals next to each listing.", sources: [METHOD] },
  ],
};

/** All the hand-written copy in this module, for the voice checks in the tests. */
export const compareText = () =>
  [
    ...OTHER_GRADERS.map((g) => `${g.name} ${g.what}`),
    ...GLAMA.rows.flatMap((r) => [r.aspect, r.sealmark, r.glama]),
    ...GLAMA.stronger.map((x) => x.text),
  ].join("\n");
