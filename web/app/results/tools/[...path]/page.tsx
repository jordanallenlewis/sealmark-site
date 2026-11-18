import { Fragment } from "react";
import { clsx } from "clsx";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { SERVERS_RESULTS, type Verdict } from "@/lib/results";
import registry from "@/content/generated/checks.json";
import { gradeOf } from "@/lib/api-data";
import { canonical, jsonLd } from "@/lib/seo";
import { checkEvidenceFor } from "@/lib/check-evidence-data";
import { allToolPages } from "@/lib/tool-pages-data";
import { toolEvidence, toolSummary } from "@/lib/tool-pages.mjs";
import { DisputeNote } from "../../DisputeNote";
import s from "../../results.module.css";

// One page per tool a public check called with a valid call (site#64; lib/tool-pages.mjs holds the rule). Tool and
// server names are someone else's text, so they carry data-third-party for scripts/home-check.mjs.
export const dynamicParams = false;
// /results/tools/<server id>/<tool slug>/. With no tool page at all (no published results), one placeholder that the page
// answers with notFound(): a static export needs at least one path.
export function generateStaticParams() {
  const all = allToolPages();
  return all.length ? all.map((p) => ({ path: [p.id, p.slug] })) : [{ path: ["pending", "pending"] }];
}

type P = { params: Promise<{ path: string[] }> };
const find = async (params: P["params"]) => {
  const { path } = await params;
  if (path.length !== 2) return null;
  const [id, tool] = path;
  const page = allToolPages().find((p) => p.id === id && p.slug === tool);
  const x = page && SERVERS_RESULTS.find((v) => v.id === id);
  return page && x ? { page, x } : null;
};

const summaryOf = (page: { tool: string; called: { id: string; verdict: string; advisory: boolean }[] }, x: (typeof SERVERS_RESULTS)[number]) =>
  toolSummary({ tool: page.tool, server: x.name, version: x.versionTested, testedAt: x.testedAt, called: page.called, grade: gradeOf(x) });

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const f = await find(params);
  if (!f) return { title: "Results" };
  const path = `/results/tools/${f.x.id}/${f.page.slug}/`;
  return { title: `${f.page.tool} (${f.x.name} ${f.x.versionTested}): checks that called this MCP tool | Sealmark`, description: summaryOf(f.page, f.x), alternates: { canonical: path } };
}

const WORD: Record<Verdict, string> = { pass: "pass", part: "partial", fail: "fail", inconclusive: "inconclusive", na: "n/a" };
const DOCUMENTED = new Set((registry as { id: string }[]).map((c) => c.id));
const LABEL = new Map((registry as { id: string; title?: string }[]).map((c) => [c.id, c.title]));
const checkLink = (id: string) => (DOCUMENTED.has(id) ? <Link href={`/docs/reference/checks/${id}/`}>{id}</Link> : <>{id}</>);

export default async function ToolPage({ params }: P) {
  const f = await find(params);
  if (!f) notFound();
  const { page, x } = f;
  const summary = summaryOf(page, x);
  const evidence = toolEvidence(checkEvidenceFor(x, false), page.called, page.tool);
  const labels = new Map(x.checks.map((c) => [c.id, c.label]));
  const siblings = allToolPages().filter((p) => p.id === x.id && p.slug !== page.slug);
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Results", item: canonical("/results/") },
      { "@type": "ListItem", position: 2, name: x.name, item: canonical(`/results/${x.id}/`) },
      { "@type": "ListItem", position: 3, name: page.tool, item: canonical(`/results/tools/${x.id}/${page.slug}/`) },
    ],
  };
  return (
    <>
      <Nav />
      <main id="main" className={`gutter ${s.wrap}`}>
        <p className={s.crumb}><Link href="/results/">Results</Link> / <Link href={`/results/${x.id}/`} data-third-party="">{x.name}</Link> / tool</p>
        {/* A tool name is one long word: let it use the full width, and break only after a separator (<wbr>, no text). */}
        <h1 className={s.h1} style={{ maxWidth: "none" }} data-third-party="">{page.tool.split(/(?<=[_.:/-])/).map((part, i) => <Fragment key={i}>{i > 0 && <wbr />}{part}</Fragment>)}</h1>
        <div className={s.meta}>
          <span data-third-party="">tool of {x.name} {x.versionTested}</span>
          <span>tested {x.testedAt}</span>
          <span>Sealmark {x.sealmark.version}</span>
        </div>
        {/* data-third-party: the summary names the tool and the server, someone else's text (scripts/home-check.mjs) */}
        <p className={s.answer} data-answer="" data-third-party="">{summary}</p>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(crumbs) }} />

        <section className={s.sec} aria-labelledby="called-h">
          <h2 id="called-h">Checks that called it</h2>
          <p>Each of these public checks reached this tool with a valid call in the run on {x.testedAt}. The verdict is the check&apos;s, for everything it tested, not for this tool alone.</p>
          <div className={clsx(s.tw, s.twChecks)} tabIndex={0} role="region" aria-label="Table of the checks that called this tool">
            <table className={clsx(s.checks, s.evidence)}>
              <caption className="sr-only">Checks that called this tool with a valid call, with each check&apos;s verdict</caption>
              <colgroup><col className={s.colCheck} /><col className={s.colVerdict} /><col /></colgroup>
              <thead><tr><th scope="col">Check</th><th scope="col">Verdict</th><th scope="col">What it tests</th></tr></thead>
              <tbody>
                {page.called.map((c) => (
                  <tr key={c.id}>
                    <td className={s.id}>{checkLink(c.id)}{c.advisory && <span className={s.muted}> (advisory)</span>}</td>
                    <td data-label="Verdict"><span className={clsx("chip", `c-${c.verdict}`, c.advisory && "adv")}>{WORD[c.verdict as Verdict] ?? c.verdict}</span></td>
                    <td className={s.sum} data-label="What it tests">{labels.get(c.id) ?? LABEL.get(c.id) ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {page.notCalled.length > 0 && (
            <p>
              Not exercised by: {page.notCalled.map((c, i) => <span key={c.id}>{i > 0 && ", "}{checkLink(c.id)}</span>)}. A check can leave a tool out for a limit Sealmark sets, by design, for input the run could not fill in, or because a call returned an error; the CLI report gives the reason.
            </p>
          )}
        </section>

        <section className={s.sec} aria-labelledby="ev-h">
          <h2 id="ev-h">What was sent and observed</h2>
          {evidence.length === 0 ? (
            <p>No evidence line shown on this site names this tool. Run <code>sealmark run --format json</code> yourself for every line in full; the <Link href={`/results/${x.id}/`}>server&apos;s page</Link> has the run command.</p>
          ) : (
            <>
              <p>The evidence lines kept from the run that name this tool, by check (a limited number per check). The text is shortened, and paths and anything that looks like a secret or token are replaced. <code>sealmark run --format json</code> gives every line in full.</p>
              {evidence.map((e) => (
                <div key={e.check}>
                  <h3 className={s.packhead}>{checkLink(e.check)}</h3>
                  <ol className={s.evList}>
                    {e.lines.map((l, i) => (
                      <li key={i}>
                        {l.probe && <div><span className={s.evLabel}>Probe</span> <span data-third-party="">{l.probe}</span></div>}
                        {l.outcome && <div><span className={s.evLabel}>Outcome</span> <span data-third-party="">{l.outcome}</span></div>}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </>
          )}
        </section>

        {siblings.length > 0 && (
          <section className={s.sec} aria-labelledby="more-h">
            <h2 id="more-h">Other tools of this server</h2>
            <ul className={s.list} data-third-party="">
              {siblings.map((p) => <li key={p.slug}><Link href={`/results/tools/${x.id}/${p.slug}/`}><code>{p.tool}</code></Link></li>)}
            </ul>
          </section>
        )}

        <p style={{ marginTop: 28 }}><Link href={`/results/${x.id}/`}>All results for <span data-third-party="">{x.name}</span></Link> · <Link href="/results/tools/">All tools Sealmark called</Link></p>
        <DisputeNote />
      </main>
      <Footer />
    </>
  );
}
