import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import s from "../results/results.module.css";

// The disclosure policy: how a security finding in someone else's MCP server is reported. Linked from every owner
// issue (worker/notify-core.mjs), every results page (app/results/DisputeNote.tsx) and the footer. The fleet side of it
// is fleet/notify-owners.mjs (no public issue for a security finding) and fleet/security-checks.mjs (which checks).
const DESC = "How Sealmark reports a security problem it finds in someone's MCP server: privately first, 14 days to reply, published at a fix or at day 90.";
export const metadata: Metadata = { title: "Disclosure policy | Sealmark", description: DESC, alternates: { canonical: "/disclosure/" } };

const CHECKS = "https://github.com/jordanallenlewis/sealmark-site/blob/main/fleet/security-checks.mjs";

export default function Page() {
  return (
    <>
      <Nav />
      <main id="main" className={`gutter ${s.wrap}`}>
        <h1 className={s.h1}>Disclosure policy</h1>
        <p className={s.lede}>When a Sealmark re-test finds a security problem in someone&apos;s MCP server, the maintainer hears about it privately first.</p>

        <h2 className={s.packhead}>What counts as a security finding</h2>
        <p>A failed security check: a read or write outside the allowed folder, a command or SQL statement that should have been blocked, a request the server makes to a loopback or internal address, a secret echoed back, poisoned tool text, and the other checks in the <a href={CHECKS}>security list</a>.</p>

        <h2 className={s.packhead}>How it is reported</h2>
        <ol>
          <li><strong>Privately, through GitHub.</strong> We file a private vulnerability report (a draft security advisory) on the server&apos;s repository. If the repository does not accept those, we use the security contact it lists. If it lists none, we note that and wait.</li>
          <li><strong>Never in a public issue.</strong> Sealmark opens one automated GitHub issue per repository to tell owners their grade. A repository with a security finding does not get that issue.</li>
          <li><strong>14 days to reply.</strong> If there is no reply in 14 days, we send one reminder through the same channel. No reply is not taken as agreement.</li>
          <li><strong>Published at a fix, or at day 90.</strong> The full report, with the steps to reproduce, is published when a fixed version is out or 90 days after the first report, whichever comes first. It names the fix status and both versions&apos; grades. The maintainer&apos;s reply, if they send one, is published beside it.</li>
        </ol>

        <h2 className={s.packhead}>What is public before then</h2>
        <p>Each results page shows the automated grade and every check&apos;s verdict from the day of the test. A security finding still counts in the grade, and the page says the grade includes a finding under private disclosure.</p>
        <p>Until a fix or day 90, the page leaves out what would help someone use the finding: the evidence, the tools involved, the details of the other security checks in the same test area, and the command that repeats our run. The badge stays, and its tooltip says the same thing.</p>
        <p>Sealmark and its checks are open source, so anyone can run the same tests on a public server. We do not claim the steps are secret; we only keep our own results from pointing at the problem before the maintainer can fix it.</p>
        <p>A partial on tool poisoning with only weak, inconclusive indicators, or on read-only honesty when only cache files changed, is a weak signal, not a finding. Those are shown in full.</p>

        <h2 className={s.packhead}>A verdict you think is wrong</h2>
        <p>Reply on the GitHub issue or the private report, or email disclosure@sealmark.dev with the server and the version. We re-test, correct the page if we were wrong, and add your reply. A fixed version can be re-graded at any time, and maintainers can ask for their server to be removed.</p>

        <p>Running Sealmark on a server you do not maintain? See <Link href="/docs/disclosure/">the docs page</Link> on sharing a result you found yourself.</p>
      </main>
      <Footer />
    </>
  );
}
