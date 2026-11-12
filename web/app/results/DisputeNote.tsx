import Link from "next/link";
import s from "./results.module.css";

// The one "is this wrong?" block for every results page. The policy itself lives in app/disclosure (/disclosure/).
// A server with a security finding has no public GitHub issue (fleet/notify-owners.mjs), so its page points at the
// private report instead.
export function DisputeNote({ privateReport = false }: { privateReport?: boolean }) {
  return (
    <section className={s.note} aria-labelledby="dispute-h">
      <h2 id="dispute-h" className={s.noteHead}>Is this wrong?</h2>
      <p>
        {privateReport ? "Reply to our private report" : "Reply on the GitHub issue"} or email <a href="mailto:disclosure@sealmark.dev">disclosure@sealmark.dev</a> and
        we will recheck it. Maintainers can ask for their server to be removed.
      </p>
      <p>
        If we were wrong, we correct the page and add your reply. Security findings go to the maintainer privately first; see the <Link href="/disclosure/">disclosure policy</Link>.
      </p>
    </section>
  );
}
