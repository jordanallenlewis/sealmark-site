import type { Metadata } from "next";
import { DocHeader } from "@/components/docs/MdxBits";
import cliJson from "@/content/generated/cli.json";
import type { CliDescription } from "@/lib/generated";
import { Prose, provenance } from "../ref";
import s from "../ref.module.css";

export const metadata: Metadata = {
  title: "CLI reference | Sealmark docs",
  description: "Commands, flags and exit codes of the sealmark command line. Generated from the CLI.",
};

const CLI = cliJson as unknown as CliDescription;

export default function CliPage() {
  return (
    <article>
      <DocHeader title="CLI" description="Commands, flags and exit codes." status="shipped" />
      <p className={s.note}>
        {provenance("itself")} Only flags the CLI accepts today are listed.
      </p>

      <h2 className={s.h2} id="commands">Commands</h2>
      {CLI.commands.map((c) => (
        <section key={c.name} aria-labelledby={`cmd-${c.name}`}>
          <h3 className={s.h3} id={`cmd-${c.name}`}><code className={s.code}>sealmark {c.name}</code></h3>
          <p>{c.summary}</p>
          <pre className={s.usage} tabIndex={0}>{c.usage}</pre>
        </section>
      ))}

      <h2 className={s.h2} id="flags">Flags</h2>
      <div className="tw">
        <table className={`${s.tbl} ${s.stack}`}>
          <thead>
            <tr>
              <th scope="col">Flag</th>
              <th scope="col">Value</th>
              <th scope="col">Config key</th>
              <th scope="col">Commands</th>
              <th scope="col">Meaning</th>
            </tr>
          </thead>
          <tbody>
            {CLI.flags.map((f) => (
              <tr key={f.name} id={`flag-${f.name.replace(/^-+/, "").replace(/[^a-z0-9]+/gi, "-")}`}>
                <th scope="row"><code>{f.name}</code>{f.negatable ? <div className={s.muted}>or <code>--no-{f.name.slice(2)}</code></div> : null}</th>
                <td data-label="Value">{f.metavar ? <code>{f.metavar}</code> : <span className={s.muted}>{f.type === "boolean" ? "switch" : f.type}</span>}</td>
                <td data-label="Config key">{f.schemaPath ? <code>{f.schemaPath}</code> : <span className={s.muted}>flag only</span>}</td>
                <td data-label="Commands">{f.commands.join(", ")}</td>
                <td data-label="Meaning">{f.doc}{f.safety ? <> <em className={s.muted}>(safety flag: only the command line sets it, never a file or an environment variable)</em></> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className={s.h2} id="exit-codes">Exit codes</h2>
      <ol className={s.ladder} aria-label="Exit codes" start={0}>
        {CLI.exitCodes.map((e) => (
          <li key={e.code} className={s[`code${e.code}` as keyof typeof s]}>
            <span className={s.num} aria-label={`Exit code ${e.code}`}>{e.code}</span>
            <span>{e.meaning}</span>
          </li>
        ))}
      </ol>

      <div className={s.prose}>
        <Prose file="reference/cli" />
      </div>
    </article>
  );
}
