import { ownerNoticeFor } from "@/lib/owner-notices";
import s from "./results.module.css";

// Where the public GitHub issue about this grade stands, from the fleet's last re-test run. Shown only for servers
// Sealmark opened an issue on. Facts and a link; nothing here judges the maintainer.
export function OwnerNotice({ id }: { id: string }) {
  const n = ownerNoticeFor(id);
  if (!n) return null;
  return (
    <section className={s.note} aria-labelledby="owner-notice-h" data-owner-notice={n.state}>
      <h2 id="owner-notice-h" className={s.noteHead}>The issue we opened <span className={s.noteState}>{n.label}</span></h2>
      <p>{n.text}</p>
      <p><a href={n.issueUrl} rel="noopener noreferrer">Read the issue on GitHub</a>. State as of the last re-test run.</p>
    </section>
  );
}
