import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import notGraded from "../../../fleet/not-graded.json";
import { fleetStatus } from "@/lib/fleet-status.mjs";
import { gradeOf } from "@/lib/api-data";
import { loadHistory } from "@/lib/history";
import { loadCadence } from "@/lib/fleet-runs";
import { RESULTS_PUBLIC, SERVERS_RESULTS } from "@/lib/results";
import s from "../results/results.module.css";

export const metadata: Metadata = {
  title: "Fleet status: Sealmark's automated test runs | Sealmark",
  description: "How many public MCP servers Sealmark has graded, how current the grades are, how often the fleet really runs, the test runs of the last two weeks and why some servers are not graded yet.",
  alternates: { canonical: "/status/", types: { "application/atom+xml": [{ url: "/results/feed.xml", title: "Sealmark: MCP server grade changes" }] } },
};

// Fleet status (site#59 slice 2): counts from the committed data only (lib/fleet-status.mjs), dated by the data.
export default function StatusPage() {
  if (!RESULTS_PUBLIC) notFound();
  const { cadence, everyH } = loadCadence();
  const hours = (n: number) => (n === 1 ? "1 hour" : `${n} hours`);
  const st = fleetStatus((x) => gradeOf(x) !== null, SERVERS_RESULTS, loadHistory(), notGraded as { count: number; byReason: Record<string, number> });
  return (
    <>
      <Nav />
      <main id="main" className={`gutter ${s.wrap}`}>
        <p className={s.crumb}><Link href="/results/">Results</Link> / Fleet status</p>
        <h1 className={s.h1}>Fleet status</h1>
        {st.latest && <p className={s.meta}><span>latest run {st.latest}</span>{st.oldest && <span>oldest grade {st.oldest}</span>}</p>}
        <p className={s.lede}>
          Sealmark&rsquo;s fleet tests public MCP servers on fresh GitHub-hosted machines, re-tests them, and commits what it finds. This page counts what those runs recorded, from the same data as the results pages, and is rebuilt each time the site is deployed. Dates are UTC days.
        </p>
        <div className={s.stats}>
          <div className={s.stat}><b>{st.graded}</b><span>servers with a grade, of {st.listed} with a results page</span></div>
          <div className={s.stat}><b>{st.freshPct == null ? "None" : `${st.freshPct}%`}</b><span>tested at most {st.staleAfter} days before the latest run</span></div>
          <div className={s.stat}><b>{st.retests}</b><span>servers run, counted once a day, in the {st.days.length} days to {st.latest ?? "now"}</span></div>
          <div className={s.stat}><b>{st.notGraded}</b><span>servers tried and not graded yet</span></div>
        </div>

        {cadence && cadence.medianGapH != null && cadence.longestGapH != null && (
          <section className={s.sec} aria-labelledby="cadence-h">
            <h2 id="cadence-h">How often the fleet runs</h2>
            <p>
              {everyH ? <>The fleet is scheduled to run every {hours(everyH)}. </> : null}
              From {cadence.from} to {cadence.to}, {cadence.runs} fleet runs recorded results: {cadence.scheduled} started by the schedule and {cadence.onRequest} started on request.
              Between scheduled fleet runs that recorded results, the usual gap was {hours(cadence.medianGapH)} (the median) and the longest was {hours(cadence.longestGapH)}.
              A gap can be longer than the schedule because GitHub starts scheduled runs late or skips them, and because a run that fails, or finds nothing to test, records nothing.
              The last fleet run recorded its results at {cadence.lastAt.slice(0, 16).replace("T", " ")} UTC.
            </p>
          </section>
        )}

        {st.days.length > 0 && (
          <section className={s.sec} aria-labelledby="days-h">
            <h2 id="days-h">Runs by day</h2>
            <p>One count per server per day (its last run that day), for graded servers and servers not graded yet. A run that did not finish says nothing about a grade: a graded server keeps the grade from its last finished run, and a server with no finished run stays on the not-graded list.</p>
            <div className={`${s.tw} ${s.statusWrap}`} tabIndex={0} role="region" aria-label="Table of runs by day">
              <table className={`${s.vt} ${s.statusDays}`}>
                <caption className="sr-only">Servers run per day (their last run that day), newest first</caption>
                <thead><tr><th scope="col">Day</th><th scope="col">Finished</th><th scope="col">Did not finish</th></tr></thead>
                <tbody>
                  {st.days.map((d) => <tr key={d.date}><th scope="row">{d.date}</th><td>{d.graded}</td><td>{d.failed}</td></tr>)}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {st.reasons.length > 0 && (
          <section className={s.sec} aria-labelledby="ng-h">
            <h2 id="ng-h">Not graded yet, by reason</h2>
            <p>
              Servers the fleet tried and could not grade under its default run (the registry&rsquo;s arguments where it lists plain fixed values, the standard settings, no secrets). A reason says how that run went, not what the server is worth. <Link href="/results/#not-graded">The full list</Link> names every server.
            </p>
            <div className={`${s.tw} ${s.statusWrap}`} tabIndex={0} role="region" aria-label="Table of not-graded servers by reason">
              <table className={`${s.vt} ${s.statusDays}`}>
                <caption className="sr-only">Servers not graded yet, by reason</caption>
                <thead><tr><th scope="col">Reason</th><th scope="col">Servers</th></tr></thead>
                <tbody>
                  {st.reasons.map((r) => <tr key={r.reason}><th scope="row">{r.label}</th><td>{r.count}</td></tr>)}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className={s.sec} aria-labelledby="follow-h">
          <h2 id="follow-h">Follow the results</h2>
          <ul className={s.topicList}>
            <li><a href="/results/feed.xml" type="application/atom+xml">Grade changes feed (Atom)</a><span className={s.muted}>moves with a different server version, same Sealmark version</span></li>
            <li><Link href="/results/history/">Grade history</Link><span className={s.muted}>every run of every tracked server</span></li>
            <li><a href="/data/v1/servers.json">Results as JSON</a><span className={s.muted}>no key; <Link href="/docs/guides/results-data/">fields</Link></span></li>
          </ul>
        </section>
      </main>
      <Footer />
    </>
  );
}
