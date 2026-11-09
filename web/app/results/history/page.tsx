import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GradeHistory } from "@/components/GradeHistory";
import { Nav } from "@/components/Nav";
import { loadHistory } from "@/lib/history";
import { RESULTS_PUBLIC } from "@/lib/results";
import { DisputeNote } from "../DisputeNote";
import s from "../results.module.css";

export const metadata: Metadata = {
  title: "Results over time: Sealmark grade history",
  description: "The worst grade each tracked MCP server got in every fleet re-test, with the version tested and the Sealmark version.",
};

export default function HistoryPage() {
  if (!RESULTS_PUBLIC) notFound();
  const all = loadHistory();
  const last = all.flatMap((h) => h.runs.map((r) => r.date)).sort().at(-1);
  return (
    <>
      <Nav />
      <main id="main" className={`gutter ${s.wrap}`}>
        <p className={s.crumb}><Link href="/results/">Results</Link> / Over time</p>
        <h1 className={s.h1}>How the grades changed</h1>
        <p className={s.lede}>
          Every tracked server is re-tested automatically on fresh machines. Each seal is the worst grade across the suites graded in that run.
          A dash means the server could not be started that day, which says nothing about its grade. Automated re-tests are not checked by hand.
          {last ? ` Latest run: ${last}.` : ""}
        </p>
        {all.map((h) => (
          <section key={h.id} className={s.sec} id={h.id} style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: "1.2rem" }}>{h.linked ? <Link href={`/results/${h.id}/`}>{h.name}</Link> : h.name}</h2>
            <GradeHistory runs={h.runs} label={h.name} />
          </section>
        ))}
        <DisputeNote />
      </main>
    </>
  );
}
