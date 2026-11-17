import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Seal } from "@/components/Seal";
import { PACK_LABEL, RESULTS_PUBLIC } from "@/lib/results";
import { PRIVATE_FINDING } from "@/lib/seo";
import { whyText, type TopicRow } from "@/lib/topics.mjs";
import { allTopicPages, topicTitle } from "@/lib/topics-data";
import { DisputeNote } from "../../DisputeNote";
import s from "../../results.module.css";

export const dynamicParams = false;
// With no topic pages (no published results), export one placeholder route; the page answers it with notFound().
export function generateStaticParams() { const p = allTopicPages(); return p.length ? p.map((t) => ({ topic: t.id })) : [{ topic: "pending" }]; }

type P = { params: Promise<{ topic: string }> };
const find = (id: string) => (RESULTS_PUBLIC ? allTopicPages().find((t) => t.id === id) : undefined);
export async function generateMetadata({ params }: P): Promise<Metadata> {
  const t = find((await params).topic);
  return t
    ? { title: `${topicTitle(t)} | Sealmark`, description: `${t.rows.length} public MCP servers for ${t.title}, ranked by the grade Sealmark gave them after calling their tools, with the date each was tested.`, alternates: { canonical: `/results/topics/${t.id}/` } }
    : { title: "Results" };
}

const label = (id: string) => PACK_LABEL[id] ?? id;
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}`);

function Rows({ rows, caption }: { rows: TopicRow[]; caption: string }) {
  return (
    <div className={`${s.tw} ${s.twCards}`} tabIndex={0} role="region" aria-label={caption}>
      <table className={s.topicTable}>
        <caption className="sr-only">{caption}</caption>
        <thead><tr><th scope="col">#</th><th scope="col">Server</th><th scope="col">Grade</th><th scope="col">Test areas graded</th><th scope="col">Tested</th><th scope="col">Why it is listed</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td className={s.num}>{i + 1}</td>
              <td className={s.srv} data-third-party=""><Link href={`/results/${r.id}/`}>{r.name}</Link></td>
              <td>
                <Seal g={r.letter} prov={r.provisional} />
                {r.held && <small className={s.heldNote}>The grade {PRIVATE_FINDING}.</small>}
              </td>
              <td data-label="Test areas graded">{r.areas.length ? r.areas.map(label).join(", ") : <span className={s.muted}>Protocol only</span>}</td>
              <td className={s.num} data-label="Tested">{r.testedAt}</td>
              <td className={s.muted} data-label="Why it is listed">{whyText(r.why, label)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function TopicPage({ params }: P) {
  const t = find((await params).topic);
  if (!t) notFound();
  const newest = t.rows.map((r) => r.testedAt).sort().at(-1);
  const others = allTopicPages().filter((o) => o.id !== t.id);
  const areaWords = t.areas.map((a) => `the ${label(a)}`);
  const tiers = [0, 1, 2].map((n) => t.rows.filter((r) => r.tier === n));
  const areaNames = list(t.areas.map(label));
  const TIER = [
    { h: `Graded in the ${areaNames} test area${t.areas.length > 1 ? "s" : ""}`, p: "Sealmark gave these servers a target of this kind that it owns, called their tools and checked what changed on it. Each server’s page says how many of its tools were reached." },
    { h: "Graded beyond the protocol", p: "At least one test area beyond the protocol was graded, often only Effects (which runs on most servers), and often for only some of the tools. Each server’s page says what was covered." },
    { h: "Protocol only", p: "Only the protocol test area was graded: the tools were called with invalid input, so the grade is hygiene and says little about what the tools do. Listed after every server graded more deeply, whatever its grade." },
  ];
  const firstTier = tiers.findIndex((rows) => rows.length > 0);
  return (
    <>
      <Nav />
      <main id="main" className={`gutter ${s.wrap}`}>
        <div className={s.preview}>Automated re-tests: not checked by hand, and not yet reviewed by the maintainers.</div>
        <p className={s.crumb}><Link href="/results/">Results</Link> / <Link href="/results/topics/">Topics</Link> / {t.title}</p>
        <h1 className={s.h1}>{topicTitle(t)}</h1>
        <p className={s.meta}><span>{t.rows.length} graded servers</span>{newest && <span>latest test {newest}</span>}</p>
        <p className={s.lede}>
          Every graded server Sealmark matched to {t.title}, grouped by how much was tested, deepest first, and ranked within each group by grade (on a tie: a firm grade before a provisional one, then more test areas graded, then more valid tool calls).
          A server is listed when {areaWords.length ? `it was graded in ${list(areaWords)} test area, or when ` : ""}its declared package keywords or GitHub topics, or its name, use one of these words: {list(t.terms.map((w) => `“${w}”`))}.
          A grade covers one version under the standard settings; it is not an endorsement.
        </p>
        {tiers.map((rows, n) => {
          if (!rows.length) return null;
          return (
            <section key={n} className={s.sec} aria-labelledby={`tier-${n}`} style={n === firstTier ? { marginTop: 40 } : undefined}>
              <h2 id={`tier-${n}`}>{TIER[n].h}</h2>
              <p>{TIER[n].p}</p>
              <Rows rows={rows} caption={`${topicTitle(t)}: ${TIER[n].h.toLowerCase()}, best grade first`} />
            </section>
          );
        })}
        {others.length > 0 && (
          <section className={s.sec} aria-labelledby="other-topics">
            <h2 id="other-topics">Other topics</h2>
            <ul className={s.topicList}>
              {others.map((o) => <li key={o.id}><Link href={`/results/topics/${o.id}/`}>{o.title}</Link><span className={s.muted}>{o.rows.length} graded servers</span></li>)}
            </ul>
          </section>
        )}
        <DisputeNote />
      </main>
      <Footer />
    </>
  );
}
