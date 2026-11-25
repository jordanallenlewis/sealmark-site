import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import { maintainerFor } from "@/lib/server-facts-data";
import s from "./results.module.css";

// Who maintains this server, by their own claim file (sealmark-site#69, fleet/claim.mjs): the repository linked to the
// server says so in .github/sealmark-claim.json, re-read once a day. Not shown for a server with a held security
// finding (its page names no repository). A fact about a file, never a judgement: a claim changes no grade.
export function Maintainer({ id, held }: { id: string; held: boolean }) {
  const m = maintainerFor({ id }, held);
  if (!m) return null;
  if (m.state === "claimed") {
    return (
      <section className={s.note} aria-labelledby="maintainer-h" data-maintainer="claimed">
        <h2 id="maintainer-h" className={s.noteHead}>Maintainer <span className={s.noteState}>claimed</span></h2>
        <p>
          <a href={m.url} rel="noopener noreferrer" data-third-party="">{m.repo}</a>, the repository linked to this server, says in its
          claim file that it maintains this server. Last checked {m.checked}.
        </p>
        <p>A claim changes no grade. <Link href="/docs/guides/claim/">How claims work</Link>.</p>
      </section>
    );
  }
  return (
    <section className={s.note} aria-labelledby="maintainer-h" data-maintainer="unclaimed">
      <h2 id="maintainer-h" className={s.noteHead}>Maintain this server?</h2>
      <p>
        Commit this file to <a href={m.url} rel="noopener noreferrer" data-third-party="">{m.repo}</a> as <code>{m.path}</code> on
        its default branch. Sealmark reads it once a day, then names the repository here as the maintainer. No account, and
        a claim changes no grade.
      </p>
      <div className={`ibox ${s.cmd}`}>
        <pre tabIndex={0} data-third-party="" aria-label="Claim file">{m.file}</pre>
        <CopyButton text={m.file} />
      </div>
      <p><Link href="/docs/guides/claim/">How claims work</Link>, and what they do not do.</p>
    </section>
  );
}
