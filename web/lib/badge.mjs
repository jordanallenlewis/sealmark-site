// Badge files for servers the fleet grades, written at build time under /badge/ (app/badge/[file]/route.ts):
//   <id>.svg        the flat badge (label | per-area message), coloured by the server's grade (its lowest area)
//   <id>-card.svg   a larger card: server name, the server grade, the per-area letters, version and test date
//   <id>.json       a shields.io endpoint document (https://shields.io/endpoint), the same text as the flat badge
// Which servers get a badge and which letter it shows are decided elsewhere (serverBadge in lib/seo.ts, badgeEligible
// in worker/notify-core.mjs). This file only draws what it is given, so nothing here can move a grade.

export const ORIGIN = "https://sealmark.dev";

const HEX = { A: "#2ea44f", B: "#4c9f38", C: "#c7a400", D: "#d9822b", F: "#d73a49" };
// The same named colours the CLI's --format shields uses, so a self-reported badge and a sealmark.dev one match.
const SHIELDS = { A: "brightgreen", B: "green", C: "yellow", D: "orange", F: "red" };

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const alt = (label, message, note) => `${label}: ${message}${note ? ` (${note})` : ""}`;
// Text wider than `max` characters ends in an ellipsis; the full text stays in the SVG's <title> and aria-label.
export const clip = (t, max) => (t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`);

export function badgeSvg(label, message, letter, note) {
  const w = (t) => Math.round(t.length * 6.4 + 14);
  const lw = w(label), mw = w(message), tot = lw + mw;
  const a = esc(alt(label, message, note));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tot}" height="20" role="img" aria-label="${a}"><title>${a}</title><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${mw}" height="20" fill="${HEX[letter]}"/><g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle"><text x="${lw / 2}" y="14">${esc(label)}</text><text x="${lw + mw / 2}" y="14">${esc(message)}</text></g></svg>`;
}

// card: { name, version, testedAt, message, letter, note }
// Clip lengths are sized for the 420 px card in Verdana: name 30 chars at 14 px bold, message 44 at 11 px, the
// version 12 so the 10 px line fits; checked by rendering the longest real names. Wide glyphs (WWW...) can still
// run long, so the text group is clipped 12 px inside the card's right edge.
export function badgeCardSvg({ name, version, testedAt, message, letter, note }) {
  const W = 420, H = 84;
  const title = esc(`sealmark: ${name} ${version}, grade ${letter}: ${message}, tested ${testedAt}${note ? ` (${note})` : ""}`);
  const sub = `${clip(String(version), 12)} · tested ${testedAt}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}"><title>${title}</title>`
    + `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="8" fill="#16181d" stroke="#3a3f4b"/>`
    + `<rect x="12" y="12" width="60" height="60" rx="6" fill="${HEX[letter]}"/>`
    + `<text x="42" y="56" fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="34" font-weight="700" text-anchor="middle">${letter}</text>`
    + `<clipPath id="t"><rect x="86" y="0" width="${W - 98}" height="${H}"/></clipPath>`
    + `<g clip-path="url(#t)" font-family="Verdana,DejaVu Sans,sans-serif"><text x="86" y="28" fill="#f2f3f5" font-size="14" font-weight="700">${esc(clip(name, 30))}</text>`
    + `<text x="86" y="48" fill="#c9cdd4" font-size="11">${esc(clip(message, 44))}</text>`
    + `<text x="86" y="66" fill="#9aa1ad" font-size="10">${esc(sub)} · sealmark.dev</text></g></svg>`;
}

export function shieldsDoc(label, message, letter) {
  return { schemaVersion: 1, label, message, color: SHIELDS[letter] };
}

// Copy-paste snippets for one server. Each links the image to the server's results page.
export function badgeSnippets(id) {
  const page = `${ORIGIN}/results/${id}/`;
  const svg = `${ORIGIN}/badge/${id}.svg`;
  const card = `${ORIGIN}/badge/${id}-card.svg`;
  const shields = `https://img.shields.io/endpoint?url=${encodeURIComponent(`${ORIGIN}/badge/${id}.json`)}`;
  const set = (img) => ({
    markdown: `[![Sealmark](${img})](${page})`,
    html: `<a href="${page}"><img src="${img}" alt="Sealmark"></a>`,
    rst: `.. image:: ${img}\n   :target: ${page}\n   :alt: Sealmark`,
  });
  return { page, urls: { svg, card, shields, json: `${ORIGIN}/badge/${id}.json` }, badge: set(svg), card: set(card), shields: set(shields) };
}

// Every file under /badge/ for the eligible servers: [{ file, kind, id }]. Server ids are [a-z0-9-], so a server
// "x-card" next to a server "x" would want the same "x-card.svg": the build stops rather than serve one for the other.
export function badgeFiles(ids) {
  const files = ids.flatMap((id) => [{ file: `${id}.svg`, kind: "svg", id }, { file: `${id}-card.svg`, kind: "card", id }, { file: `${id}.json`, kind: "json", id }]);
  const seen = new Set();
  for (const f of files) {
    if (seen.has(f.file)) throw new Error(`badge file ${f.file} would serve two servers; rename one id`);
    seen.add(f.file);
  }
  return files;
}
