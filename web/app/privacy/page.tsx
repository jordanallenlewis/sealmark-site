import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import s from "../results/results.module.css";

// What sealmark.dev records about visits (components/VisitBeacon.tsx, worker/visits.mjs, worker/migrations/0003_visits.sql).
// Keep it in step with the visits table.
const DESC = "What sealmark.dev records when you visit: the page, the site that linked you, and campaign tags. No cookies, no IP addresses.";
export const metadata: Metadata = { title: "Privacy | Sealmark", description: DESC, alternates: { canonical: "/privacy/" } };

export default function Page() {
  return (
    <>
      <Nav />
      <main id="main" className={`gutter ${s.wrap}`}>
        <h1 className={s.h1}>Privacy</h1>
        <p className={s.lede}>sealmark.dev counts page views to learn which links bring people here. That is all it records about a visit.</p>

        <h2 className={s.packhead}>What is recorded</h2>
        <ul>
          <li>The page you opened, and the time to the minute.</li>
          <li>On the first page of a visit: the name of the site that linked you (for example news.ycombinator.com, never the full address), and the <code>utm_source</code>, <code>utm_medium</code> and <code>utm_campaign</code> tags if the link had them.</li>
        </ul>
        <p>No cookies, and nothing is stored on your device. No IP address, not even a hashed one, no browser details and no location. Two page views cannot be tied to the same person. No third-party analytics or ads. Records are deleted after a year.</p>

        <h2 className={s.packhead}>Not counted</h2>
        <p>Browsers that send Global Privacy Control or Do Not Track, automated browsers, and known crawlers are not counted.</p>

        <h2 className={s.packhead}>Grade alerts</h2>
        <p>If you ask for grade-change emails, what that stores is on <Link href="/notify/">its own page</Link>.</p>
      </main>
      <Footer />
    </>
  );
}
