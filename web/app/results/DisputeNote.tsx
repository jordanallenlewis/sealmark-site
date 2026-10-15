import Link from "next/link";
import s from "./results.module.css";

// The one disclosure and dispute note for every results page. The policy itself lives in /docs/disclosure.
export function DisputeNote() {
  return (
    <div className={s.note}>
      Think a verdict is wrong, or want a server removed? Email disclosure@sealmark.dev with the server version. We recheck, correct the page if we were wrong, and add your reply. See the <Link href="/docs/disclosure/">disclosure policy</Link>.
    </div>
  );
}
