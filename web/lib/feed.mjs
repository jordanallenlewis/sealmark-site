// Atom feeds of grade changes (site#59): /results/feed.xml for every server and /results/<id>/feed.xml for one.
// Pure functions, no I/O: covered by lib/feed.test.mjs; the routes build them from lib/api.mjs changesDoc.
//
// A feed entry is a public claim that someone else's server changed grade, so it follows the results list's change rule
// (lib/results-view.mjs gradeChange, review on site#93): only a move in the overall grade that came with a new server
// version under the same, known Sealmark version. A move that came with a Sealmark upgrade, an unknown Sealmark version
// or no new server version says nothing certain about the server, and a server with a held finding is left out (its
// entry could not carry the page's private-finding note). Dates come from the data, never the build clock, so an
// unchanged feed stays byte-identical between builds.

const RANK = { A: 1, B: 1, C: 1, D: 1, F: 1 };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (v) => typeof v === "string" && v.length > 0 && v.length <= 64;

/**
 * @param {any[] | undefined} changes changesDoc(...).changes
 * @param {(id: string) => boolean} isHeld true for a server with a held (private) finding
 */
export function feedChanges(changes, isHeld) {
  const out = (Array.isArray(changes) ? changes : []).filter((c) =>
    c && typeof c === "object" && typeof c.id === "string" && typeof c.page === "string" && DAY.test(String(c.date)) &&
    Object.hasOwn(RANK, c.from) && Object.hasOwn(RANK, c.to) && c.from !== c.to &&
    text(c.sealmark) && c.sealmark === c.previousSealmark &&
    text(c.version) && text(c.previousVersion) && c.version !== c.previousVersion &&
    !isHeld(c.id));
  return out.sort((a, b) => b.date.localeCompare(a.date) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * @param {any} c a change kept by feedChanges
 * @param {(pack: string) => string} label test area label ("core" -> "Protocol")
 */
export function changeEntry(c, label) {
  const areas = Object.entries(c.packs ?? {})
    .filter(([, v]) => v && typeof v === "object")
    .map(([k, v]) => (v.from == null ? `${label(k)} newly graded ${v.to}` : v.to == null ? `${label(k)} not graded this time (was ${v.from})` : `${label(k)} ${v.from} to ${v.to}`));
  const summary = [
    `${c.name || c.id} moved from grade ${c.from} to ${c.to} on ${c.date}, with a new server version ${c.version} (was ${c.previousVersion}), tested with Sealmark ${c.sealmark}, the same version as the run before.`,
    areas.length ? `Test areas: ${areas.join("; ")}.` : "",
    "A grade covers one version under the standard settings; it is not an endorsement. The page has the evidence.",
  ].filter(Boolean).join(" ");
  return {
    id: `${c.page}#change-${c.date}-${encodeURIComponent(c.previousVersion)}-${encodeURIComponent(c.version)}`,
    title: `${c.name || c.id}: grade ${c.from} to ${c.to}`,
    url: c.page,
    updated: `${c.date}T00:00:00Z`,
    summary,
  };
}

// Escape for XML text and attributes, and drop characters XML 1.0 cannot carry (C0 controls other than tab, newline and
// carriage return, lone surrogates, U+FFFE and U+FFFF): third-party names reach the feed.
export function xmlText(v) {
  return String(v ?? "")
    .replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * @param {{ id: string, title: string, subtitle?: string, self: string, page: string, updated: string, entries: ReturnType<typeof changeEntry>[] }} f
 */
export function atomFeed(f) {
  const e = xmlText;
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${e(f.id)}</id>`,
    `  <title>${e(f.title)}</title>`,
    ...(f.subtitle ? [`  <subtitle>${e(f.subtitle)}</subtitle>`] : []),
    `  <link rel="self" type="application/atom+xml" href="${e(f.self)}"/>`,
    `  <link rel="alternate" type="text/html" href="${e(f.page)}"/>`,
    `  <updated>${e(f.updated)}</updated>`,
    "  <author><name>Sealmark</name></author>",
    ...f.entries.flatMap((x) => [
      "  <entry>",
      `    <id>${e(x.id)}</id>`,
      `    <title>${e(x.title)}</title>`,
      `    <link rel="alternate" type="text/html" href="${e(x.url)}"/>`,
      `    <updated>${e(x.updated)}</updated>`,
      `    <summary>${e(x.summary)}</summary>`,
      "  </entry>",
    ]),
    "</feed>",
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * What api-check rule 9 checks on a built feed: an Atom document whose entries each link to a listed, not-held server
 * page, at most once per entry id. For a per-server feed, every entry links to that server.
 * @param {string} xml
 * @param {string} origin "https://sealmark.dev"
 * @param {Set<string>} listed ids with a results page
 * @param {(id: string) => "held" | "unknown" | null} status from the raw data
 * @param {string} [only] the server id of a per-server feed
 * @returns {string[]}
 */
export function feedProblems(xml, origin, listed, status, only) {
  const out = [];
  const s = String(xml);
  if (!s.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">') || !s.trimEnd().endsWith("</feed>")) return ["not an Atom document"];
  if (!/<updated>\d{4}-\d{2}-\d{2}T00:00:00Z<\/updated>/.test(s)) out.push("no feed <updated>");
  const entries = s.split("<entry>").slice(1);
  const ids = new Set();
  for (const e of entries) {
    const id = e.match(/<id>([^<]*)<\/id>/)?.[1];
    if (!id || ids.has(id)) out.push(`entry id missing or repeated: ${id ?? "(none)"}`);
    ids.add(id);
    const href = e.match(/<link rel="alternate" type="text\/html" href="([^"]*)"\/>/)?.[1] ?? "";
    const m = href.startsWith(`${origin}/results/`) ? href.slice(`${origin}/results/`.length).match(/^([^/]+)\/$/) : null;
    if (!m) { out.push(`entry links outside a server page: ${href}`); continue; }
    const sid = decodeURIComponent(m[1]);
    if (!listed.has(sid)) out.push(`${sid}: entry for a server with no listed page`);
    const st = status(sid);
    if (st === "held") out.push(`${sid}: entry for a server with a security finding`);
    else if (st === "unknown") out.push(`${sid}: not in the raw results data`);
    if (only && sid !== only) out.push(`${sid}: entry in the feed of ${only}`);
  }
  return out;
}
