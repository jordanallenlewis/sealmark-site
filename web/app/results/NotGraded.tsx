import Link from "next/link";
import data from "../../../fleet/not-graded.json";
import { REASON_TEXT, reasonRows } from "@/lib/not-graded.mjs";
import s from "./results.module.css";

// Servers the fleet tried from the MCP Registry and never graded (fleet/not-graded.mjs writes the file after every run).
// Not a grade: each row says how our default run went, with one typed reason and no server output. The id and version
// cells carry data-third-party: they are other people's package names, which scripts/home-check.mjs does not read as our
// status wording (a server named "foo-mock" must not fail the fleet's deploy build).
type Entry = { id: string; version: string | null; lastTried: string; attempts: number; reason: string };
const LIST = data as { count: number; byReason: Record<string, number>; servers: Entry[] };

export function NotGraded() {
  if (!LIST.count) return null;
  const rows = reasonRows(LIST.byReason);
  return (
    <section className={s.sec} id="not-graded" aria-labelledby="not-graded-h">
      <h2 id="not-graded-h">Not graded yet: {LIST.count} servers</h2>
      <p>
        The fleet also tried these servers and got no grade. It starts each one with a default launch command (the package run with npx or uvx,
        plus any fixed arguments its MCP Registry entry lists, or the start command its repository gives), the standard settings and no secrets, so many of these are limits of that default run, not
        problems with the server. This is not a grade and says nothing about what the servers do. Each one leaves the list as soon as a run grades it.
        See <Link href="/docs/concepts/grades/#not-graded-yet">what &ldquo;not graded yet&rdquo; means</Link>.
      </p>
      <div className={s.tw} tabIndex={0} role="region" aria-label="Why servers were not graded">
        <table className={`${s.vt} ${s.ngReasons}`}>
          <caption className="sr-only">Servers not graded yet, by reason</caption>
          <thead><tr><th scope="col">Reason</th><th scope="col">What happened</th><th scope="col">Servers</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.reason}><th scope="row">{r.label}</th><td>{r.meaning}</td><td>{r.count}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className={s.ngAll}>
        <summary>Show all {LIST.count} servers</summary>
        <div className={s.tw} tabIndex={0} role="region" aria-label="Every server not graded yet">
          <table className={`${s.vt} ${s.ngList}`}>
            <caption className="sr-only">Every server not graded yet, newest attempt first</caption>
            <thead><tr><th scope="col">Server</th><th scope="col">Version tried</th><th scope="col">Last tried</th><th scope="col">Attempts</th><th scope="col">Reason</th></tr></thead>
            <tbody>
              {LIST.servers.map((x) => (
                <tr key={x.id}>
                  <th scope="row" data-third-party=""><code className={s.ngId}>{x.id}</code></th><td data-third-party="">{x.version ? <code className={s.ngId}>{x.version}</code> : "unknown"}</td><td>{x.lastTried}</td><td>{x.attempts}</td>
                  <td>{REASON_TEXT[x.reason]?.label ?? REASON_TEXT.unknown.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className={s.muted}>Maintainers: if your server needs a setting to start, or an argument your registry entry does not list with a fixed value, email <a href="mailto:disclosure@sealmark.dev">disclosure@sealmark.dev</a>.</p>
    </section>
  );
}
