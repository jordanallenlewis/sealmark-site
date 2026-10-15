// Builds public/docs-index.json for the docs search (work package D1).
//   node scripts/docs-index.mjs        (npm run docs:index; npm run build runs it too)
//
// Entry shape, one per h2 section of every page:
//   { url, title, group, section, headings[], text, status }
//   url      absolute path with a trailing slash and, for a section, #heading-slug
//   title    the page title
//   section  the h2 text ("" for the part before the first h2)
//   headings the h3/h4 texts inside the section
//   text     plain text of the section, at most 2,000 characters
// Sources: content/docs/**/*.mdx (including the prose companions of the generated reference pages), plus
// content/generated/{checks,config,cli}.json (written by docs:gen from the built CLI), because those reference pages are rendered
// from JSON and have no MDX of their own.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(web, "content", "docs");
const genDir = join(web, "content", "generated");
const outFile = join(web, "public", "docs-index.json");
const MAX_TEXT = 2000;
const MAX_BYTES = 200 * 1024; // plan section 7.5 acceptance

const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback);

// ---- nav: url -> group / status ----
const nav = readJson(join(docsDir, "_nav.json"), []);
const navItems = nav.flatMap((g) => g.items.map((i) => ({ ...i, group: g.group, key: i.url.replace(/\/+$/, "") || "/" })));
const groupFor = (url) => {
  const key = url.replace(/\/+$/, "");
  const hit = navItems.filter((i) => key === i.key || key.startsWith(i.key + "/")).sort((a, b) => b.key.length - a.key.length)[0];
  if (hit) return hit.group;
  const seg = key.split("/")[2];
  return seg ? seg[0].toUpperCase() + seg.slice(1) : "Docs";
};
const statusFor = (url) => navItems.find((i) => i.key === url.replace(/\/+$/, ""))?.status;

// ---- text helpers ----
const trim = (s) => s.replace(/\s+/g, " ").trim();
const cut = (s) => {
  const t = trim(s);
  if (t.length <= MAX_TEXT) return t;
  const c = t.slice(0, MAX_TEXT);
  return c.slice(0, Math.max(c.lastIndexOf(" "), MAX_TEXT - 40));
};
/** A shorter cut, for the reference entries: there are hundreds of them, and the full text is on the page. */
const cutTo = (s, n) => {
  const t = trim(s);
  return t.length <= n ? t : t.slice(0, n).replace(/\s\S*$/, "");
};
const HTML_TAGS = "a|abbr|b|br|code|dd|details|div|dl|dt|em|figure|figcaption|i|kbd|li|ol|p|pre|small|span|strong|sub|summary|sup|table|tbody|td|th|thead|tr|u|ul";
const TAG_RE = new RegExp(`</?(?:[A-Z][A-Za-z0-9.]*|${HTML_TAGS})(?:\\s[^<>]*)?/?>`, "g");

/** Markdown/JSX line to plain words. Tags written in prose, such as <id>, are kept. */
function plain(line) {
  return line
    .replace(TAG_RE, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+/g, "")
    .replace(/(\*\*|__|\*|~~)/g, "")
    .replace(/^\s*>\s?/, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, "")
    .replace(/^\s*\|?[\s:|-]+\|?\s*$/, "") // table separator row
    .replace(/\|/g, " ");
}

/** Same slugs as rehype-slug (github-slugger): lower case, punctuation dropped, spaces to hyphens, repeats get -1, -2. */
function makeSlugger() {
  const occ = new Map();
  return (text) => {
    const base = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "").replace(/ /g, "-");
    let slug = base;
    while (occ.has(slug)) {
      occ.set(base, occ.get(base) + 1);
      slug = `${base}-${occ.get(base)}`;
    }
    occ.set(slug, 0);
    return slug;
  };
}

function pick(block, key) {
  const m = block.match(new RegExp(`\\b${key}\\s*:\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')`));
  if (!m) return undefined;
  try {
    return m[1][0] === '"' ? JSON.parse(m[1]) : m[1].slice(1, -1);
  } catch {
    return m[1].slice(1, -1);
  }
}

function parseMdx(file, url) {
  let src = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const metaBlock = src.match(/export\s+const\s+meta\s*=\s*\{[\s\S]*?\n\};?/)?.[0] ?? "";
  src = src.replace(metaBlock, "");
  const title = pick(metaBlock, "title") ?? url.split("/").filter(Boolean).pop() ?? "Docs";
  const status = pick(metaBlock, "status") ?? statusFor(url) ?? "shipped";

  const slug = makeSlugger();
  const sections = [];
  let cur = { section: "", anchor: "", headings: [], lines: [] };
  const push = () => {
    const text = cut(cur.lines.join(" "));
    if (text || cur.section) sections.push({ ...cur, text });
  };
  let fence = null;
  for (const raw of src.split("\n")) {
    const f = raw.match(/^\s*(```+|~~~+)/);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence) {
      if (raw.trim()) cur.lines.push(raw.trim());
      continue;
    }
    if (/^\s*(import|export)\s/.test(raw)) continue;
    const h = raw.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (h) {
      const text = trim(plain(h[2]));
      const id = slug(text);
      if (h[1].length === 1) continue; // the page title comes from meta
      if (h[1].length === 2) {
        push();
        cur = { section: text, anchor: id, headings: [], lines: [] };
      } else {
        cur.headings.push(text);
        cur.lines.push(text);
      }
      continue;
    }
    const p = plain(raw);
    if (p.trim()) cur.lines.push(p);
  }
  push();
  return sections.map((s) => ({
    url: s.anchor ? `${url}#${s.anchor}` : url,
    title,
    group: groupFor(url),
    section: s.section,
    headings: s.headings,
    text: s.text,
    status,
  }));
}

function walk(dir, rel = []) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith("_") || e.name.startsWith(".")) continue;
    if (e.isDirectory()) out.push(...walk(join(dir, e.name), [...rel, e.name]));
    else if (e.name.endsWith(".mdx")) out.push([...rel, e.name.slice(0, -4)]);
  }
  return out;
}

const urlOf = (parts) => {
  const p = parts[parts.length - 1] === "index" ? parts.slice(0, -1) : parts;
  return "/docs/" + (p.length ? p.join("/") + "/" : "");
};

// ---- entries from MDX ----
const entries = [];
if (existsSync(docsDir)) {
  for (const parts of walk(docsDir).sort((a, b) => a.join("/").localeCompare(b.join("/")))) {
    const file = join(docsDir, ...parts) + ".mdx";
    try {
      const secs = parseMdx(file, urlOf(parts));
      // A check's hand-written companion is rendered as the "Notes" section of the generated check page: one entry for all of it,
      // otherwise the 11 companions alone would take a quarter of the size budget.
      if (parts[0] === "reference" && parts[1] === "checks" && parts.length === 3 && parts[2] !== "index") {
        const base = urlOf(parts);
        entries.push({
          url: `${base}#notes`,
          title: secs[0]?.title ?? parts[2],
          group: groupFor(base),
          section: "Notes",
          headings: secs.map((x) => x.section).filter(Boolean),
          text: cutTo(secs.map((x) => `${x.section} ${x.text}`).join(" "), 700),
          status: secs[0]?.status ?? "shipped",
        });
      } else entries.push(...secs);
    } catch (e) {
      console.error(`docs-index: could not read ${relative(web, file).split(sep).join("/")}: ${e.message}`);
      process.exit(1);
    }
  }
}

// ---- entries from the generated JSON (the reference pages are rendered from it) ----
const checks = readJson(join(genDir, "checks.json"), []);
const config = readJson(join(genDir, "config.json"), []);
const cli = readJson(join(genDir, "cli.json"), { commands: [], flags: [], exitCodes: [] });
const REF = "Reference";
const keyId = (p) => `key-${p.replace(/[^a-zA-Z0-9_]+/g, "-")}`; // same rule as app/docs/reference/ref.tsx

for (const c of checks) {
  const url = `/docs/reference/checks/${c.id}/`;
  const weight = c.critical ? "critical: a fail caps the pack grade at D" : c.advisory ? "advisory: reported, not scored" : "scored";
  // One entry per check: the facts, the probes, the fix and the known false results, cut to fit. The page has the rest.
  entries.push({
    url: `${url}#probes`,
    title: c.id,
    group: REF,
    section: c.label,
    headings: ["Probes", "Settings and thresholds", "What to fix", "False positives", "False negatives"],
    text: cutTo([`${c.pack} pack`, weight + (c.candidate ? ", candidate" : ""), c.scope, ...(c.probes || []).map((p) => `${p.id}: ${p.text}`), c.remediation, c.falsePositive, c.falseNegative].filter(Boolean).join(". "), 640),
    status: c.status || "shipped",
  });
}
for (const k of config) {
  // checks.<id>.* keys (enabled, severity, thresholds, corpus additions) are listed on the check's own page, which is indexed above.
  if (k.path.startsWith("checks.")) continue;
  entries.push({
    url: `/docs/reference/configuration/#${keyId(k.path)}`,
    title: "Configuration",
    group: REF,
    section: k.path,
    headings: [],
    text: cutTo(`${k.type}. ${k.description}. default ${typeof k.default === "string" ? k.default : JSON.stringify(k.default ?? "none")}. since ${k.since}`, 150),
    status: "shipped",
  });
}
for (const c of cli.commands || []) {
  entries.push({ url: `/docs/reference/cli/#cmd-${c.name}`, title: "CLI", group: REF, section: `sealmark ${c.name}`, headings: [], text: cut(`${c.summary} ${c.usage}`), status: "shipped" });
}
for (const f of cli.flags || []) {
  entries.push({
    url: `/docs/reference/cli/#flag-${f.name.replace(/^-+/, "").replace(/[^a-z0-9]+/gi, "-")}`,
    title: "CLI",
    group: REF,
    section: f.name,
    headings: [],
    text: cutTo(`${f.doc} ${f.type}. commands ${(f.commands || []).join(", ")}`, 170),
    status: "shipped",
  });
}
if ((cli.exitCodes || []).length) {
  entries.push({ url: "/docs/reference/cli/#exit-codes", title: "CLI", group: REF, section: "Exit codes", headings: [], text: cut(cli.exitCodes.map((e) => `exit ${e.code}: ${e.meaning}`).join(" ")), status: "shipped" });
}

// Stay under the size limit by shortening section text, longest first, instead of failing the build.
let json = JSON.stringify(entries);
let cap = MAX_TEXT;
for (const next of [1400, 1000, 700, 500, 400]) {
  if (Buffer.byteLength(json) <= MAX_BYTES) break;
  cap = next;
  json = JSON.stringify(entries.map((e) => (e.text.length > cap ? { ...e, text: e.text.slice(0, cap).replace(/\s\S*$/, "") } : e)));
}
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, json);
const bytes = Buffer.byteLength(json);
console.log(`docs-index: ${entries.length} sections, ${(bytes / 1024).toFixed(1)} KB -> public/docs-index.json` + (cap < MAX_TEXT ? ` (section text shortened to ${cap} characters to fit ${MAX_BYTES / 1024} KB)` : ""));
if (bytes > MAX_BYTES) {
  console.error(`docs-index: ${bytes} bytes is over the ${MAX_BYTES} byte limit even with short text`);
  process.exit(1);
}
