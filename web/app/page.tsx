import Link from "next/link";
import { Hero } from "@/components/Hero";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Reveal, MotionPref } from "@/components/Reveal";
import { Section } from "@/components/home/Section";
import { ResultsTicker } from "@/components/home/ResultsTicker";
import { BELOW_A_COUNT, CRIT_FAIL_COUNT, RESULTS_PUBLIC, SERVER_COUNT } from "@/lib/results";
import { SealWatermark } from "@/components/visuals/SealWatermark";
import { Pipeline } from "@/components/visuals/Pipeline";

export default function Home() {
  return (
    <>
      <MotionPref />
      <SealWatermark />
      <a className="skip" href="#top">Skip to content</a>
      <Nav home />
      <main id="top">
        <Hero />

        {RESULTS_PUBLIC && (
          <Section
            id="results"
            kicker="Results"
            title={<>We tested {SERVER_COUNT} popular MCP servers.</>}
            caption={<>{BELOW_A_COUNT} fell short of an A somewhere. {CRIT_FAIL_COUNT} failed a critical check.</>}
            more={{ href: "/results/", label: "See all results" }}
          >
            <ResultsTicker />
          </Section>
        )}

        <Section
          id="how"
          kicker="How it works"
          title="One run, four steps."
          caption={<>Start your server, call its tools with fixed inputs, read the database yourself, apply the published formula.<span className="subcap">Any MCP server over stdio or HTTP. Database checks: Postgres and SQLite today; DuckDB <span className="planned">planned</span>.</span></>}
          more={{ href: "/docs/quickstart/", label: "Read the docs" }}
        >
          <Pipeline compact caption="One start for core, one per database role for db. No model in the loop." />
        </Section>

        <section className="band final gutter" id="start">
          <div className="frame">
            <Reveal className="finalbox">
              <h2>Find out what it really does.</h2>
              <p>Free, every check, no account. Apache-2.0.</p>
              <div className="finalrow">
                <Link className="btn solid" href="/docs/quickstart/">Quickstart</Link>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
