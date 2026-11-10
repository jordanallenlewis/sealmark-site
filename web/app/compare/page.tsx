import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import s from "../results/results.module.css";

const DESC = "An honest comparison of Sealmark with the MCP Inspector, the official MCP conformance framework, MCP security scanners (Snyk Agent Scan, Cisco mcp-scanner) and MCPJam: what each one checks, and when to use which.";
export const metadata: Metadata = { title: "Sealmark compared with other MCP testing tools", description: DESC, alternates: { canonical: "/compare/" } };

const CHECKED = "2026-11-10";
const ROWS: [string, string, string, string][] = [
  ["Made by", "Jordan Allen Lewis (independent)", "The MCP project (modelcontextprotocol)", "The MCP project (modelcontextprotocol)"],
  ["Main use", "Grade what a server does, in CI or by hand", "Explore and debug a server interactively; it also has a CLI mode", "Check a server (or client) against the protocol specification"],
  ["Output", "A letter grade per suite with evidence, SARIF, JSON, badge", "Live request and response views", "Pass or fail per scenario"],
  ["Checks tool behavior (writes, SQL, files, secrets)", "Yes, with fixed probes", "Not as automated checks", "No: it targets protocol conformance"],
  ["Model in the loop", "None", "None", "None"],
  ["Public results for other servers", "Yes: one page per graded server", "No", "No"],
];

export default function Page() {
  return (
    <>
      <Nav />
      <main id="main" className={`gutter ${s.wrap}`}>
        <h1 className={s.h1}>Sealmark compared with other MCP testing tools</h1>
        <p className={s.lede}>Short version: they answer different questions. The official conformance framework asks &quot;does this server follow the protocol?&quot; The Inspector asks &quot;what is this server doing right now?&quot; Sealmark asks &quot;does this server&apos;s tools behave safely and correctly, and what grade does that earn?&quot; Use them together.</p>
        <div className={s.tw} tabIndex={0} role="region" aria-label="Comparison table">
          <table className={s.checks}>
            <thead><tr><th scope="col"></th><th scope="col">Sealmark</th><th scope="col">MCP Inspector</th><th scope="col">MCP conformance framework</th></tr></thead>
            <tbody>{ROWS.map((r) => (<tr key={r[0]}><th scope="row">{r[0]}</th><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td></tr>))}</tbody>
          </table>
        </div>
        <h2 className={s.packhead}>Security scanners and eval platforms</h2>
        <p>These overlap with Sealmark on safety, but most decide from what a server says (its tool descriptions, its source, a model&apos;s reading of either). Sealmark decides from what a call did.</p>
        <ul>
          <li><b>Snyk Agent Scan</b> (formerly Invariant Labs&apos; mcp-scan): finds the agents, MCP servers and skills configured on a machine and flags prompt injection, tool poisoning and toxic flows. Analysis runs through Snyk&apos;s API and needs a Snyk account. Pick it to audit everything installed on a laptop at once; Sealmark tests one server at a time, locally, with no account.</li>
          <li><b>Cisco AI Defense mcp-scanner</b>: scans tools, prompts and resources with YARA rules, an LLM judge and Cisco&apos;s API, and can scan a server&apos;s source code and its Python dependencies for known vulnerabilities. Pick it for supply-chain and source checks, which Sealmark does not do.</li>
          <li><b>MCPJam</b>: an inspector and evaluation platform that runs your server with real models across many clients and scores agent behavior, with CI runs. Pick it to learn whether models use your tools well; Sealmark has no model in the loop, so the same server and settings always get the same grade.</li>
        </ul>
        <h2 className={s.packhead}>When to pick which</h2>
        <ul>
          <li><b>You are building a server and want to see requests:</b> the Inspector.</li>
          <li><b>You maintain an SDK or need to prove protocol compliance:</b> the official conformance framework.</li>
          <li><b>You want a gate in CI for what your tools actually do, a grade to show, or evidence for a review:</b> Sealmark.</li>
        </ul>
        <h2 className={s.packhead}>Where Sealmark is weaker</h2>
        <ul>
          <li>It does not replace the official protocol suite, and it is not run by the MCP project.</li>
          <li>Its grades are for one version and one configuration; a server it could not start has no grade.</li>
          <li>It is young: version 1.0.0, one maintainer.</li>
          <li>It does not look at source code, dependencies or known vulnerabilities, and it cannot see prompt injection carried in tool output (that needs a model to read the output).</li>
          <li>It has no interactive UI and no machine-wide scan of every installed server.</li>
        </ul>
        <p className={s.muted}>Sources, checked {CHECKED} from each project&apos;s public repository: <a href="https://github.com/modelcontextprotocol/inspector" rel="noopener">modelcontextprotocol/inspector</a>, <a href="https://github.com/modelcontextprotocol/conformance" rel="noopener">modelcontextprotocol/conformance</a>, <a href="https://github.com/snyk/agent-scan" rel="noopener">snyk/agent-scan</a>, <a href="https://github.com/cisco-ai-defense/mcp-scanner" rel="noopener">cisco-ai-defense/mcp-scanner</a>, <a href="https://github.com/MCPJam/inspector" rel="noopener">MCPJam/inspector</a>. Other tools exist; this page lists the most relevant. Something wrong? Email the maintainer from the footer and it gets fixed.</p>
        <p><Link href="/mcp-conformance-testing/">What is MCP conformance testing?</Link> · <Link href="/results/">Graded servers</Link></p>
      </main>
      <Footer />
    </>
  );
}
