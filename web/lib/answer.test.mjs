// node --test lib/   (npm test in web/)
// Answer-style summary and JSON-LD on results pages (site#64).
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerPageProblems, answerSummary, serverJsonLd, verdictCounts } from "./answer.mjs";

const COVERED = { kind: "covered", text: "Tools reached with a valid call: 3 of 4." };
const base = (over = {}) => ({
  name: "acme-mcp", version: "1.2.0", testedAt: "2026-11-15", sealmark: "1.0.1", standard: true,
  grade: { letter: "C", provisional: false },
  areas: [{ label: "Protocol", letter: "A" }, { label: "Network", letter: "C" }],
  coverage: COVERED,
  checks: [{ verdict: "pass" }, { verdict: "pass" }, { verdict: "fail" }, { verdict: "na" }],
  held: false,
  ...over,
});

test("a graded server: grade as the page heads it, every graded area, coverage, verdict counts, version and settings", () => {
  assert.equal(
    answerSummary(base()),
    "Sealmark's automated test of acme-mcp 1.2.0 on 2026-11-15 gave it grade C, its lowest test-area grade (protocol A and network C). " +
      "Tools reached with a valid call: 3 of 4. Of its 4 checks, 2 passed, 1 failed and 1 not applicable. The run used Sealmark 1.0.1 with the standard settings.",
  );
});

test("provisional, one area, three or more areas, custom settings", () => {
  const one = answerSummary(base({ grade: { letter: "B", provisional: true }, areas: [{ label: "Protocol", letter: "B" }], standard: false }));
  assert.match(one, /gave it grade B \(provisional\), its lowest test-area grade \(protocol B\)\./);
  assert.match(one, /with custom settings\.$/);
  const three = answerSummary(base({ areas: [{ label: "Protocol", letter: "A" }, { label: "Network", letter: "C" }, { label: "Effects", letter: "B" }] }));
  assert.match(three, /\(protocol A, network C and effects B\)/);
});

test("the coverage caveat travels with a shallow grade, so a quote can't drop it", () => {
  const hy = { kind: "hygiene", text: "None of the 5 tools could be called with default settings, so this grade covers the handshake and tool metadata only." };
  assert.ok(answerSummary(base({ coverage: hy })).includes(hy.text));
});

test("no tools: no grade, and no coverage sentence that would contradict it", () => {
  const t = answerSummary(base({ grade: null, areas: [], coverage: { kind: "no-tools", text: "The server declared no tools ..." } }));
  assert.match(t, /^In Sealmark's automated test on 2026-11-15, acme-mcp 1\.2\.0 declared no tools under default settings, so it has no grade\./);
  assert.doesNotMatch(t, /grade [A-F]/);
  assert.doesNotMatch(t, /declared no tools \.\.\./);
  // even when the data holds a letter for the protocol area, the page heads "No tools to test": the caller passes null
});

test("tools but no graded area: no grade", () => {
  assert.match(answerSummary(base({ grade: null, areas: [] })), /graded no test area, so it has no grade\./);
});

test("a held finding: the page's note, and nothing from any check text", () => {
  const t = answerSummary(base({ held: true }));
  assert.match(t, /The grade includes a finding under private disclosure; it still counts in full\.$/);
  assert.match(answerSummary(base({ held: true, grade: null, areas: [] })), /A security finding is being reported to the maintainer privately\.$/);
});

test("verdict counts: page order, singular, unknown verdicts kept so the total is true, empty list", () => {
  assert.deepEqual(verdictCounts([{ verdict: "na" }, { verdict: "part" }, { verdict: "pass" }, { verdict: "weird" }, {}]), [
    { verdict: "pass", count: 1 }, { verdict: "part", count: 1 }, { verdict: "na", count: 1 }, { verdict: "unknown", count: 1 }, { verdict: "weird", count: 1 },
  ]);
  assert.match(answerSummary(base({ checks: [{ verdict: "inconclusive" }] })), /Of its 1 check, 1 inconclusive\./);
  assert.doesNotMatch(answerSummary(base({ checks: [] })), /Of its/);
  assert.deepEqual(verdictCounts(undefined), []);
});

const SITE = "https://sealmark.dev";
const PAGE = `${SITE}/results/acme/`;
const ld = (over = {}) => serverJsonLd({
  site: SITE, page: PAGE, json: `${SITE}/data/v1/servers/acme.json`, list: `${SITE}/results/`,
  name: "acme-mcp", version: "1.2.0", testedAt: "2026-11-15", grade: { letter: "C", provisional: false },
  areas: [{ label: "Protocol", letter: "A" }], checks: [{ verdict: "pass" }, { verdict: "fail" }], summary: "Summary text.", ...over,
});

test("JSON-LD: a Dataset about the server with its download, letter grades as text, never a numeric rating", () => {
  const doc = ld();
  const [d, crumbs] = doc["@graph"];
  assert.equal(d["@type"], "Dataset");
  assert.equal(d.url, PAGE);
  assert.equal(d.description, "Summary text.");
  assert.equal(d.dateModified, "2026-11-15");
  assert.deepEqual(d.about, { "@type": "SoftwareApplication", name: "acme-mcp", softwareVersion: "1.2.0", applicationCategory: "DeveloperApplication" });
  assert.equal(d.distribution[0].contentUrl, `${SITE}/data/v1/servers/acme.json`);
  assert.deepEqual(d.variableMeasured.map((p) => [p.name, p.value]), [["Overall grade", "C"], ["Protocol grade", "A"], ["Checks passed", 1], ["Checks failed", 1]]);
  assert.equal(crumbs["@type"], "BreadcrumbList");
  assert.equal(crumbs.itemListElement[1].item, PAGE);
  const s = JSON.stringify(doc);
  assert.doesNotMatch(s, /ratingValue|aggregateRating|"Review"/);
  // no grade: no overall property at all
  assert.ok(!ld({ grade: null, areas: [] })["@graph"][0].variableMeasured.some((p) => p.name === "Overall grade"));
  assert.equal(ld({ grade: { letter: "B", provisional: true } })["@graph"][0].variableMeasured[0].value, "B (provisional)");
});

const html = (doc, para = "Summary text.") =>
  `<script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Sealmark"}</script>` +
  `<p class="x" data-answer="" data-third-party="">${para}</p>` +
  `<script type="application/ld+json">${JSON.stringify(doc)}</script>`;
const want = (over = {}) => ({ page: PAGE, grade: { letter: "C", provisional: false }, withheld: [], ...over });

test("rule 11 passes a page whose Dataset matches its heading and its summary", () => {
  assert.deepEqual(answerPageProblems(html(ld()), want()), []);
  assert.deepEqual(answerPageProblems(html(ld({ grade: null })), want({ grade: null })), []);
  // entities in the paragraph are decoded the way React writes them
  assert.deepEqual(answerPageProblems(html(ld({ summary: `Sealmark's "x" & y` }), "Sealmark&#x27;s &quot;x&quot; &amp; y"), want()), []);
});

test("rule 11 fails each way a page can disagree", () => {
  assert.deepEqual(answerPageProblems(html(ld()).replace(/<script type="application\/ld\+json">\{"@context":"https:\/\/schema.org","@graph[\s\S]*$/, ""), want()), ["0 Dataset nodes, want 1"]);
  assert.deepEqual(answerPageProblems(html(ld()) + html(ld()), want()).at(-1), "2 Dataset nodes, want 1");
  assert.deepEqual(answerPageProblems(html(ld()), want({ page: `${SITE}/results/other/` })), [`Dataset url ${PAGE}, page ${SITE}/results/other/`]);
  assert.deepEqual(answerPageProblems(html(ld()), want({ grade: { letter: "D", provisional: false } })), ["Dataset gives grade C, page heads D"]);
  assert.deepEqual(answerPageProblems(html(ld()), want({ grade: { letter: "C", provisional: true } })), ["Dataset gives grade C, page heads C (provisional)"]);
  assert.deepEqual(answerPageProblems(html(ld()), want({ grade: null })), ["Dataset gives grade C, page shows none"]);
  assert.deepEqual(answerPageProblems(html(ld({ grade: null })), want()), ["Dataset gives grade none, page heads C"]);
  assert.deepEqual(answerPageProblems(html(ld(), "Other text."), want()), ["Dataset description differs from the summary paragraph"]);
  assert.deepEqual(answerPageProblems(html(ld()).replace(/data-answer=""/, ""), want()), ["no summary paragraph (data-answer)"]);
  assert.deepEqual(answerPageProblems(html(ld({ summary: "leaks npx secret-start" }), "leaks npx secret-start"), want({ withheld: ["npx secret-start"] })), ["withheld text in the JSON-LD"]);
  assert.deepEqual(answerPageProblems(`<script type="application/ld+json">{nope</script>`, want()), ["a JSON-LD block does not parse", "0 Dataset nodes, want 1"]);
});
