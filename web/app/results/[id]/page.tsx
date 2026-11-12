import { clsx } from "clsx";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Seal } from "@/components/Seal";
import { PACK_LABEL, SERVERS_RESULTS, VERDICTS_CHECKED, deepPacks, ecosystemLabel, gradedPacks, isSecurityCheck, isWeakSignal, redactionsFor, worst, type CheckResult, type Disclosure, type Letter, type PackResult, type Verdict } from "@/lib/results";
import { count, coverageNote, placeholdersIn, plainWords, reproduceCommand, sentence } from "@/lib/results-copy.mjs";
import registry from "@/content/generated/checks.json";
import { GradeHistory } from "@/components/GradeHistory";
import { historyFor } from "@/lib/history";
import { ORIGIN, PRIVATE_FINDING, serverBadge, serverDescription } from "@/lib/seo";
import { DisputeNote } from "../DisputeNote";
import { NotifyForm } from "../NotifyForm";
import { retestNote } from "@/lib/retest.mjs";
import s from "../results.module.css";

export const dynamicParams = false;
// With no published results, export one placeholder route; the page answers it with notFound().
export function generateStaticParams() { return SERVERS_RESULTS.length ? SERVERS_RESULTS.map((x) => ({ id: x.id })) : [{ id: "pending" }]; }

type P = { params: Promise<{ id: string }> };
export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { id } = await params;
  const x = SERVERS_RESULTS.find((v) => v.id === id);
  return x ? { title: `${x.name} ${x.versionTested}: MCP server grade | Sealmark`, description: serverDescription(x), alternates: { canonical: `/results/${x.id}/` } } : { title: "Results" };
}

const WORD: Record<Verdict, string> = { pass: "pass", part: "partial", fail: "fail", inconclusive: "inconclusive", na: "n/a" };
// Every check with a page in the checks reference (one per id in the generated registry).
const DOCUMENTED = new Set((registry as { id: string }[]).map((c) => c.id));
const label = (pack: string) => PACK_LABEL[pack] ?? pack;

// What a weak signal means, per check (lib/disclosure.mjs WEAK_PART). Scoring is unchanged: a partial is half a point.
const WEAK: Record<string, string> = {
  "tool-poisoning": "Some wording in the tool text is worth a read, but none of it is conclusive.",
  "annotation-honesty": "A tool declared read-only changed only cache files, in its sandbox home or temp folder.",
  "net-scheme-allowlist": "The server accepts data: URLs, but no file was read and no raw connection was made.",
};

// The placeholders a start command can hold, in plain words (docs: /docs/reference/configuration/#placeholders).
const PLACEHOLDER: Record<string, string> = {
  "{dsn}": "the connection string of a throwaway Postgres that Sealmark starts for the run",
  "{sandbox}": "a throwaway folder that Sealmark creates and owns",
  "{dir}": "the same throwaway folder as {sandbox}",
  "{sandbox_home}": "the server's home folder inside that throwaway folder",
  "{sqlite_path}": "a SQLite file that Sealmark fills with test data, inside the throwaway folder",
  "{host}": "a part of the test database's connection string",
  "{port}": "a part of the test database's connection string",
  "{user}": "a part of the test database's connection string",
  "{password}": "a part of the test database's connection string",
  "{database}": "a part of the test database's connection string",
  "{upstream}": "the URL of a stub service that Sealmark runs",
};

/** Why a test area did not run, in the page's words. */
function notGradedText(p: PackResult): string {
  if (p.id === "db" && /no \{dsn\}/.test(p.reason ?? "")) {
    return "Not applicable. The start command takes no database connection, so the database tests did not run. ({dsn}, {host} and the like are placeholders that Sealmark fills in with its own test database.)";
  }
  return sentence(plainWords(`${p.status === "na" ? "not applicable" : p.status}${p.reason ? `. ${p.reason}` : ""}`));
}

function PrivateNote({ d }: { d: Disclosure }) {
  return (
    <div className={s.private}>
      <b>A security finding is being reported to the maintainer privately.</b> Details will be published when it is fixed or 90 days after the report
      {" "}(<Link href="/disclosure/">disclosure policy</Link>).
      {d.reportedAt && d.publishAfter ? ` Reported on ${d.reportedAt}; published by ${d.publishAfter} at the latest.` : ""}
    </div>
  );
}

// priv: this check is a finding under private disclosure. held: another security check in the same test area is, so
// this one's evidence is held back too (a sibling's summary can give the finding away, e.g. "accepts loopback targets").
function CheckRow({ c, priv, held }: { c: CheckResult; priv: Disclosure | undefined; held: boolean }) {
  const weak = isWeakSignal(c);
  return (
    <tr>
      <td className={s.id}>
        {DOCUMENTED.has(c.id) ? <Link href={`/docs/reference/checks/${c.id}/`} title={`What ${c.id} checks`}>{c.id}</Link> : c.id}
        {weak ? <span className={s.weak}>weak signal</span> : c.critical && <span className={s.crit}>critical</span>}
        {c.advisory && <span className={s.muted}> (advisory)</span>}
        <div className={s.muted} style={{ fontFamily: "var(--font-sans)", whiteSpace: "normal" }}>{c.label}</div>
      </td>
      <td><span className={clsx("chip", `c-${c.verdict}`, c.advisory && "adv")}>{WORD[c.verdict]}</span></td>
      <td className={s.sum}>
        {priv ? <PrivateNote d={priv} /> : held ? <span className={s.muted}>Details held back while a security finding in this test area is reported privately.</span> : c.summary}
        {weak && !held && <div className={s.muted} style={{ marginTop: 6 }}>Weak signal, not a security finding. {WEAK[c.id] ?? ""} A partial counts as half a point.</div>}
      </td>
    </tr>
  );
}

export default async function ServerPage({ params }: P) {
  const { id } = await params;
  const x = SERVERS_RESULTS.find((v) => v.id === id);
  if (!x) notFound();
  const graded = gradedPacks(x);
  const w = worst(x);
  const cov = coverageNote(x, deepPacks(x).length > 0);
  const noTools = cov.kind === "no-tools";
  const priv = redactionsFor(x);
  const packIds = [...new Set(x.checks.map((c) => c.pack))];
  const notGraded = x.packs.filter((p) => p.status !== "graded");
  const idx = SERVERS_RESULTS.findIndex((v) => v.id === x.id);
  const prev = SERVERS_RESULTS[idx - 1];
  const next = SERVERS_RESULTS[idx + 1];
  const hist = historyFor(x.id);
  const holes = placeholdersIn(x.launch);
  const packHasPrivate = (pid: string) => x.checks.some((c) => c.pack === pid && priv.has(c.id));
  const packHasWeak = (pid: string) => x.checks.some((c) => c.pack === pid && isWeakSignal(c));

  return (
    <>
      <Nav />
      <main id="main" className={`gutter ${s.wrap}`}>
        <div className={s.preview}>
          {x.automated ? `Automated re-test on ${x.testedAt}: not checked by hand, and not yet reviewed by the maintainers.` : "Maintainers have not reviewed this result yet."}
          {retestNote(x) && ` ${retestNote(x)}`}
        </div>
        <p className={s.crumb}><Link href="/results/">Results</Link> / {x.name}</p>
        <h1 className={s.h1} style={{ maxWidth: "28ch" }}>{x.name}</h1>
        <div className={s.meta}>
          <span>version tested {x.versionTested}</span>
          <span>{ecosystemLabel(x)}</span>
          <span>tested {x.testedAt}</span>
          <span>Sealmark {x.sealmark.version}</span>
          <span>methodology {x.sealmark.methodology}</span>
          <span>{x.standard ? "STANDARD run" : "CUSTOM run"}</span>
          <span>{count(x.toolCount, "tool", "tools")}</span>
        </div>

        <section className={s.overall} aria-labelledby="grade-h">
          {!noTools && w ? <Seal g={w.letter as Letter} prov={w.provisional} lg /> : <span className={s.noGrade} aria-hidden="true">–</span>}
          <div>
            <h2 id="grade-h">{noTools ? "No tools to test" : w ? `Grade ${w.letter}${w.provisional ? " (provisional)" : ""}` : "No grade"}</h2>
            {!noTools && <p>The server&apos;s grade is its lowest test-area grade. <Link href="/docs/methodology/#grading-formula">How grading works</Link></p>}
            {priv.size > 0 && <p className={s.flag}>The grade {PRIVATE_FINDING}. It still counts in full.</p>}
            <p>{cov.text}</p>
          </div>
        </section>

        {graded.length > 0 && <h2 className={s.areasHead}>Grade by test area</h2>}
        <div className={clsx(s.gradeRow, s.areas)}>
          {graded.map((p) => (
            <div key={p.id} className={s.gradeBox}>
              <Seal g={p.letter as Letter} prov={p.provisional} />
              <div>
                <b>{label(p.id)}</b>
                <small>{p.points}/{p.scored} points{p.capped ? " · capped at D" : ""}{p.provisional ? " · provisional" : ""}</small>
                {p.criticalFails.length > 0 && <small style={{ display: "block", color: "var(--fail)" }}>critical: {p.criticalFails.join(", ")}</small>}
                {packHasPrivate(p.id) && <small className={s.flag}>{PRIVATE_FINDING}</small>}
                {!packHasPrivate(p.id) && packHasWeak(p.id) && <small className={s.flag}>includes a weak signal, not a security finding</small>}
              </div>
            </div>
          ))}
        </div>

        {serverBadge(x) && (
          <section aria-labelledby="badge-h" style={{ marginTop: 24 }}>
            <h2 id="badge-h" className={s.packhead}>Badge for the README</h2>
            <p className={s.muted}>The badge shows this automated result for version {x.versionTested}. It is a link to this page, not a certificate, and it changes when the next re-test does.</p>
            <pre><code>{`[![Sealmark](${ORIGIN}/badge/${x.id}.svg)](${ORIGIN}/results/${x.id}/)`}</code></pre>
          </section>
        )}

        {packIds.map((pid) => (
          <div key={pid}>
            <h2 className={s.packhead}>{label(pid)} checks</h2>
            <div className={s.tw} style={{ marginTop: 0 }} tabIndex={0} role="region" aria-label={`${label(pid)} checks`}>
              <table className={s.checks}>
                <thead><tr><th scope="col">Check</th><th scope="col">Verdict</th><th scope="col">What happened</th></tr></thead>
                <tbody>
                  {x.checks.filter((c) => c.pack === pid).map((c) => <CheckRow key={c.id} c={c} priv={priv.get(c.id)} held={!priv.has(c.id) && packHasPrivate(pid) && isSecurityCheck(c)} />)}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        <p className={s.muted} style={{ marginTop: 10 }}>Each check id links to what it tests and how to fix a failure. The same text is in <code>sealmark explain &lt;id&gt;</code>.</p>

        {(notGraded.length > 0 || x.notCovered.length > 0) && (
          <section className={s.sec}>
            <h2>What was not covered</h2>
            <ul className={s.list}>
              {notGraded.map((p) => <li key={p.id}><b>{label(p.id)}:</b> {notGradedText(p)}</li>)}
              {x.notCovered.map((n, i) => <li key={i}>{sentence(plainWords(n))}</li>)}
            </ul>
          </section>
        )}

        {hist && hist.runs.length > 1 && (
          <section className={s.sec}>
            <h2>Grade over time</h2>
            <GradeHistory runs={hist.runs} label={x.name} />
            <p className={s.histLink}><Link href={`/results/history/#${x.id}`}>All servers over time</Link></p>
          </section>
        )}

        <section className={s.sec}>
          <h2>Run it yourself</h2>
          {priv.size > 0 ? (
            <p>The command for this run is withheld while a security finding is reported privately. It is published with the report, when the finding is fixed or 90 days after the report.</p>
          ) : (
            <>
              <p>This repeats the run with the same Sealmark version and the standard settings, starting the server the same way:</p>
              <div className={s.code}>{reproduceCommand(x.sealmark.version, x.launch)}</div>
              {holes.length > 0 && (
                <>
                  <p>The words in braces are placeholders. Sealmark fills them in when it starts the server, so leave them as they are:</p>
                  <ul className={s.list}>
                    {holes.map((h) => <li key={h}><code>{h}</code>: {PLACEHOLDER[h] ?? "a value Sealmark fills in for the run"}</li>)}
                  </ul>
                  <p className={s.muted}>The full list is under <Link href="/docs/reference/configuration/#placeholders">placeholders</Link>.</p>
                </>
              )}
              <p className={s.muted}>To keep the setup, put the start command in <code>sealmark.yaml</code> as the server.</p>
            </>
          )}
        </section>

        <NotifyForm server={x.id} name={x.name} />

        <p className={s.muted} style={{ marginTop: 28 }}>
          Each of {VERDICTS_CHECKED} verdicts was checked independently, and Sealmark was wrong on some: <Link href="/results/#reliability">how reliable Sealmark is</Link>.
        </p>
        <DisputeNote privateReport={priv.size > 0} />
        <nav className={s.nav2} aria-label="Other servers">
          {prev ? <Link href={`/results/${prev.id}/`}>← {prev.name}</Link> : <span />}
          <Link href="/results/">All results</Link>
          {next ? <Link href={`/results/${next.id}/`}>{next.name} →</Link> : <span />}
        </nav>
      </main>
      <Footer />
    </>
  );
}
