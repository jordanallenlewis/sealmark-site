import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { RESULTS_PUBLIC } from "@/lib/results";
import { MIN_SERVERS } from "@/lib/topics.mjs";
import { allTopicPages, topicTitle } from "@/lib/topics-data";
import { DisputeNote } from "../DisputeNote";
import s from "../results.module.css";

export const metadata: Metadata = {
  title: "Best graded MCP servers by topic | Sealmark",
  description: "Public MCP servers Sealmark graded, grouped by what they are for (databases, browser automation, payments, memory and more) and ranked by grade.",
  alternates: { canonical: "/results/topics/" },
};

export default function TopicsPage() {
  if (!RESULTS_PUBLIC) notFound();
  const pages = allTopicPages();
  return (
    <>
      <Nav />
      <main id="main" className={`gutter ${s.wrap}`}>
        <p className={s.crumb}><Link href="/results/">Results</Link> / Topics</p>
        <h1 className={s.h1}>Best graded MCP servers by topic</h1>
        <p className={s.lede}>
          The graded servers, grouped by what they are for and ranked by grade, with the servers graded beyond the protocol first. A server joins a topic by a fixed rule: it was graded in the matching test area, or its package keywords, name or description use one of the topic&rsquo;s words. Each row says which. A topic is listed once it has {MIN_SERVERS} graded servers.
        </p>
        <ul className={s.topicList}>
          {pages.map((t) => {
            const deep = t.rows.filter((r) => r.areas.length > 0).length;
            return (
              <li key={t.id}>
                <Link href={`/results/topics/${t.id}/`}>{topicTitle(t)}</Link>
                <span className={s.muted}>{t.rows.length} graded servers, {deep} beyond the protocol</span>
              </li>
            );
          })}
        </ul>
        <DisputeNote />
      </main>
      <Footer />
    </>
  );
}
