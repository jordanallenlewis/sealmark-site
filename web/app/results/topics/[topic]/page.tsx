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
  const deep = t.rows.filter((r) => r.areas.length > 0);
  const hygiene = t.rows.filter((r) => r.areas.length === 0);
  return (
    <>
      <Nav />
      <main id="main" className={`gutter ${s.wrap}`}>
        <div className={s.preview}>Automated re-tests: not checked by hand, and not yet reviewed by the maintainers.</div>
        <p className={s.crumb}><Link href="/results/">Results</Link> / <Link href="/results/topics/">Topics</Link> / {t.title}</p>
        <h1 className={s.h1}>{topicTitle(t)}</h1>
        <p className={s.meta}><span>{t.rows.length} graded servers</span>{newest && <span>latest test {newest}</span>}</p>
        <p className={s.lede}>
          Every graded server Sealmark matched to {t.title}: first the ones graded beyond the protocol, then the protocol-only ones, each best grade first (on a tie, more test areas graded, then more valid tool calls).
          A server is listed when {areaWords.length ? `it was graded in ${list(areaWords)} test area, or ` : ""}its package keywords, name or description use one of these words: {list(t.terms.map((w) => `“${w}”`))}.
          A grade covers one version under the standard settings; it is not an endorsement.
        </p>
        {deep.length > 0 && (
          <section className={s.sec} aria-labelledby="deep-h" style={{ marginTop: 40 }}>
            <h2 id="deep-h">Graded beyond the protocol</h2>
            <p>Sealmark gave these servers a target it owns and checked what their tools really did.</p>
            <Rows rows={deep} caption={`${topicTitle(t)}: graded beyond the protocol, best grade first`} />
          </section>
        )}
        {hygiene.length > 0 && (
          <section className={s.sec} aria-labelledby="protocol-h" style={deep.length ? undefined : { marginTop: 40 }}>
            <h2 id="protocol-h">Protocol only</h2>
            <p>Only the protocol test area was graded: the tools were called with invalid input, so the grade is hygiene and says little about what the tools do. Listed after every server graded more deeply, whatever its grade.</p>
            <Rows rows={hygiene} caption={`${topicTitle(t)}: protocol only, best grade first`} />
          </section>
        )}
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
