import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import s from "../results/results.module.css";

// The privacy note for the grade-change email alerts (app/results/NotifyForm.tsx, worker/index.js). Keep it in step
// with what worker/migrations stores.
const DESC = "What Sealmark stores when you ask for grade-change emails, when it emails you, and how to stop the emails.";
export const metadata: Metadata = { title: "Grade alerts: what is stored | Sealmark", description: DESC, alternates: { canonical: "/notify/" } };

export default function Page() {
  return (
    <>
      <Nav />
      <main id="main" className={`gutter ${s.wrap}`}>
        <h1 className={s.h1}>Grade alerts</h1>
        <p className={s.lede}>Every server&apos;s results page has a form: leave an address and get one email when that server&apos;s grade changes after a re-test.</p>

        <h2 className={s.packhead}>What is stored</h2>
        <ul>
          <li>Your email address and which server it is for.</li>
          <li>Whether you confirmed, and when you asked, confirmed or stopped.</li>
          <li>A hash of the confirmation link, not the link itself. The link works for 7 days. A sign-up not confirmed within 7 days is deleted, address and all.</li>
          <li>For one hour, a keyed hash of your IP address and of the email address, to limit how often the form can be used. Nothing else about you.</li>
          <li>For each grade email: when it was sent to you, and whether your mail provider accepted it.</li>
        </ul>
        <p>No tracking pixels, no link tracking, no marketing list. The addresses are never shared or sold, and are used only for these emails.</p>

        <h2 className={s.packhead}>When you get an email</h2>
        <ul>
          <li>Once, right away, with a link to confirm. Nothing more is sent unless you open it and press Confirm.</li>
          <li>After that, once each time the server&apos;s letter grade changes in a new version of the server, with what changed and a link to the results.</li>
          <li>No email when the grade moves because Sealmark itself changed how it tests or grades, or when a part of the test could not be settled in one run (the last grade stands until it can). If many servers change at once, emails wait until we have checked the change by hand.</li>
        </ul>

        <h2 className={s.packhead}>How to stop</h2>
        <p>Every grade email has a link to stop them, and mail apps that show an unsubscribe button use the same link. A second link stops every Sealmark alert to your address, for all servers. Or reply to any of the emails and we stop them by hand. Stopped addresses get nothing more for that server.</p>

        <h2 className={s.packhead}>For server owners</h2>
        <p>Sealmark may also open one GitHub issue on a server&apos;s repository when it is first graded, with the grade, the failing checks and a link to this form. It opens at most one per repository; reply &quot;opt out&quot; on it and Sealmark never opens another. A security finding never goes in that issue; it is reported privately under the <Link href="/disclosure/">disclosure policy</Link>.</p>
      </main>
      <Footer />
    </>
  );
}
