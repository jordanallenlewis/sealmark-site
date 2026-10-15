// node scripts/budget.mjs   (run by npm run build after next build; also fine to run alone)
//
// What a visitor downloads for a page = the stylesheets, scripts and fonts its HTML references (the <link>/<script> tags
// and the chunk paths in the RSC payload). The directory total of out/_next/static is the wrong number: it includes
// every docs chunk, so it says nothing about what the home page costs. This script measures per page and fails the
// build when a page goes over its ceiling, or when the marketing pages load the docs shell again.
//
// Ceilings are the measured size on 2026-10-08 plus about 5 percent headroom. They are a ratchet against drift, not a
// target: lower them when a page gets lighter. the design notes acceptance 2 still says CSS <= 55 KB and
// _next/static <= 952 KB for the home page; the real home page is above the CSS figure (the figures added their own
// stylesheets), so that line of the plan needs the per-page numbers below.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(web, "out");
const KB = 1024;

// page -> ceilings in bytes. "total" is css + js + fonts.
const BUDGET = {
  "index.html": { css: 81 * KB, js: 633 * KB, total: 823 * KB },
  "404.html": { css: 41 * KB, js: 593 * KB, total: 634 * KB },
  "docs/index.html": { css: 94 * KB, js: 670 * KB, total: 873 * KB },
};

// A page must not load code that belongs to the docs shell. Each marker is a string that only that code contains.
const DOCS_ONLY_MARKERS = [
  ["Search the docs", "the docs Search component"],
  ["docs-index.json", "the docs search index loader"],
  ["tocCol", "the docs shell stylesheet"],
  ["drawerHead", "the docs shell stylesheet"],
];
const MARKETING = ["index.html", "404.html"];

const assetsOf = (html) => {
  const refs = new Set();
  for (const m of html.matchAll(/(?:href|src)="(\/_next\/[^"]+)"/g)) refs.add(m[1]);
  for (const m of html.matchAll(/"(\/_next\/static\/[^"?]+\.(?:js|css|woff2))"/g)) refs.add(m[1]);
  return [...refs].map((r) => ({ url: r, file: resolve(out, "." + decodeURI(r)) })).filter((a) => existsSync(a.file));
};

const kb = (n) => `${(n / KB).toFixed(1)} KB`;
let bad = 0;

if (!existsSync(out)) {
  console.error("budget: out/ does not exist; run next build first.");
  process.exit(1);
}

for (const [page, max] of Object.entries(BUDGET)) {
  const file = resolve(out, page);
  if (!existsSync(file)) {
    console.error(`budget: FAIL ${page} was not built.`);
    bad++;
    continue;
  }
  const assets = assetsOf(readFileSync(file, "utf8"));
  const size = { css: 0, js: 0, font: 0 };
  for (const a of assets) size[a.url.endsWith(".css") ? "css" : a.url.endsWith(".js") ? "js" : "font"] += statSync(a.file).size;
  const total = size.css + size.js + size.font;
  const over = [];
  if (size.css > max.css) over.push(`css ${kb(size.css)} > ${kb(max.css)}`);
  if (size.js > max.js) over.push(`js ${kb(size.js)} > ${kb(max.js)}`);
  if (total > max.total) over.push(`total ${kb(total)} > ${kb(max.total)}`);
  console.log(`budget: ${over.length ? "FAIL" : "ok  "} ${page.padEnd(16)} css ${kb(size.css)}, js ${kb(size.js)}, fonts ${kb(size.font)}, total ${kb(total)} (${assets.length} files)${over.length ? "  <- " + over.join("; ") : ""}`);
  if (over.length) bad++;

  if (MARKETING.includes(page)) {
    for (const [marker, what] of DOCS_ONLY_MARKERS) {
      const hit = assets.find((a) => readFileSync(a.file, "utf8").includes(marker));
      if (hit) {
        console.error(`budget: FAIL ${page} loads ${what} (${hit.url} contains "${marker}"). A marketing page must not import docs code or docs CSS; check app/not-found.tsx and next.config.ts cssChunking.`);
        bad++;
      }
    }
  }
}

if (bad) {
  console.error(`budget: ${bad} problem${bad === 1 ? "" : "s"}.`);
  process.exit(1);
}
console.log("budget: OK");
