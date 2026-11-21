import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { ReportViewer } from "./ReportViewer";
import s from "./report.module.css";

export const metadata: Metadata = {
  title: "Open a Sealmark report in your browser | Sealmark",
  description: "Open a Sealmark JSON report from a file, a paste or a share link. The report is read in your browser and never uploaded.",
  alternates: { canonical: "/report/" },
};

export default function ReportPage() {
  return (
    <>
      <Nav />
      <main id="main" className={`gutter ${s.wrap}`}>
        <h1 className={s.h1}>Open a report</h1>
        <p className={s.lede}>
          Read a Sealmark report as a page: each pack&rsquo;s grade, every check with its evidence. The report is read in your browser. Nothing is uploaded or stored, and a share link keeps the report in the part of the address after the <code>#</code>, which your browser never sends to a server.
        </p>
        <ReportViewer />
        <p className={s.note}>
          Make a share link with <code>sealmark share report.json</code>, or write a report with <code>sealmark run --format json</code>. A report can hold paths, tool names and server output: read it before you send the link. See the <Link href="/docs/reference/cli/">CLI reference</Link>.
        </p>
      </main>
      <Footer />
    </>
  );
}
