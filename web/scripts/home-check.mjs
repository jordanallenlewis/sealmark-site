// node scripts/home-check.mjs   (run by npm run build after the page budget; also fine to run alone after next build)
//
// Guards the 2026-10-08 home page simplification and the copy policy, on the built output in out/:
//   1  the home page stays simple: the words of <main> (outside script, style, pre, code, .sr-only, figure internals,
//      nav and footer) stay at or under MAX_WORDS. The hand budget is about 230 body words; the ceiling leaves room for
//      headlines and captions.
//   2  no old domain: no "sealmark.ai" anywhere in out/**/*.html
//   3  no status messaging: no "early preview", "concept", "mock", "beta", and no "preview" except the tool names
//      table-preview, preview_table and "preview tool"
//   4  the honesty items are present on the home page: the invented-example caption (Mechanism figure), the footer "not a security endorsement"
//      line, the availability line ("npx sealmark"), and the word "planned" near "DuckDB" or "MySQL" (the only planned engines)
//   5  every shipped pack in content/generated/packs.json (plus custom) is named on /docs/concepts/packs, and none of them is
//      within 80 characters of the word "planned" there
//
// No dependencies. Failures print one line each and exit 1.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(web, "out");
const MAX_WORDS = 450;
const NEAR = 80;

let bad = 0;
const fail = (rule, msg) => {
  console.error(`home-check: FAIL [${rule}] ${msg}`);
  bad++;
};

if (!existsSync(out)) {
  console.error("home-check: out/ does not exist; run next build first.");
  process.exit(1);
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** Remove every element whose opening tag satisfies `drop(tagName, attrs)`. Balanced by tag name, no dependencies. */
function removeElements(html, drop) {
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  let res = "";
  let last = 0;
  let m;
  let skip = null; // { name, depth, from }
  while ((m = re.exec(html))) {
    const [, close, rawName, attrs] = m;
    const name = rawName.toLowerCase();
    if (skip) {
      if (name === skip.name && !VOID.has(name)) {
        if (close) skip.depth--;
        else if (!attrs.endsWith("/")) skip.depth++;
        if (skip.depth === 0) {
          skip = null;
          last = re.lastIndex;
        }
      }
      continue;
    }
    if (!close && drop(name, attrs)) {
      res += html.slice(last, m.index);
      if (VOID.has(name) || attrs.endsWith("/")) last = re.lastIndex;
      else skip = { name, depth: 1 };
    }
  }
  if (!skip) res += html.slice(last);
  return res;
}

const classOf = (attrs) => (/\bclass="([^"]*)"/.exec(attrs) || [, ""])[1].split(/\s+/);
const decode = (s) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
const textOf = (html) => decode(html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const noCode = (html) => removeElements(html, (n) => n === "script" || n === "style" || n === "noscript" || n === "template");

function htmlFiles(dir) {
  const acc = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) acc.push(...htmlFiles(p));
    else if (e.name.endsWith(".html")) acc.push(p);
  }
  return acc;
}

const home = existsSync(join(out, "index.html")) ? readFileSync(join(out, "index.html"), "utf8") : null;
if (home === null) fail(1, "out/index.html was not built.");

// ---- 1: word budget -------------------------------------------------------------------------------------------------
if (home !== null) {
  const body = noCode(home);
  const mainHtml = /<main\b[\s\S]*<\/main>/i.exec(body)?.[0] ?? (/<body\b[\s\S]*<\/body>/i.exec(body)?.[0] ?? body);
  const prose = removeElements(mainHtml, (n, a) => ["pre", "code", "figure", "nav", "footer"].includes(n) || classOf(a).includes("sr-only"));
  const words = textOf(prose).split(/\s+/).filter(Boolean).length;
  console.log(`home-check: home page main text ${words} words (ceiling ${MAX_WORDS})`);
  if (words > MAX_WORDS) fail(1, `the home page has ${words} words of body text, over ${MAX_WORDS}. Simplify it (docs/ holds the detail).`);
}

// ---- 2 and 3: old domain and status words on every page --------------------------------------------------------------
const files = htmlFiles(out);
const WHITELIST = /table-preview|preview_table|preview tool/gi;
for (const f of files) {
  const name = relative(out, f).split("\\").join("/");
  const html = noCode(readFileSync(f, "utf8"));
  const text = decode(html);
  if (/sealmark\.ai/i.test(readFileSync(f, "utf8"))) fail(2, `out/${name} mentions sealmark.ai (the domain is sealmark.dev).`);
  // "early preview" is a subset of "preview", so one pass over the text without the tool names covers both.
  const rest = text.replace(WHITELIST, "").replace(/\bno write concept\b/g, ""); // "write concept" is the db pack's own verdict wording, quoted from reports
  const hit = /\bpreview\b|\bconcept\b|\bmock\b|\bbeta\b/i.exec(rest);
  if (hit) fail(3, `out/${name} contains "${hit[0]}" near "${rest.slice(Math.max(0, hit.index - 30), hit.index + 40).replace(/\s+/g, " ")}" (status wording is not allowed; say "unreleased" or "not on npm yet").`);
}
console.log(`home-check: scanned ${files.length} html files for sealmark.ai and status wording`);

// ---- 4: honesty items on the home page --------------------------------------------------------------------------------
if (home !== null) {
  const text = textOf(noCode(home));
  for (const phrase of ["Example data: servers and results are invented", "not a security endorsement", "npx sealmark"]) {
    if (!text.includes(phrase)) fail(4, `out/index.html lacks "${phrase}".`);
  }
  const near = (t, a, b) => [...t.matchAll(a)].some((m) => b.test(t.slice(Math.max(0, m.index - NEAR), m.index + m[0].length + NEAR)));
  if (!near(text, /duckdb|mysql/gi, /planned/i)) fail(4, `out/index.html has no "planned" within ${NEAR} characters of "DuckDB" or "MySQL".`);
}

// ---- 5: shipped packs are not marked planned -----------------------------------------------------------------------------
const packsFile = join(out, "docs", "concepts", "packs", "index.html");
if (!existsSync(packsFile)) fail(5, "out/docs/concepts/packs/index.html was not built.");
else {
  const packs = JSON.parse(readFileSync(join(web, "content", "generated", "packs.json"), "utf8"));
  const ids = [...packs.map((p) => p.id), "custom"];
  if (!ids.length) fail(5, "could not read pack ids from content/generated/packs.json; update this check.");
  const text = textOf(noCode(readFileSync(packsFile, "utf8")));
  for (const id of ids) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![\\w-])${esc}(?![\\w-])`, "g");
    const hits = [...text.matchAll(re)];
    if (!hits.length) fail(5, `shipped pack "${id}" is not named on /docs/concepts/packs.`);
    else if (hits.some((m) => /planned/i.test(text.slice(Math.max(0, m.index - NEAR), m.index + m[0].length + NEAR)))) fail(5, `shipped pack "${id}" is within ${NEAR} characters of "planned" on /docs/concepts/packs.`);
  }
}

if (bad) {
  console.error(`home-check: ${bad} problem${bad === 1 ? "" : "s"}.`);
  process.exit(1);
}
console.log("home-check: OK");
