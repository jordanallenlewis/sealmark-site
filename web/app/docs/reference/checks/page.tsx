import { clsx } from "clsx";
import type { Metadata } from "next";
import Link from "next/link";
import { DocHeader } from "@/components/docs/MdxBits";
import { CHECKS, PACKS, VerifiedChips, provenance } from "../ref";
import s from "../ref.module.css";

export const metadata: Metadata = {
  title: "Checks reference | Sealmark docs",
  description: "Every check in every test suite: what it probes, how it is decided, and whether it is critical, scored or advisory. Generated from the CLI.",
};

/** One line per suite. The ids and the check lists come from packs.json; only these sentences are written by hand. */
const BLURB: Record<string, string> = {
  core: "Hygiene any MCP server should pass. Needs only a command or a URL.",
  db: "Starts your server once per database role against a seeded synthetic Postgres.",
  sqlite: "The same ideas on an embedded SQLite file the harness seeds.",
  fs: "For tools that take a file path: reads and writes outside the sandbox root, links, size cap.",
  net: "For tools that take a URL: loopback and scheme probes against a listener the harness owns.",
  git: "For tools that take a repository path: repository scope and argument injection.",
  http: "For servers reached by URL: origin, authentication, protocol version, sessions, CORS, bind address and TLS.",
  effects: "Declared against done: whether a tool's annotations match what changed.",
  exec: "Opt-in. For tools that run commands; runs only with --active and only harness-owned programs.",
  custom: "Your own probes from sealmark.yaml. They add checks of their own; there are none built in.",
};

export default function ChecksIndexPage() {
  const byId = new Map(CHECKS.map((c) => [c.id, c]));
  return (
    <article>
      <DocHeader title="Checks" description={`${CHECKS.length} checks in ${PACKS.filter((p) => p.checks.length).length} test suites.`} status="shipped" />
      <p className={s.note}>
        {provenance("its checks")} <strong>critical</strong>: a fail caps the suite grade at D. <strong>advisory</strong>: reported, never scored. <strong>candidate</strong>: reported now, scored only after a methodology bump promotes it. When a pack runs is on <Link href="/docs/concepts/packs">Packs</Link>; what a verdict scores is on <Link href="/docs/concepts/verdicts">Verdicts</Link>.
      </p>
      {PACKS.map((g) => {
        const rows = g.checks.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
        return (
          <section key={g.id} aria-labelledby={`pack-${g.id}`}>
            <h2 className={s.h2} id={`pack-${g.id}`}>{g.id} suite</h2>
            <p className={s.note}>{BLURB[g.id] ?? ""}{g.standard ? "" : " Not in the standard profile."}</p>
            {rows.length ? (
              <div className="tw">
                <table className={`${s.tbl} ${s.stack}`}>
                  <thead>
                    <tr>
                      <th scope="col">Check</th>
                      <th scope="col">Weight</th>
                      <th scope="col">Decided by</th>
                      <th scope="col">Scope</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.id}>
                        <th scope="row">
                          <Link href={`/docs/reference/checks/${c.id}`}><code>{c.id}</code></Link>
                          <div style={{ fontWeight: 400 }}>{c.label}</div>
                        </th>
                        <td data-label="Weight">
                          <span className={clsx("chip", c.critical ? "c-fail" : "c-na", c.advisory && "adv")}>{c.critical ? "critical" : c.advisory ? "advisory · not scored" : "scored"}</span>
                          {c.candidate ? <> <span className="chip c-inconclusive">candidate</span></> : null}
                        </td>
                        <td data-label="Decided by"><span className={s.chips}><VerifiedChips list={c.verifiedBy} /></span></td>
                        <td data-label="Scope">{c.scope}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        );
      })}
    </article>
  );
}
