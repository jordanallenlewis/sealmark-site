import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Nav } from "@/components/Nav";
import { Seal } from "@/components/Seal";
import { PACK_LABEL, SERVERS_RESULTS, VERDICTS_CHECKED, coverageWord, gradedPacks, launchLine, type Letter, type Verdict } from "@/lib/results";
import { DisputeNote } from "../DisputeNote";
import s from "../results.module.css";

export const dynamicParams = false;
// With no published results, export one placeholder route; the page answers it with notFound().
export function generateStaticParams() { return SERVERS_RESULTS.length ? SERVERS_RESULTS.map((x) => ({ id: x.id })) : [{ id: "pending" }]; }

type P = { params: Promise<{ id: string }> };
export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { id } = await params;
  const x = SERVERS_RESULTS.find((v) => v.id === id);
  return { title: x ? `${x.name} ${x.versionTested}: Sealmark results` : "Results" };
}

const sentence = (t: string) => t.replace(/(^|[.!?]\s+)([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
const WORD: Record<Verdict, string> = { pass: "pass", part: "partial", fail: "fail", inconclusive: "inconclusive", na: "n/a" };

export default async function ServerPage({ params }: P) {
  const { id } = await params;
  const x = SERVERS_RESULTS.find((v) => v.id === id);
  if (!x) notFound();
  const graded = gradedPacks(x);
  const packIds = [...new Set(x.checks.map((c) => c.pack))];
  const notGraded = x.packs.filter((p) => p.status !== "graded");
  const idx = SERVERS_RESULTS.findIndex((v) => v.id === x.id);
  const prev = SERVERS_RESULTS[idx - 1];
  const next = SERVERS_RESULTS[idx + 1];

  return (
    <>
      <Nav />
      <main className={`gutter ${s.wrap}`}>
        <div className={s.preview}>{x.automated ? `Automated re-test on ${x.testedAt}: not checked by hand, and not yet reviewed by the maintainers.` : "Maintainers have not reviewed this result yet."}</div>
        <p className={s.crumb}><Link href="/results/">Results</Link> / {x.name}</p>
        <h1 className={s.h1} style={{ maxWidth: "28ch" }}>{x.name}</h1>
        <div className={s.meta}>
          <span>version tested {x.versionTested}</span>
          <span>{x.ecosystem === "npm" ? "npm" : "PyPI"}</span>
          <span>tested {x.testedAt}</span>
          <span>Sealmark {x.sealmark.version}</span>
          <span>methodology {x.sealmark.methodology}</span>
          <span>{x.standard ? "STANDARD run" : "CUSTOM run"}</span>
          <span>{x.toolCount} tools</span>
        </div>

        <div className={s.gradeRow}>
          {graded.map((p) => (
            <div key={p.id} className={s.gradeBox}>
              <Seal g={p.letter as Letter} prov={p.provisional} lg />
              <div>
                <b>{PACK_LABEL[p.id] ?? p.id}</b>
                <small>{p.points}/{p.scored} points{p.capped ? " · capped at D" : ""}{p.provisional ? " · provisional" : ""}</small>
                {p.criticalFails.length > 0 && <small style={{ display: "block", color: "var(--fail)" }}>critical: {p.criticalFails.join(", ")}</small>}
              </div>
            </div>
          ))}
        </div>

        <p className={s.muted} style={{ marginTop: 14 }}>
          Coverage: {coverageWord(x)}
          {x.coverage ? ` (${x.coverage.toolsCalledValid} of ${x.coverage.toolsTotal} tools reached with a valid call)` : ""}.
          {x.coverage?.level !== "covered" && graded.every((p) => p.id === "core") ? " Only protocol hygiene was graded, so the A says little about what the tools do." : ""}
        </p>

        {packIds.map((pid) => (
          <div key={pid}>
            <h2 className={s.packhead}>{PACK_LABEL[pid] ?? pid} checks</h2>
            <div className={s.tw} style={{ marginTop: 0 }}>
              <table className={s.checks}>
                <thead><tr><th>Check</th><th>Verdict</th><th>What happened</th></tr></thead>
                <tbody>
                  {x.checks.filter((c) => c.pack === pid).map((c) => (
                    <tr key={c.id}>
                      <td className={s.id}>{c.id}{c.critical && <span className={s.crit}>critical</span>}{c.advisory && <span className={s.muted}> (advisory)</span>}<div className={s.muted} style={{ fontFamily: "var(--font-sans)", whiteSpace: "normal" }}>{c.label}</div></td>
                      <td><span className={`chip c-${c.verdict}${c.advisory ? " adv" : ""}`}>{WORD[c.verdict]}</span></td>
                      <td className={s.sum}>{c.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {(notGraded.length > 0 || x.notCovered.length > 0) && (
          <section className={s.sec}>
            <h2>What was not covered</h2>
            <ul className={s.list}>
              {notGraded.map((p) => <li key={p.id}><b>{PACK_LABEL[p.id] ?? p.id}:</b> {sentence(`${p.status === "na" ? "not applicable" : p.status}${p.reason ? `. ${p.reason}` : ""}`)}</li>)}
              {x.notCovered.map((n, i) => <li key={i}>{sentence(n)}</li>)}
            </ul>
          </section>
        )}

        <section className={s.sec}>
          <h2>Run it yourself</h2>
          <p>Started with the standard settings like this; put it in <code>sealmark.yaml</code> as the server:</p>
          <div className={s.code}>{launchLine(x)}</div>
        </section>

        <p className={s.muted} style={{ marginTop: 28 }}>
          Each of {VERDICTS_CHECKED} verdicts was checked independently, and Sealmark was wrong on some: <Link href="/results/#reliability">how reliable Sealmark is</Link>.
        </p>
        <DisputeNote />
        <nav className={s.nav2} aria-label="Other servers">
          {prev ? <Link href={`/results/${prev.id}/`}>← {prev.name}</Link> : <span />}
          <Link href="/results/">All results</Link>
          {next ? <Link href={`/results/${next.id}/`}>{next.name} →</Link> : <span />}
        </nav>
      </main>
    </>
  );
}
