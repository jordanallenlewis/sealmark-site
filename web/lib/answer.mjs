// Answer-style summary and JSON-LD for a results page (site#64): the few sentences an assistant or a search engine can
// quote for "what grade did <server> get", and the same facts as schema.org data. Pure functions, no I/O: covered by
// lib/answer.test.mjs; scripts/api-check.mjs (rule 11, through answerPageProblems) checks every built page.
//
// Every fact here is one the page already shows: the overall grade exactly as the page heads it (gradeOf in
// lib/api-data.ts), the graded test areas, the coverage sentence, the verdict counts of the check tables, the date and
// the Sealmark version. Nothing is derived that the page does not say: no score, no ranking, no per-tool grade, no
// numeric rating (a letter grade is not stars). No check summary, start command or config hash goes in, so a server
// with a finding under private disclosure gives away nothing more here than on its page.

const WORDS = { pass: "passed", fail: "failed", part: "partial", inconclusive: "inconclusive", na: "not applicable" };
const ORDER = ["pass", "fail", "part", "inconclusive", "na"];
const PRIVATE = "includes a finding under private disclosure";

const plural = (n, one, other) => `${n} ${n === 1 ? one : other}`;
const list = (items) => (items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** Verdict counts in page order; unknown verdicts are counted under their own name so the total stays true. */
export function verdictCounts(checks) {
  const n = new Map();
  for (const c of Array.isArray(checks) ? checks : []) {
    const v = typeof c?.verdict === "string" ? c.verdict : "unknown";
    n.set(v, (n.get(v) ?? 0) + 1);
  }
  const known = ORDER.filter((v) => n.has(v)).map((v) => ({ verdict: v, count: n.get(v) }));
  const other = [...n.keys()].filter((v) => !ORDER.includes(v)).sort().map((v) => ({ verdict: v, count: n.get(v) }));
  return [...known, ...other];
}

/**
 * @param {{
 *   name: string, version: string, testedAt: string, sealmark: string, standard: boolean,
 *   grade: { letter: string, provisional: boolean } | null,   // gradeOf(x): the page heading's grade
 *   areas: { label: string, letter: string }[],              // graded test areas, page order
 *   coverage: { kind: string, text: string },                 // coverageNote(x, ...)
 *   checks: { verdict: string }[],
 *   held: boolean,                                           // any finding under private disclosure
 * }} a
 * @returns {string} plain text, sentences only
 */
export function answerSummary(a) {
  const who = `${a.name} ${a.version}`;
  const out = [];
  if (a.coverage.kind === "no-tools") {
    out.push(`In Sealmark's automated test on ${a.testedAt}, ${who} declared no tools under default settings, so it has no grade.`);
  } else if (!a.grade) {
    out.push(`Sealmark's automated test of ${who} on ${a.testedAt} graded no test area, so it has no grade.`);
  } else {
    const areas = a.areas.map((p) => `${p.label.toLowerCase()} ${p.letter}`);
    const g = `${a.grade.letter}${a.grade.provisional ? " (provisional)" : ""}`;
    out.push(`Sealmark's automated test of ${who} on ${a.testedAt} gave it grade ${g}, its lowest test-area grade (${list(areas)}).`);
    out.push(a.coverage.text);
  }
  const counts = verdictCounts(a.checks);
  const total = counts.reduce((s, c) => s + c.count, 0);
  if (total > 0) out.push(`Of its ${plural(total, "check", "checks")}, ${list(counts.map((c) => `${c.count} ${WORDS[c.verdict] ?? c.verdict}`))}.`);
  out.push(`The run used Sealmark ${a.sealmark} with ${a.standard ? "the standard settings" : "custom settings"}.`);
  if (a.held) out.push(a.grade ? `The grade ${PRIVATE}; it still counts in full.` : "A security finding is being reported to the maintainer privately.");
  return out.join(" ");
}

/**
 * schema.org JSON-LD for a results page: a Dataset (the page's results, with the per-server JSON file as its download)
 * about the server as a SoftwareApplication, and the breadcrumb. Not a Review: a rating there must be a number, and a
 * letter grade turned into a number would be a new grade.
 * @param {{
 *   site: string, page: string, json: string, list: string,
 *   name: string, version: string, testedAt: string,
 *   grade: { letter: string, provisional: boolean } | null,
 *   areas: { label: string, letter: string }[],
 *   checks: { verdict: string }[],
 *   summary: string,
 * }} a
 */
export function serverJsonLd(a) {
  const prop = (name, value) => ({ "@type": "PropertyValue", name, value });
  const measured = [
    ...(a.grade ? [prop("Overall grade", a.grade.provisional ? `${a.grade.letter} (provisional)` : a.grade.letter)] : []),
    ...a.areas.map((p) => prop(`${p.label} grade`, p.letter)),
    ...verdictCounts(a.checks).map((c) => prop(`Checks ${WORDS[c.verdict] ?? c.verdict}`, c.count)),
  ];
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Dataset",
        "@id": `${a.page}#results`,
        name: `Sealmark conformance results for ${a.name} ${a.version}`,
        description: a.summary,
        url: a.page,
        dateModified: a.testedAt,
        isAccessibleForFree: true,
        creator: { "@type": "Organization", name: "Sealmark", url: a.site },
        measurementTechnique: "Automated behavioral conformance test with the Sealmark CLI: fixed inputs, no language model",
        variableMeasured: measured,
        about: { "@type": "SoftwareApplication", name: a.name, softwareVersion: a.version, applicationCategory: "DeveloperApplication" },
        distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: a.json }],
        includedInDataCatalog: { "@type": "DataCatalog", name: "Sealmark results", url: a.list },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Results", item: a.list },
          { "@type": "ListItem", position: 2, name: a.name, item: a.page },
        ],
      },
    ],
  };
}

// The page's text the way React writes it (entities decoded, tags dropped).
const text = (html) => html.replace(/<!--.*?-->/gs, "").replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/**
 * What api-check rule 11 checks on a built results page: exactly one Dataset in its JSON-LD, for this page, whose
 * overall grade is the page heading's (none when the heading shows none), whose description is the summary paragraph
 * word for word, and which carries none of the server's withheld text.
 * @param {string} html out/results/<id>/index.html
 * @param {{ page: string, grade: { letter: string, provisional: boolean } | null, withheld: string[] }} want
 * @returns {string[]} problems, empty when the page is fine
 */
export function answerPageProblems(html, want) {
  const out = [];
  const blocks = [...String(html).matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const nodes = [];
  for (const b of blocks) {
    let doc;
    try { doc = JSON.parse(b); } catch { out.push("a JSON-LD block does not parse"); continue; }
    for (const n of Array.isArray(doc["@graph"]) ? doc["@graph"] : [doc]) nodes.push({ n, raw: b });
  }
  const sets = nodes.filter(({ n }) => n["@type"] === "Dataset");
  if (sets.length !== 1) return [...out, `${sets.length} Dataset nodes, want 1`];
  const { n: d, raw } = sets[0];
  if (d.url !== want.page) out.push(`Dataset url ${d.url}, page ${want.page}`);
  const overall = (Array.isArray(d.variableMeasured) ? d.variableMeasured : []).filter((p) => p?.name === "Overall grade");
  const expect = want.grade ? `${want.grade.letter}${want.grade.provisional ? " (provisional)" : ""}` : null;
  if (expect === null && overall.length) out.push(`Dataset gives grade ${overall[0].value}, page shows none`);
  if (expect !== null && (overall.length !== 1 || overall[0].value !== expect)) out.push(`Dataset gives grade ${overall[0]?.value ?? "none"}, page heads ${expect}`);
  const p = String(html).match(/<p[^>]*data-answer=""[^>]*>([\s\S]*?)<\/p>/);
  if (!p) out.push("no summary paragraph (data-answer)");
  else if (text(p[1]).trim() !== d.description) out.push("Dataset description differs from the summary paragraph");
  for (const t of want.withheld) if (t && (raw.includes(t) || raw.includes(JSON.stringify(t).slice(1, -1)))) out.push("withheld text in the JSON-LD");
  return out;
}
