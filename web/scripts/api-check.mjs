// npm run build (last step): the /data/v1/ files in out/ say what the built results pages say.
//
//   1  out/data/v1/servers.json lists exactly the servers that have a page under out/results/<id>/
//   2  every listed server has out/data/v1/servers/<id>.json, and the list and the file agree on the grade
//   3  that grade equals the page's heading ("Grade B", "Grade B (provisional)", "No grade", "No tools to test")
//   4  private disclosure, recomputed here from the raw data and content/data/disclosure.json (not from the page):
//      every redacted finding and its security siblings in the same test area have summary null; launch, reproduce
//      and configHash are null on a server with any private finding; no file under out/data/v1 contains a redacted
//      summary or a withheld start command of a server (its own file, the list and the changes; another server can share a
//      generic summary such as a pass sentence); and no file shows a check summary its page does not
//   4b the committed file itself (content/data/server-results.json is public) holds no summary for a redacted finding or for
//      a security sibling that is not a weak signal, and a weak signal beside one keeps only the text that classifies it:
//      fleet/redact-results.mjs cuts them where the file is written
//   6  the /results/ list page, with the data its client components receive (out/results/index.html and the page's
//      flight payload files), contains no redacted summary or withheld start command of any server
//   5  changes.json and openapi.json parse, and every path in openapi.json exists in out/
//   7  out/results-index.json (the site search's server entries) has one entry per listed server, its grade label equals the
//      page heading, it names no tool for a server with a private finding or any security finding (recomputed from the raw
//      data), and it contains no withheld text of any server
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isSecurityCheck, isSecurityFinding, isWeakSignal, redactedChecks } from "../lib/disclosure.mjs";
import { weakCore } from "../../fleet/redact-results.mjs";

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
// Same inputs as lib/results.ts: the data file, the disclosure file and the build date (UTC).
const RAW = new Map(read(join(web, "content", "data", "server-results.json")).servers.map((x) => [x.id, x]));
const DISCLOSURE = read(join(web, "content", "data", "disclosure.json")).findings;
const TODAY = new Date().toISOString().slice(0, 10);
const secrets = []; // [server id, where, text that must not appear in that server's file, the list or the changes]
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
  const raw = RAW.get(s.id);
  const red = raw ? redactedChecks(raw, DISCLOSURE, TODAY) : new Map();
  if (red.size > 0) {
    if (doc.launch !== null || doc.reproduce !== null || doc.configHash !== null) fail(4, `${s.id}: a finding is private, the file still has launch, reproduce or configHash`);
    if (!pageText.includes("The command for this run is withheld")) fail(4, `${s.id}: a finding is private but the page does not say the command is withheld; update this check`);
    secrets.push([s.id, s.id, raw.launch]);
    const privPacks = new Set(raw.checks.filter((c) => red.has(c.id)).map((c) => c.pack));
    for (const c of raw.checks) {
      if (!red.has(c.id) && !(privPacks.has(c.pack) && isSecurityCheck(c))) continue;
      if (c.summary && !red.has(c.id) && isWeakSignal(c) && c.summary !== weakCore(c)) fail("4b", `${s.id}/${c.id}: a weak signal beside a held finding keeps more than its classifying text`);
      if (c.summary && (red.has(c.id) || !isWeakSignal(c))) fail("4b", `${s.id}/${c.id}: server-results.json still holds the withheld summary (run node fleet/redact-results.mjs from any folder)`);
      if (c.summary) secrets.push([s.id, `${s.id}/${c.id}`, c.summary]);
      const f = doc.checks.find((y) => y.id === c.id);
      if (!f || f.summary !== null) fail(4, `${s.id}/${c.id}: summary must be null while the finding is private`);
    }
  }
  for (const c of doc.checks) {
    if (c.summary && !pageText.includes(c.summary.trim())) fail(4, `${s.id}/${c.id}: file shows a summary the page does not`);
  }
}

const body = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");
const shared = body(join(api, "servers.json")) + body(join(api, "changes.json"));
for (const [id, where, t] of secrets) {
  if (!t) continue;
  const enc = JSON.stringify(t).slice(1, -1);
  if ((body(join(api, "servers", `${id}.json`)) + shared).includes(enc)) fail(4, `${where}: withheld text appears in the API files`);
}

// Rule 6: the list page embeds its client components' props in the page itself; none of any server's private text may be there.
{
  const listFiles = readdirSync(resultsDir).filter((f) => /^index\.(html|txt)$/.test(f) || /^__next\..*\.txt$/.test(f));
  const listBody = listFiles.map((f) => body(join(resultsDir, f))).join("\n");
  if (!listFiles.includes("index.html")) fail(6, "out/results/index.html was not built");
  for (const [, where, t] of secrets) {
    if (t && listBody.includes(JSON.stringify(t).slice(1, -1))) fail(6, `${where}: withheld text appears in the /results/ page payload`);
  }
}

// Rule 7: the site search's server index.
{
  const file = join(out, "results-index.json");
  if (!existsSync(file)) fail(7, "out/results-index.json was not built");
  else {
    const entries = read(file);
    const byUrl = new Map(entries.map((e) => [e.url, e]));
    if (entries.length !== list.servers.length) fail(7, `${entries.length} entries for ${list.servers.length} listed servers`);
    for (const sv of list.servers) {
      const e = byUrl.get(`/results/${sv.id}/`);
      if (!e) { fail(7, `${sv.id}: no search entry`); continue; }
      const html = body(join(resultsDir, sv.id, "index.html"));
      const h = html.match(/<h2 id="grade-h">(.*?)<\/h2>/s);
      if (h && text(h[1]).trim() !== e.grade) fail(7, `${sv.id}: search says "${e.grade}", page "${text(h[1]).trim()}"`);
      const raw = RAW.get(sv.id);
      const held = raw && (redactedChecks(raw, DISCLOSURE, TODAY).size > 0 || raw.checks.some(isSecurityFinding));
      if (held && (e.headings.length !== 1 || e.headings[0] !== sv.id || /: /.test(e.text))) fail(7, `${sv.id}: a server with a security finding has tool names in the search index`);
    }
    const idx = body(file);
    for (const [, where, t] of secrets) {
      if (t && idx.includes(JSON.stringify(t).slice(1, -1))) fail(7, `${where}: withheld text appears in results-index.json`);
    }
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
