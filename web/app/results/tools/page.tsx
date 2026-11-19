import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Seal } from "@/components/Seal";
import { RESULTS_PUBLIC, SERVERS_RESULTS, worst } from "@/lib/results";
import { toolDirectoryData } from "@/lib/tool-directory-data";
import { toolPagePath } from "@/lib/tool-pages-data";
import { DisputeNote } from "../DisputeNote";
import s from "../results.module.css";

export const metadata: Metadata = {
  title: "MCP server tools Sealmark called with valid input | Sealmark",
  description: "The tools of graded public MCP servers that a Sealmark check called with valid input, grouped by server, each linking to the server's results page.",
  alternates: { canonical: "/results/tools/" },
};

// Tools directory (site#97): the tools a public check called with a valid call, from lib/tool-directory.mjs, which
// applies the "By tool" table's hold rule. Tool and server names are someone else's text, so they carry
// data-third-party for scripts/home-check.mjs.
export default function ToolsPage() {
  if (!RESULTS_PUBLIC) notFound();
  const { rows, tools } = toolDirectoryData();
  const byId = new Map(SERVERS_RESULTS.map((x) => [x.id, x]));
  const newest = rows.map((r) => r.testedAt).filter(Boolean).sort().at(-1);
  return (
    <>
      <Nav />
      <main id="main" className={`gutter ${s.wrap}`}>
        <p className={s.crumb}><Link href="/results/">Results</Link> / Tools</p>
        <h1 className={s.h1}>Tools Sealmark called with valid input</h1>
        <p className={s.meta}><span>{tools} tools on {rows.length} servers</span>{newest && <span>latest test {newest}</span>}</p>
        <p className={s.lede}>
          The tools of graded public servers that at least one public check called with valid input in the server&rsquo;s latest run, grouped by server. A declared tool that no public check reached with a valid call is counted, not listed; it may still have been sent malformed input. Each server&rsquo;s page shows which checks called each tool and their verdicts; a verdict is for the whole check, so nothing here grades a single tool.
        </p>
        <p className={`${s.muted} ${s.dirNote}`}>
          A server appears once a re-test has kept its tool names and a public check reached at least one of its tools with a valid call. Servers with a security finding are left out, so this page never points at the tool behind one.
        </p>
        {rows.length === 0 ? (
          <p className={s.muted} style={{ marginTop: 28 }}>No re-tested server has a tool a public check reached with a valid call.</p>
        ) : (
          <div className={`${s.tw} ${s.twCards}`} tabIndex={0} role="region" aria-label="Tools called with valid input, by server">
            <table className={s.toolDir}>
              <caption className="sr-only">Tools a public check called with valid input, by server, servers in name order</caption>
              <thead><tr><th scope="col">Server</th><th scope="col">Grade</th><th scope="col">Tools called</th><th scope="col">Valid calls</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const x = byId.get(r.id);
                  const g = x ? worst(x) : null;
                  return (
                    <tr key={r.id}>
                      <td className={s.srv} data-third-party=""><Link href={`/results/${r.id}/`}>{r.name}</Link></td>
                      <td>{g ? <Seal g={g.letter} prov={g.provisional} /> : <span className={s.muted}>No grade</span>}</td>
                      <td data-label="Tools called">
                        <ul className={s.toolNames} data-third-party="">
                          {r.tools.map((t) => { const href = toolPagePath(r.id, t); return <li key={t}>{href ? <Link href={href}><code>{t}</code></Link> : <code>{t}</code>}</li>; })}
                        </ul>
                        {r.missing && <small className={s.muted}>Some called tools are not named here: a check&rsquo;s list was capped or a name had characters this page does not print.</small>}
                      </td>
                      <td className={s.num} data-label="Valid calls">{r.tools.length} of {r.declared} declared</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <DisputeNote />
      </main>
      <Footer />
    </>
  );
}
