import { clsx } from "clsx";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Seal } from "@/components/Seal";
import { PACK_LABEL, SERVERS_RESULTS, VERDICTS_CHECKED, deepPacks, ecosystemLabel, gradedPacks, isSecurityCheck, isWeakSignal, redactionsFor, worst, type CheckResult, type Disclosure, type Letter, type PackResult, type Verdict } from "@/lib/results";
import { count, coverageNote, placeholdersIn, plainWords, reproduceCommand, sentence, standardHash } from "@/lib/results-copy.mjs";
import registry from "@/content/generated/checks.json";
import { GradeHistory } from "@/components/GradeHistory";
import { historyFor, toolCountsFor } from "@/lib/history";
import { changeSinceLast, type Change, type ChangeItem } from "@/lib/changes.mjs";
import { toolVerdicts, type ToolRow } from "@/lib/tool-verdicts.mjs";
import { toolDrift, type ToolDrift } from "@/lib/tool-drift.mjs";
import { PRIVATE_FINDING, serverBadge, serverDescription } from "@/lib/seo";
import { DisputeNote } from "../DisputeNote";
import { OwnerNotice } from "../OwnerNotice";
import { NotifyForm } from "../NotifyForm";
import { feedHeld } from "@/lib/feed-data";
import { CopyButton } from "@/components/CopyButton";
import { retestNote } from "@/lib/retest.mjs";
import { staleNote } from "@/lib/grade-age.mjs";
import s from "../results.module.css";
import { BadgeSnippets } from "@/components/BadgeSnippets";
import { FILL, installConfig } from "@/lib/install-config.mjs";
import { relatedServers } from "@/lib/related.mjs";
import { serverFactsFor } from "@/lib/server-facts-data";
import { checkEvidenceFor } from "@/lib/check-evidence-data";
import { MAX_LINES, MAX_TEXT, type CheckEvidence } from "@/lib/check-evidence.mjs";

export const dynamicParams = false;
// With no published results, export one placeholder route; the page answers it with notFound().
export function generateStaticParams() { return SERVERS_RESULTS.length ? SERVERS_RESULTS.map((x) => ({ id: x.id })) : [{ id: "pending" }]; }

type P = { params: Promise<{ id: string }> };
export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { id } = await params;
  const x = SERVERS_RESULTS.find((v) => v.id === id);
  return x ? { title: `${x.name} ${x.versionTested}: MCP server grade | Sealmark`, description: serverDescription(x), alternates: { canonical: `/results/${x.id}/`, ...(feedHeld(x) ? {} : { types: { "application/atom+xml": [{ url: `/results/${x.id}/feed.xml`, title: `Sealmark: grade changes for ${x.name}` }] } }) } } : { title: "Results" };
}

const WORD: Record<Verdict, string> = { pass: "pass", part: "partial", fail: "fail", inconclusive: "inconclusive", na: "n/a" };
// Every check with a page in the checks reference (one per id in the generated registry).
const DOCUMENTED = new Set((registry as { id: string }[]).map((c) => c.id));
const label = (pack: string) => PACK_LABEL[pack] ?? pack;

// What a weak signal means, per check (WEAK_PART in fleet/security-checks.mjs, via lib/disclosure.mjs). Scoring is unchanged: a partial is half a point.
const WEAK: Record<string, string> = {
  "tool-poisoning": "Some wording in the tool text is worth a read, but none of it is conclusive.",
  "annotation-honesty": "A tool declared read-only changed only cache files, in its sandbox home or temp folder.",
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

// What the reader puts in place of each run placeholder in "Add it to an MCP client" (lib/install-config.mjs).
const FILL_WORDS: Record<string, string> = {
  "{dsn}": "your Postgres connection string",
  "{sandbox}": "a folder the server may use",
  "{dir}": "a folder the server may use",
  "{sandbox_home}": "a home folder for the server",
  "{sqlite_path}": "your SQLite database file",
  "{host}": "your database host",
  "{port}": "your database port",
  "{user}": "your database user",
  "{password}": "your database password",
  "{database}": "your database name",
  "{upstream}": "the URL of the service the server talks to",
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

// The evidence viewer (site#65): what this check probed and what it observed in the run on this page, from fleet/evidence.json
// (lib/check-evidence.mjs decides what may be shown). Server text is someone else's, so it is marked data-third-party.
function EvidenceLines({ ev, id }: { ev: CheckEvidence; id: string }) {
  const n = ev.lines.length;
  return (
    <details className={s.ev}>
      <summary>Evidence<span className="sr-only"> for {id}</span>: {ev.total > n ? `first ${n} of ${ev.total} lines` : count(n, "line", "lines")}</summary>
      <ol className={s.evList}>
        {ev.lines.map((l, i) => (
          <li key={i}>
            {l.probe && <div><span className={s.evLabel}>Probe</span> <span data-third-party="">{l.probe}</span></div>}
            {l.outcome && <div><span className={s.evLabel}>Outcome</span> <span data-third-party="">{l.outcome}</span></div>}
            {(l.by || l.tool) && (
              <div className={s.evMeta}>
                {l.by && (l.how ? <>Decided {l.how} (<code>{l.by}</code>)</> : <>Decided by <code>{l.by}</code></>)}
                {l.by && l.tool && " · "}
                {l.tool && <>tool <code data-third-party="">{l.tool}</code></>}
              </div>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

// priv: this check is a finding under private disclosure. held: another security check in the same test area is, so
// this one's evidence is held back too (a sibling's summary can give the finding away, e.g. "accepts loopback targets").
function CheckRow({ c, priv, held, ev }: { c: CheckResult; priv: Disclosure | undefined; held: boolean; ev: CheckEvidence | undefined }) {
  const weak = isWeakSignal(c);
  return (
    <tr>
      <td className={s.id}>
        {DOCUMENTED.has(c.id) ? <Link href={`/docs/reference/checks/${c.id}/`} title={`What ${c.id} checks`}>{c.id}</Link> : c.id}
        {weak ? <span className={s.weak}>weak signal</span> : c.critical && <span className={clsx(s.crit, c.verdict === "fail" && s.critFail)}>critical</span>}
        {c.advisory && <span className={s.muted}> (advisory)</span>}
        <div className={s.muted} style={{ fontFamily: "var(--font-sans)", whiteSpace: "normal" }}>{c.label}</div>
      </td>
      <td data-label="Verdict"><span className={clsx("chip", `c-${c.verdict}`, c.advisory && "adv")}>{WORD[c.verdict]}</span></td>
      <td className={s.sum} data-label="What happened">
        <div className={s.sumText}>
          {priv ? <PrivateNote d={priv} /> : held ? <span className={s.muted}>Details held back while a security finding in this test area is reported privately.</span> : c.summary ?? <span className={s.muted}>The text of this result is added at the next re-test of this server.</span>}
          {weak && !held && <div className={s.muted} style={{ marginTop: 6 }}>Weak signal, not a security finding. {WEAK[c.id] ?? ""} A partial counts as half a point.</div>}
          {ev && !priv && !held && <EvidenceLines ev={ev} id={c.id} />}
        </div>
      </td>
    </tr>
  );
}

// "Since the last run" (site#54): the run this page shows against the graded run before it. Facts from the history only;
// it never says why something moved. Fewer tools can be a listing problem in the run, so a drop is never called a server change.
function changeText(i: ChangeItem) {
  switch (i.kind) {
    case "grade": return <><b>{label(i.pack)}</b> grade went {i.dir} from {i.from} to {i.to}.</>;
    case "new": return <><b>{label(i.pack)}</b> was graded in this run ({i.to}) but not in the one before.</>;
    case "gone": return <><b>{label(i.pack)}</b> was not graded in this run (it was {i.from} before).</>;
    case "version": return <>Server version changed from {i.from} to {i.to}.</>;
    case "sealmark": return <>Sealmark changed from {i.from} to {i.to}.</>;
    case "tools": return i.dir === "up"
      ? <>The server listed {i.to} tools, {i.to - i.from} more than before ({i.from}).</>
      : <>This run saw {i.to} tools, {i.from - i.to} fewer than before ({i.from}). A drop can come from how the run read the tool list, so it is not proof the server removed tools.</>;
  }
}

// Tool drift (site#54): tool names are the server's own text, so each list carries data-third-party for home-check.
const SHOWN = 12;
function Names({ list }: { list: string[] }) {
  const more = list.length - SHOWN;
  return <span data-third-party="">{list.slice(0, SHOWN).join(", ")}{more > 0 ? ` and ${more} more` : ""}</span>;
}

function DriftLines({ d }: { d: ToolDrift }) {
  return (
    <>
      {d.added.length > 0 && <li>Newly listed {d.added.length === 1 ? "tool" : "tools"}: <Names list={d.added} />.</li>}
      {d.changed.length > 0 && <li>Input schema changed (any part of it, parameter wording included): <Names list={d.changed} />.</li>}
      {d.removed.length > 0 && <li>Not in this run&apos;s tool list: <Names list={d.removed} />. A tool can be missing because of how the run read the list, so this is not proof the server removed it.</li>}
    </>
  );
}

function SinceLast({ c, drift }: { c: Change; drift: ToolDrift | null }) {
  const drifted = !!drift && drift.added.length + drift.removed.length + drift.changed.length > 0;
  const same = [
    !c.gradeChanged && "the same grade in every test area",
    drift && !drifted && "the same tools with the same input schemas",
    !c.items.some((i) => i.kind === "version") && c.from.version && c.to.version && `the same server version (${c.to.version})`,
    !c.items.some((i) => i.kind === "sealmark") && c.from.sealmark && c.to.sealmark && `the same Sealmark version (${c.to.sealmark})`,
  ].filter(Boolean) as string[];
  return (
    <div className={s.since}>
      <h3>Since the run on <time dateTime={c.from.date}>{c.from.date}</time></h3>
      {(c.items.length > 0 || drifted) && <ul>{c.items.map((i, n) => <li key={n} data-dir={i.kind === "grade" ? i.dir : undefined}>{changeText(i)}</li>)}{drifted && drift && <DriftLines d={drift} />}</ul>}
      {same.length > 0 && <p>{c.items.length > 0 || drifted ? "Unchanged: " : "Same as that run: "}{same.join(", ")}.</p>}
      {c.failedBetween > 0 && <p>On {count(c.failedBetween, "day", "days")} in between the re-test failed to run, which says nothing about the grade.</p>}
    </div>
  );
}

// "By tool" (site#54): which public checks called each tool with a valid call, with that check's verdict. A check's
// verdict is for the whole check, so the page never turns it into a grade for one tool. No row for a server with a
// security finding or a held check (lib/tool-verdicts.mjs).
function checkLink(id: string) {
  return DOCUMENTED.has(id) ? <Link href={`/docs/reference/checks/${id}/`}>{id}</Link> : <>{id}</>;
}

function ToolRowView({ r }: { r: ToolRow }) {
  return (
    <tr>
      {/* data-third-party: the server's own tool name, which scripts/home-check.mjs must not read as our status wording */}
      <td className={s.id} data-third-party="">{r.tool}</td>
      <td data-label="Called by">
        {r.called.length === 0 ? <span className={s.muted}>No check listed here called it with a valid call.</span> : (
          <ul className={s.toolChecks}>
            {r.called.map((c) => <li key={c.id}>{checkLink(c.id)} <span className={clsx("chip", `c-${c.verdict}`, c.advisory && "adv")}>{WORD[c.verdict as Verdict] ?? c.verdict}</span>{c.advisory && <span className={s.muted}>(advisory)</span>}</li>)}
          </ul>
        )}
      </td>
      <td data-label="Not exercised by">
        {r.notCalled.length === 0 ? <span className={s.muted}>None</span> : (
          <ul className={s.toolChecks}>{r.notCalled.map((c) => <li key={c.id}>{checkLink(c.id)}{c.advisory && <span className={s.muted}>(advisory)</span>}</li>)}</ul>
        )}
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
  const since = hist ? changeSinceLast(hist.runs, x.testedAt, toolCountsFor(x.id, hist.runs)) : null;
  const holes = placeholdersIn(x.launch);
  const packHasPrivate = (pid: string) => x.checks.some((c) => c.pack === pid && priv.has(c.id));
  const packHasWeak = (pid: string) => x.checks.some((c) => c.pack === pid && isWeakSignal(c));
  const repro = reproduceCommand(x.sealmark.version, x.launch);
  const hash = standardHash(x);
  const byTool = noTools ? null : toolVerdicts(x, priv);
  const drift = toolDrift(x, since, priv);
  const inst = installConfig(x, { withheld: priv.size > 0 });
  const fills = inst ? [...new Map(inst.fill.map((p) => [FILL[p], FILL_WORDS[p]])).entries()] : [];
  const related = relatedServers(x, SERVERS_RESULTS);
  const facts = serverFactsFor(x, priv.size > 0);
  const evidence = checkEvidenceFor(x, priv.size > 0);
  const relatedHeld = new Set(related.filter((r) => redactionsFor(SERVERS_RESULTS.find((v) => v.id === r.id)!).size > 0).map((r) => r.id));

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
          <span>tested {x.testedAt}{staleNote(x.testedAt, new Date().toISOString().slice(0, 10)) ? <> ({staleNote(x.testedAt, new Date().toISOString().slice(0, 10))})</> : null}</span>
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
            <p className={s.disputeLink}><a href="#dispute-h">Think this is wrong?</a></p>
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

        {packIds.map((pid) => (
          <section key={pid}>
            <h2 id={`checks-${pid}`} className={s.packhead}>{label(pid)} checks</h2>
            <div className={clsx(s.tw, s.twChecks)} style={{ marginTop: 0 }} tabIndex={0} role="region" aria-label={`${label(pid)} checks`}>
              <table className={clsx(s.checks, s.evidence)}>
                <colgroup><col className={s.colCheck} /><col className={s.colVerdict} /><col /></colgroup>
                <thead><tr><th scope="col">Check</th><th scope="col">Verdict</th><th scope="col">What happened</th></tr></thead>
                <tbody>
                  {x.checks.filter((c) => c.pack === pid).map((c) => <CheckRow key={c.id} c={c} priv={priv.get(c.id)} held={!priv.has(c.id) && packHasPrivate(pid) && isSecurityCheck(c)} ev={evidence?.get(c.id)} />)}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        <p className={s.muted} style={{ marginTop: 10 }}>Each check id links to what it tests and how to fix a failure. The same text is in <code>sealmark explain &lt;id&gt;</code>.</p>
        {evidence && <p className={s.muted}>Under a check, Evidence shows what it probed (sent or inspected) and what it observed in this run: up to {MAX_LINES} lines per check, each cut at {MAX_TEXT} characters, for checks that are not security checks. The text is shortened, and paths and anything that looks like a secret or token are replaced. Run <code>sealmark run --format json</code> yourself for every line in full.</p>}

        {byTool && (
          <section className={s.sec} aria-labelledby="tools-h">
            <h2 id="tools-h">By tool</h2>
            <p>Which checks called each tool with a valid call in this run, and which did not exercise it. A check can leave a tool out for several reasons: a limit Sealmark sets, a tool left out by design, input the run could not fill in, or a call that returned an error. The CLI report gives the reason. A verdict belongs to the whole check, not to one tool: a failed check that called three tools does not say which one failed. Security checks are left out of this table.</p>
            {byTool.missing && <p className={s.muted}>Some of this server&apos;s tool names are not shown: the run keeps a limited number, and names with unusual characters are left out.</p>}
            <div className={clsx(s.tw, s.twChecks)} tabIndex={0} role="region" aria-labelledby="tools-h">
              <table className={clsx(s.checks, s.evidence, s.byTool)}>
                <colgroup><col className={s.colCheck} /><col /><col /></colgroup>
                <thead><tr><th scope="col">Tool</th><th scope="col">Called by</th><th scope="col">Not exercised by</th></tr></thead>
                <tbody>{byTool.rows.map((r) => <ToolRowView key={r.tool} r={r} />)}</tbody>
              </table>
            </div>
          </section>
        )}

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
            {since && <SinceLast c={since} drift={drift} />}
            <GradeHistory runs={hist.runs} label={x.name} />
            <p className={s.histLink}><Link href={`/results/history/#${x.id}`}>All servers over time</Link></p>
          </section>
        )}

        {serverBadge(x) && (
          <section className={s.sec} aria-labelledby="badge-h">
            <h2 id="badge-h">Badge for the README</h2>
            <p>The badge shows this automated result for version {x.versionTested}. It is a link to this page, not a certificate, and it changes when the next re-test does.</p>
            <BadgeSnippets id={x.id} name={x.name} />
          </section>
        )}

        {facts && (
          <section className={s.sec} aria-labelledby="facts-h">
            <h2 id="facts-h">{facts.kind === "project" ? "Project facts" : "Package facts"}</h2>
            <dl className={s.facts}>
              {facts.license && (
                <>
                  <dt>License</dt>
                  <dd><span data-third-party="">{facts.license}</span>{facts.licenseFrom === "repo" ? " (from the repository; the package names none)" : ""}</dd>
                </>
              )}
              {facts.latest && (
                <>
                  <dt>Latest release</dt>
                  <dd>
                    <span data-third-party="">{facts.latest.version}</span>{facts.latest.date ? `, published ${facts.latest.date}` : ""}
                    {facts.latest.graded === true ? " (the version graded on this page)" : facts.latest.graded === false ? <>. This page graded <span data-third-party="">{x.versionTested}</span>.</> : ""}
                  </dd>
                </>
              )}
              {facts.repo && (
                <>
                  <dt>Repository</dt>
                  <dd><a href={facts.repo.url} rel="nofollow noopener" data-third-party="">{facts.repo.name}</a>{facts.repo.archived ? " (archived by its owner: read-only)" : ""}</dd>
                  {facts.repo.pushed && (
                    <>
                      <dt>Last push</dt>
                      <dd>{facts.repo.pushed}</dd>
                    </>
                  )}
                  {facts.repo.openIssues != null && (
                    <>
                      <dt>Open issues and pull requests</dt>
                      <dd>{facts.repo.openIssues}</dd>
                    </>
                  )}
                </>
              )}
            </dl>
            <p className={s.muted}>From {facts.from}, checked {facts.checked}. Plain facts about the {facts.kind}; they play no part in the grade.</p>
          </section>
        )}

        {inst && (
          <section className={s.sec} aria-labelledby="install-h">
            <h2 id="install-h">Add it to an MCP client</h2>
            <p>This starts version {x.versionTested}, the version graded on this page, with the start command from the test run. For a client that reads an <code>mcpServers</code> JSON file:</p>
            <div className={`ibox ${s.cmd}`}>
              <pre tabIndex={0} data-third-party="" aria-label="Client configuration in JSON">{inst.json}</pre>
              <CopyButton text={inst.json} />
            </div>
            <p>Or add it to Claude Code:</p>
            <div className={`ibox ${s.cmd}`}>
              <pre tabIndex={0} data-third-party="" aria-label="Command to add it to Claude Code">{inst.claude}</pre>
              <CopyButton text={inst.claude} />
            </div>
            {fills.length > 0 && (
              <>
                <p>The test run gave the server a throwaway database or folder, which Sealmark prepared first. Replace these values with your own, and where one is followed by a file or folder name (such as <code>/repo</code> or <code>/papers</code>), make sure that path exists:</p>
                <ul className={s.list}>{fills.map(([v, words]) => <li key={v}><code>{v}</code>: {words}</li>)}</ul>
              </>
            )}
            <p className={s.muted}>The test run started the server with no API keys or other secrets, and with a cleaned environment. If the server needs some, its own documentation says how to pass them.</p>
          </section>
        )}

        <section className={s.sec}>
          <h2>Run it yourself</h2>
          {priv.size > 0 ? (
            <p>The command for this run is withheld while a security finding is reported privately. It is published with the report, when the finding is fixed or 90 days after the report.</p>
          ) : (
            <>
              <p>This repeats the run with the same Sealmark version and the standard settings, starting the server the same way:</p>
              <div className={`ibox ${s.cmd}`}>
                <pre tabIndex={0} aria-label="Command to repeat this run">{repro}</pre>
                <CopyButton text={repro} />
              </div>
              {holes.length > 0 && (
                <>
                  <p>The words in braces are placeholders. Sealmark fills them in when it starts the server, so leave them as they are:</p>
                  <ul className={s.list}>
                    {holes.map((h) => <li key={h}><code>{h}</code>: {PLACEHOLDER[h] ?? "a value Sealmark fills in for the run"}</li>)}
                  </ul>
                  <p className={s.muted}>The full list is under <Link href="/docs/reference/configuration/#placeholders">placeholders</Link>.</p>
                </>
              )}
              {hash && (
                <p>
                  To confirm your run used the standard settings, add <code>--format json --out report.json</code> to the command.
                  In the report, <code>config.standard</code> should be <code>true</code> and <code>config.hash</code> should start
                  with <code>{hash}</code>, as they did in this run. If either differs, so did the settings, and the verdicts may too
                  (<Link href="/docs/concepts/standard-vs-custom/">STANDARD and CUSTOM runs</Link>).
                </p>
              )}
              <p className={s.muted}>To keep the setup, put the start command in <code>sealmark.yaml</code> as the server.</p>
            </>
          )}
        </section>

        {related.length > 0 && (
          <section className={s.sec} aria-labelledby="related-h">
            <h2 id="related-h">Related servers</h2>
            <p>Other servers graded in the same test {related.some((r) => r.shared.length > 1) || new Set(related.flatMap((r) => r.shared)).size > 1 ? "areas" : "area"}, most areas in common first, then by grade.</p>
            <ul className={s.list}>
              {related.map((r) => (
                <li key={r.id}>
                  <Link href={`/results/${r.id}/`} data-third-party="">{r.name}</Link>
                  {r.letter ? ` · grade ${r.letter}${r.provisional ? " (provisional)" : ""}` : ""}{relatedHeld.has(r.id) ? ` (the grade ${PRIVATE_FINDING})` : ""} · {r.shared.map(label).join(", ")}
                </li>
              ))}
            </ul>
          </section>
        )}

        <NotifyForm server={x.id} name={x.name} />
        {!feedHeld(x) && <p className={s.muted}>Or follow it in a feed reader: the <a href={`/results/${x.id}/feed.xml`} type="application/atom+xml">Atom feed</a> lists each move of the overall grade that came with a different version of this server, tested with the same Sealmark version as the graded run before.</p>}

        <p className={s.muted} style={{ marginTop: 28 }}>
          Each of {VERDICTS_CHECKED} verdicts was checked independently, and Sealmark was wrong on some: <Link href="/results/#reliability">how reliable Sealmark is</Link>.
        </p>
        <OwnerNotice id={x.id} />
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
