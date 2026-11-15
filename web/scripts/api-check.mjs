// npm run build (last step): the /data/v1/ files in out/ say what the built results pages say.
//
//   1  out/data/v1/servers.json lists exactly the servers that have a page under out/results/<id>/
//   2  every listed server has out/data/v1/servers/<id>.json, and the list and the file agree on the grade
//   3  that grade equals the page's heading ("Grade B", "Grade B (provisional)", "No grade", "No tools to test")
//   4  a page that withholds the repeat command (a security finding reported privately) has launch and reproduce null,
//      and the file holds no check summary the page does not show
//   5  changes.json and openapi.json parse, and every path in openapi.json exists in out/
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(web, "out");
const api = join(out, "data", "v1");
const errors = [];
const fail = (rule, msg) => errors.push(`api-check ${rule}: ${msg}`);
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
// The page's text, entities decoded the way React writes them.
const text = (html) => html.replace(/<!--.*?-->/gs, "").replace(/<[^>]+>/g, "").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

if (!existsSync(join(api, "servers.json"))) {
  console.error("api-check: out/data/v1/servers.json was not built.");
  process.exit(1);
}
const list = read(join(api, "servers.json"));
const resultsDir = join(out, "results");
const pages = readdirSync(resultsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(resultsDir, e.name, "index.html")) && e.name !== "history")
  .map((e) => e.name)
  .sort();
const listed = list.servers.map((s) => s.id).sort();
if (list.count !== list.servers.length) fail(1, `count ${list.count} but ${list.servers.length} servers listed`);
if (JSON.stringify(pages) !== JSON.stringify(listed)) {
  const missing = pages.filter((p) => !listed.includes(p));
  const extra = listed.filter((p) => !pages.includes(p));
  fail(1, `list and pages differ: no list entry for [${missing.join(", ")}], no page for [${extra.join(", ")}]`);
}

for (const s of list.servers) {
  const file = join(api, "servers", `${s.id}.json`);
  if (!existsSync(file)) { fail(2, `no ${s.id}.json`); continue; }
  const doc = read(file);
  if (doc.grade !== s.grade || doc.provisional !== s.provisional) fail(2, `${s.id}: list says ${s.grade}, file says ${doc.grade}`);
  const pageFile = join(resultsDir, s.id, "index.html");
  if (!existsSync(pageFile)) continue;
  const html = readFileSync(pageFile, "utf8");
  const h = html.match(/<h2 id="grade-h">(.*?)<\/h2>/s);
  if (!h) { fail(3, `${s.id}: no grade heading on the page`); continue; }
  const heading = text(h[1]).trim();
  const none = heading === "No tools to test" || heading === "No grade";
  const want = heading.match(/^Grade ([ABCDF])( \(provisional\))?$/);
  if (!none && !want) fail(3, `${s.id}: unknown grade heading "${heading}"; update this check`);
  else if (none ? doc.grade !== null : doc.grade !== want[1] || doc.provisional !== Boolean(want[2])) fail(3, `${s.id}: page "${heading}", file ${doc.grade}${doc.provisional ? " (provisional)" : ""}`);
  const pageText = text(html);
  const withheld = pageText.includes("The command for this run is withheld");
  if (withheld && (doc.launch !== null || doc.reproduce !== null)) fail(4, `${s.id}: page withholds the command, file has it`);
  for (const c of doc.checks) {
    if (c.summary && !pageText.includes(c.summary.trim())) fail(4, `${s.id}/${c.id}: file shows a summary the page does not`);
  }
}

for (const name of ["changes.json", "openapi.json"]) {
  try { read(join(api, name)); } catch (e) { fail(5, `${name}: ${e.message}`); }
}
if (existsSync(join(api, "openapi.json"))) {
  const o = read(join(api, "openapi.json"));
  for (const p of Object.keys(o.paths ?? {})) {
    const f = join(api, p.replace("{id}", list.servers[0]?.id ?? "none").replace(/^\//, ""));
    if (list.servers.length && !existsSync(f)) fail(5, `openapi path ${p} has no file in out/data/v1`);
  }
}

if (errors.length) {
  for (const e of errors.slice(0, 40)) console.error(e);
  console.error(`api-check: ${errors.length} problem(s).`);
  process.exit(1);
}
console.log(`api-check: ok (${list.servers.length} servers, list, files and pages agree).`);
