import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SERVER_COUNT } from "@/lib/results";
import { INSTALL, WHAT_IT_IS, canonical, jsonLd } from "@/lib/seo";
import s from "../results/results.module.css";

const TITLE = "MCP conformance testing: what it is and how to run it";
const DESC = "What MCP conformance testing checks, how it differs from protocol validation, and how to test an MCP server with one command using Sealmark.";
export const metadata: Metadata = { title: `${TITLE} | Sealmark`, description: DESC, alternates: { canonical: "/mcp-conformance-testing/" } };

const FAQ = [
  ["What is MCP conformance testing?", "Running a Model Context Protocol server and checking that it behaves correctly, both at the protocol level (initialize, tool listing, valid results) and in what its tools actually do (for example, that a read-only tool does not write)."],
  ["How do I test an MCP server?", `Run ${INSTALL} from a terminal with Node.js. Sealmark starts your server, probes it, and prints a letter grade per test suite with the evidence.`],
  ["Does Sealmark use an AI model to judge the server?", "No. The probes and the checks are fixed code. The same server and settings give the same grade."],
  ["Is Sealmark free?", "Yes. It is open source under Apache-2.0 and there is no paid tier."],
];

export default function Page() {
  const ld = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) };
  return (
    <>
      <Nav />
      <main id="main" className={`gutter ${s.wrap}`}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
        <h1 className={s.h1}>MCP conformance testing</h1>
        <p className={s.lede}>{WHAT_IT_IS}</p>
        <h2 className={s.packhead}>Run it in one command</h2>
        <pre><code>{INSTALL}</code></pre>
        <p className={s.muted}>Needs Node.js. Other ways to run it (a URL, a config file, CI) are in the <Link href="/docs/quickstart/">quickstart</Link>.</p>
        <h2 className={s.packhead}>What it checks</h2>
        <p>Protocol hygiene (the <b>core</b> suite) for every server, then suites for what the tools do when the server has them: database, files, git, network, HTTP, commands and side effects. Each check is listed with its evidence in the <Link href="/docs/reference/checks/">check reference</Link>; the rules for grading are in the <Link href="/docs/methodology/">methodology</Link>.</p>
        <h2 className={s.packhead}>What the grades mean, and do not</h2>
        <p>A grade is for one version with one configuration. An A means these checks passed; it is not a security audit or an endorsement. A server that is only graded on protocol hygiene says little about its tools, and the result page says so.</p>
        <h2 className={s.packhead}>See real results</h2>
        <p>{SERVER_COUNT} public MCP servers have a results page with every check and its evidence: <Link href="/results/">browse the graded servers</Link>. To compare Sealmark with the official Inspector and conformance suite, read <Link href="/compare/">Sealmark compared with other MCP testing tools</Link>.</p>
        <h2 className={s.packhead}>Questions</h2>
        {FAQ.map(([q, a]) => (<div key={q}><h3>{q}</h3><p>{a}</p></div>))}
        <p className={s.muted}>Canonical page: {canonical("/mcp-conformance-testing/")}</p>
      </main>
      <Footer />
    </>
  );
}
