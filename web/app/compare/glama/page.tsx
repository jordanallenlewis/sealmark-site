import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import s from "../../results/results.module.css";
import { SERVER_COUNT } from "@/lib/results";
import { GLAMA } from "@/lib/compare.mjs";

const DESC = "Sealmark and Glama both give MCP servers letter grades, for different things: Glama grades how a server's tools are described, its license and its maintenance; Sealmark grades what the tools did when called. What each one checks, with sources.";
export const metadata: Metadata = { title: "Sealmark and Glama: behavior grade vs description grade", description: DESC, alternates: { canonical: "/compare/glama/" } };

const host = (u: string) => new URL(u).host + new URL(u).pathname.replace(/\/$/, "");
const Sources = ({ urls }: { urls: string[] }) => (
  <>{urls.map((u, i) => (<span key={u}>{i ? ", " : ""}<a href={u} rel="noopener">{host(u)}</a></span>))}</>
);

export default function Page() {
  const sources = [...new Set([...GLAMA.rows.flatMap((r) => r.sources), ...GLAMA.stronger.flatMap((x) => x.sources)])];
  return (
    <>
      <Nav />
      <main id="main" className={`gutter ${s.wrap}`}>
        <h1 className={s.h1}>Sealmark and Glama: two grades for different questions</h1>
        <p className={s.lede}>Glama asks &quot;are this server&apos;s tools well described, licensed and maintained?&quot; Sealmark asks &quot;what did the tools do when called?&quot; A server can describe a tool well and still write a row it was told to refuse, so an A from one and a C from the other is not a contradiction. Read both.</p>
        <div className={s.tw} tabIndex={0} role="region" aria-label="Sealmark and Glama compared">
          <table className={s.checks}>
            <thead><tr><th scope="col"><span className="sr-only">Aspect</span></th><th scope="col">Sealmark</th><th scope="col">Glama</th><th scope="col">Source</th></tr></thead>
            <tbody>{GLAMA.rows.map((r) => (<tr key={r.aspect}><th scope="row">{r.aspect}</th><td>{r.sealmark}</td><td>{r.glama}</td><td><Sources urls={r.sources} /></td></tr>))}</tbody>
          </table>
        </div>
        <p className={`${s.muted} ${s.scrollHint}`}>The table scrolls sideways to show both tools and the sources.</p>
        <h2 className={s.packhead}>Where Glama is the better pick</h2>
        <ul>{GLAMA.stronger.map((x) => (<li key={x.text}>{x.text} <span className={s.muted}>(<Sources urls={x.sources} />)</span></li>))}</ul>
        <h2 className={s.packhead}>Where Sealmark adds something</h2>
        <ul>
          <li>Every check calls a tool with a fixed input and decides from what changed: <Link href="/docs/methodology/">the methodology</Link> lists each probe.</li>
          <li>No language model in the grade, so anyone can rerun a verdict and get the same answer. Each results page shows the command.</li>
          <li>Public results for {SERVER_COUNT} servers, each with every check, its evidence and its grade history: <Link href="/results/">graded servers</Link>.</li>
          <li>A gate for CI: a grade threshold, SARIF and a GitHub Action, on your own code before you publish: <Link href="/docs/guides/ci/">CI guide</Link>.</li>
        </ul>
        <h2 className={s.packhead}>When to use which</h2>
        <ul>
          <li><b>You are choosing among many servers, or want models to pick your tools more often:</b> Glama.</li>
          <li><b>You need to know, with evidence anyone can reproduce, what your tools do with bad or hostile input:</b> Sealmark.</li>
          <li><b>You maintain a server:</b> both. They measure different things, and fixing one does not fix the other.</li>
        </ul>
        <p className={s.muted}>Glama&apos;s side is read from its own public pages on {GLAMA.checked}: <Sources urls={sources} />. Sealmark is not affiliated with Glama. Something out of date? Email us from the footer and we will fix it.</p>
        <p><Link href="/compare/">All comparisons</Link> · <Link href="/mcp-conformance-testing/">What is MCP conformance testing?</Link> · <Link href="/results/">Graded servers</Link></p>
      </main>
      <Footer />
    </>
  );
}
