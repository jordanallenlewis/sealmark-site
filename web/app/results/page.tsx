import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { ResultsTable } from "@/components/ResultsTable";
import { Seal } from "@/components/Seal";
import { DATA, RESULTS_PUBLIC, RANK, SERVERS_RESULTS, SERVER_COUNT, VERDICTS_CHECKED, deepPacks, worst, type Letter } from "@/lib/results";
import { DisputeNote } from "./DisputeNote";
import s from "./results.module.css";

export const metadata: Metadata = RESULTS_PUBLIC
  ? { title: `Results: Sealmark on ${SERVER_COUNT} public MCP servers`, description: `What Sealmark found when it ran against ${SERVER_COUNT} popular open-source MCP servers, with the evidence behind every grade.` }
  : { title: "Results: coming soon", description: "Named results for public MCP servers are published after their maintainers have had the chance to review them." };

const LETTERS: Letter[] = ["A", "B", "C", "D", "F"];

/** The newest test date in the results, as "November 10, 2026" (UTC): the fleet re-tests servers, so a fixed month goes stale. */
function lastTested(list: readonly { testedAt?: string }[]): string {
  const last = list.map((x) => x.testedAt ?? "").filter(Boolean).sort().at(-1);
  if (!last) return "date unknown";
  const d = new Date(`${last.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? last : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default function ResultsPage() {
  if (!RESULTS_PUBLIC) {
    return (
      <>
        <Nav />
        <main id="main" className={`gutter ${s.wrap}`}>
          <h1 className={s.h1}>Results are coming</h1>
          <p className={s.lede}>
            Sealmark has been run on popular open-source MCP servers. The named results are published after each maintainer has been told privately
            and has had the chance to reply, under the coordinated disclosure policy. Until then, see the <Link href="/docs/methodology/">methodology</Link>.
          </p>
        </main>
        <Footer />
      </>
    );
  }
  const list = [...SERVERS_RESULTS].sort((a, b) => {
    const wa = worst(a), wb = worst(b);
    return (wb ? RANK[wb.letter] : -1) - (wa ? RANK[wa.letter] : -1) || a.name.localeCompare(b.name);
  });
  const dist = Object.fromEntries(LETTERS.map((l) => [l, list.filter((x) => worst(x)?.letter === l).length]));
  const rounds = DATA.verification.rounds;
  const sum = (k: keyof (typeof rounds)[number]) => rounds.reduce((t, r) => t + (r[k] as number), 0);

  return (
    <>
      <Nav />
      <main id="main" className={`gutter ${s.wrap}`}>
        <div className={s.preview}>Maintainers have not reviewed these results yet. Methodology {DATA.methodology} is a draft.</div>
        <p className={s.eyebrow}>Results · updated {lastTested(list)} · Sealmark {list[0]?.sealmark.version}</p>
        <h1 className={s.h1}>What Sealmark found on {SERVER_COUNT} public MCP servers</h1>
        <p className={s.lede}>
          Each server was installed the way its README says, run through Sealmark with
          the standard settings. The October 2026 verdicts were checked independently by reading the source and making direct calls; later automated re-tests are marked on each server&rsquo;s page. Open a server to see each check, what it measured and what was not covered.
        </p>

        <div className={s.stats}>
          <div className={s.stat}><b>{VERDICTS_CHECKED}</b><span>verdicts checked independently</span></div>
          <div className={s.stat}><b>{list.filter((x) => deepPacks(x).length).length}</b><span>servers with a deeper test suite graded</span></div>
        </div>
        <div className={s.dist} aria-label="Worst grade per server">
          <span className={s.muted}>Worst grade per server:</span>
          {LETTERS.map((l) => <span key={l} className={s.distItem}><Seal g={l} /> {dist[l]}</span>)}
        </div>

        <p className={s.muted} style={{ marginTop: 20 }}><Link href="/results/history/">See how each server&rsquo;s grade changed over time</Link></p>
        <ResultsTable servers={list} />

        <section className={s.sec}>
          <h2>How to read a grade</h2>
          <div className={s.cards}>
            <div className={s.card}><h3>Protocol only means hygiene</h3><p>The protocol test area calls tools only with invalid input, so a server that does little scores well there. Look at the deeper test areas. A server&rsquo;s grade is its lowest test-area grade.</p></div>
            <div className={s.card}><h3>An A is not an endorsement</h3><p>It means these probes passed for one version and configuration; every page lists what was not covered. See <Link href="/docs/concepts/grades/">how grades work</Link> and <Link href="/docs/methodology/#what-an-a-means">what an A means</Link>.</p></div>
          </div>
        </section>

        <section className={s.sec} id="reliability">
          <h2>How reliable is Sealmark itself?</h2>
          <p>{DATA.verification.note} Sealmark makes mistakes. Here is every verdict that was checked against ground truth, so you can see how often it was right.</p>
          <div className={s.tw} tabIndex={0} role="region" aria-label="Verification results by run">
            <table className={s.vt}>
              <caption className="sr-only">Sealmark verdicts checked against ground truth, by run</caption>
              <thead><tr><th scope="col">Run</th><th scope="col">Correct pass</th><th scope="col">Correct fail</th><th scope="col">Wrong pass</th><th scope="col">Wrong fail</th><th scope="col">Inconclusive</th><th scope="col">Not applicable</th></tr></thead>
              <tbody>
                {rounds.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td><td>{r.truePass}</td><td>{r.trueFail}</td><td>{r.falsePass}</td><td>{r.falseFail}</td>
                    <td>{r.justifiedInconclusive + r.unjustifiedInconclusive}</td><td>{r.naCorrect + r.naWrong}</td>
                  </tr>
                ))}
                <tr><th scope="row">Total</th><td><b>{sum("truePass")}</b></td><td><b>{sum("trueFail")}</b></td><td><b>{sum("falsePass")}</b></td><td><b>{sum("falseFail")}</b></td><td><b>{sum("justifiedInconclusive") + sum("unjustifiedInconclusive")}</b></td><td><b>{sum("naCorrect") + sum("naWrong")}</b></td></tr>
              </tbody>
            </table>
          </div>
          <p className={s.muted} style={{ marginTop: 10 }}>Most wrong passes came from servers the verifiers deliberately broke to test whether Sealmark would catch them. Every one found became a fix. The full method is in the <Link href="/docs/methodology/">methodology</Link>.</p>
        </section>

        <DisputeNote />
      </main>
      <Footer />
    </>
  );
}
