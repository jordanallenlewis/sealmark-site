// npm run docs:check  (also run first by npm run build)
//
// The drift test for the docs site (plan section 7.3). No dependencies, Node only.
// The CLI is the source of truth: content/generated/{checks,config,cli}.json come from `sealmark describe --json`,
// and the prose in content/docs/**/*.mdx must not claim anything those files do not back.
//
// Rules (a failure of any one fails the build):
//   1  every check id in checks.json has a generated page (app/docs/reference/checks/[id]); a hand-written companion
//      reference/checks/<id>.mdx is optional, but must be for a real check id, have valid meta and must not repeat a
//      section the page generates (`## Verdict rules`, `## Probes`, `## How the verdict is established`, ...)
//   2  every config key path in config.json is documented: named in reference/configuration.mdx prose, or deprecated
//      (listed muted in the generated configuration table), or a checks.<id>.<setting> key that the check page renders
//      (the enabled|severity|corpus.add|corpus.remove family, or one of some check's configKeys), or servers.*.<x>
//      where server.<x> is documented
//   3  every --flag token in any .mdx exists in cli.json, unless inside a fence tagged `planned`
//   4  every YAML key in a `yaml` fence is a config key path (or a prefix of one), unless the fence is tagged `planned`
//   5  every /docs/... and #anchor link resolves to a page (in _nav.json, a generated route, or an existing mdx page)
//      and to a heading or id on that page
//   6  frontmatter has title, since and status (shipped | planned | opt-in); a planned page shows <Status kind="planned" />
//      in its first 10 lines; no real server name appears next to a grade letter (only Servers A to E are allowed)
//   7  /docs/concepts/grades and /docs/methodology contain the exact A-means sentence, linked to
//      /docs/methodology#what-an-a-means
//
// Source checks (they run only when the built CLI and web/lib exist next to the content being checked):
//   8  scripts/docs-gen.mjs --check: the committed content/generated/*.json equal what node_modules/sealmark/dist/cli.js prints now
//      (skipped, with a note, when the CLI is not built)
//   9  the check labels in lib/data.ts (the home page's report lines) equal the labels in checks.json
//  10  the exit codes in cli/README.md ("### Exit codes") match the codes in cli.json (what `sealmark --help` prints):
//      every declared code has a row, and every row is a declared code or a signal code (128 and above)
//
// Beyond the plan (each is labelled "6b" etc. in the output, because each is the same kind of drift):
//   2b config.json entries are well formed          5b nav entries have a page; mdx pages have a nav entry (warning)
//   6b nav status equals the page's meta.status     6c a planned page has no copyable fence (tag every fence `planned`)
//
// Environment: DOCS_CHECK_ROOT=<dir> checks <dir>/content instead of web/content (used by --self-test and fixtures).
// Flags: --self-test  copies the real content to a temp dir, injects one fault per rule, and proves each is caught.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "..");

const SENTENCE = "An A means these checks passed with this exact configuration; it is not a security endorsement";
const SENTENCE_LINK = "/docs/methodology#what-an-a-means";
const STATUSES = ["shipped", "planned", "opt-in"];

// Real MCP servers and vendors. None may appear on a line that also shows a grade letter (the disclosure and naming rules).
// Add a name here when it enters the design notes or any pack. Matched case-insensitively on word boundaries.
const DENY_NAMES = [
  "Supabase", "DBHub", "MCP Toolbox", "genai-toolbox", "Snowflake", "crystaldba", "Postgres MCP Pro", "pg-mcp",
  "SafeDB", "server-postgres", "Dremio", "Confluent", "Neon", "Databricks", "MongoDB", "ClickHouse", "PlanetScale",
  "Prisma", "BigQuery", "MindsDB", "Bytebase", "Redis", "MySQL MCP", "mcp-alchemy",
];

const rel = (root, f) => path.relative(root, f).split(path.sep).join("/");
const read = (f) => readFileSync(f, "utf8");
const lines = (t) => t.split(/\r?\n/);

// ---------------------------------------------------------------------------------------------------------------
// Parsing helpers

/** Split an MDX source into fences and prose. `prose[i]` is line i with fenced lines blanked, so line numbers hold. */
function parseMdx(text) {
  const src = lines(text);
  const prose = src.slice();
  const fences = [];
  let open = null;
  for (let i = 0; i < src.length; i++) {
    if (!open) {
      const m = /^(\s*)(`{3,}|~{3,})\s*(.*)$/.exec(src[i]);
      if (m) {
        const info = m[3].trim();
        const words = info.split(/\s+/).filter(Boolean);
        open = { start: i, mark: m[2][0], len: m[2].length, lang: (words[0] || "").toLowerCase(), planned: words.slice(1).concat(words[0] || []).some((w) => w.toLowerCase() === "planned"), body: [] };
        prose[i] = "";
      }
      continue;
    }
    const close = new RegExp(`^\\s*${open.mark === "`" ? "`" : "~"}{${open.len},}\\s*$`).test(src[i]);
    prose[i] = "";
    if (close) {
      open.end = i;
      fences.push(open);
      open = null;
    } else open.body.push({ no: i + 1, text: src[i] });
  }
  if (open) {
    open.end = src.length - 1;
    open.unclosed = true;
    fences.push(open);
  }
  return { src, prose, fences };
}

/** Text of a heading as rehype-slug (github-slugger) sees it. */
function headingText(raw) {
  return raw
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/[*~]/g, "")
    .trim();
}
const slugify = (s) => s.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "").replace(/ /g, "-");

function headingsOf(prose) {
  const out = [];
  for (const l of prose) {
    const m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (m) out.push({ level: m[1].length, text: headingText(m[2]) });
  }
  return out;
}

/** The anchors a page gets: github-slugger slugs (with -1, -2 for repeats) plus explicit id="..." attributes. */
function anchorsOf(prose) {
  const seen = new Map();
  const set = new Set();
  for (const h of headingsOf(prose)) {
    const base = slugify(h.text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    set.add(n === 0 ? base : `${base}-${n}`);
  }
  for (const m of prose.join("\n").matchAll(/\bid=(?:"([^"]+)"|'([^']+)')/g)) set.add(m[1] ?? m[2]);
  return set;
}

function linksOf(prose) {
  const out = [];
  prose.forEach((l, i) => {
    const t = l.replace(/`[^`\n]*`/g, "");
    for (const m of t.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.push({ no: i + 1, target: m[1] });
    for (const m of t.matchAll(/\bhref=(?:"([^"]*)"|'([^']*)'|\{"([^"]*)"\})/g)) out.push({ no: i + 1, target: m[1] ?? m[2] ?? m[3] });
  });
  return out;
}

function parseMeta(src) {
  const head = src.slice(0, 30);
  const start = head.findIndex((l) => /^\s*export\s+const\s+meta\b/.test(l));
  if (start < 0) return null;
  let end = start;
  while (end < src.length && !/^\s*\}\s*;?\s*$/.test(src[end])) end++;
  const block = src.slice(start, end + 1).join("\n");
  const field = (k) => {
    const m = new RegExp(`^\\s*(?:export\\s+const\\s+meta\\s*=\\s*\\{\\s*)?${k}\\s*:\\s*(["'\`])((?:\\\\.|(?!\\1).)*)\\1`, "m").exec(block);
    return m ? m[2] : undefined;
  };
  return { title: field("title"), since: field("since"), status: field("status") };
}

// ---------------------------------------------------------------------------------------------------------------
// The checks

export function runChecks(root, opts = {}) {
  const failures = []; // { rule, where, msg }
  const warnings = [];
  const fail = (rule, where, msg) => failures.push({ rule: String(rule), where, msg });
  const warn = (where, msg) => warnings.push({ where, msg });

  const contentDir = path.join(root, "content");
  const docsDir = path.join(contentDir, "docs");
  const genDir = path.join(contentDir, "generated");
  const R = (f) => rel(root, f);

  const loadJson = (file, shape) => {
    if (!existsSync(file)) {
      fail("inputs", R(file), "missing. Run `npm run docs:gen` (or restore the checked-in sample).");
      return null;
    }
    try {
      const v = JSON.parse(read(file));
      if (!shape(v)) {
        fail("inputs", R(file), "has an unexpected shape.");
        return null;
      }
      return v;
    } catch (e) {
      fail("inputs", R(file), `is not valid JSON: ${e.message}`);
      return null;
    }
  };

  const checks = loadJson(path.join(genDir, "checks.json"), (v) => Array.isArray(v) && v.every((c) => c && typeof c.id === "string"));
  const config = loadJson(path.join(genDir, "config.json"), (v) => Array.isArray(v) && v.every((k) => k && typeof k.path === "string"));
  const cli = loadJson(path.join(genDir, "cli.json"), (v) => v && Array.isArray(v.flags) && Array.isArray(v.commands));
  const packs = loadJson(path.join(genDir, "packs.json"), (v) => Array.isArray(v) && v.every((g) => g && typeof g.id === "string" && Array.isArray(g.checks)));
  const nav = loadJson(path.join(docsDir, "_nav.json"), (v) => Array.isArray(v) && v.every((g) => g && Array.isArray(g.items)));

  // Files
  const walk = (dir, base = []) => {
    const out = [];
    if (!existsSync(dir)) return out;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith("_") || e.name.startsWith(".")) continue;
      if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), [...base, e.name]));
      else if (e.name.endsWith(".mdx")) out.push([...base, e.name.slice(0, -4)]);
    }
    return out;
  };
  if (!existsSync(docsDir)) fail("inputs", R(docsDir), "missing.");
  const pages = walk(docsDir).map((parts) => {
    const file = path.join(docsDir, ...parts) + ".mdx";
    const slug = parts[parts.length - 1] === "index" ? parts.slice(0, -1) : parts;
    const url = "/" + ["docs", ...slug].join("/");
    const text = read(file);
    const parsed = parseMdx(text);
    return { file, where: R(file), parts, slug, url, ...parsed, meta: parseMeta(parsed.src), anchors: anchorsOf(parsed.prose) };
  });
  const pageByUrl = new Map(pages.map((p) => [p.url, p]));

  const flagSet = new Set();
  for (const f of cli?.flags ?? []) {
    if (f.status === "planned") continue; // designed, rejected by the parser: only a `planned` fence may show it
    for (const n of String(f.name).split(/\s*,\s*/)) if (n.startsWith("--")) flagSet.add(n);
    if (f.negatable && String(f.name).startsWith("--")) flagSet.add(`--no-${String(f.name).slice(2)}`);
  }

  // config paths, normalised: `sql_tools[].tool` -> `sql_tools.tool`
  const cfgPaths = (config ?? []).map((k) => ({ ...k, path: k.path.replace(/\[\]/g, "") }));
  const cfgByPath = new Map(cfgPaths.map((k) => [k.path, k]));

  // ---- Rule 1: every check has a generated page; a prose companion is optional and must not repeat generated sections
  const ids = new Set((checks ?? []).map((c) => c.id));
  const GENERATED_H2 = ["Probes", "Settings and thresholds", "How the verdict is established", "What to fix", "False positives", "False negatives", "Notes", "Verdict rules", "Probe summary"];
  const routeFile = path.join(root, "app", "docs", "reference", "checks", "[id]", "page.tsx");
  if (checks?.length && existsSync(routeFile) && !/generateStaticParams[\s\S]*CHECKS\.map/.test(read(routeFile))) {
    fail(1, R(routeFile), "does not generate a route for every id in checks.json (generateStaticParams must map CHECKS).");
  }
  for (const p of pages) {
    if (!(p.parts[0] === "reference" && p.parts[1] === "checks" && p.parts.length === 3 && p.parts[2] !== "index")) continue;
    if (checks && !ids.has(p.parts[2])) {
      fail(1, p.where, `companion page for "${p.parts[2]}", but checks.json has no such check id (delete the page).`);
      continue;
    }
    for (const h of headingsOf(p.prose)) {
      if (h.level === 2 && GENERATED_H2.includes(h.text)) fail(1, p.where, `companion repeats the generated section "## ${h.text}". The check page renders it from checks.json; keep only what the CLI does not say.`);
    }
  }

  // ---- Rule 2: config keys are documented
  const cfgPage = pageByUrl.get("/docs/reference/configuration");
  if (config && !cfgPage) fail(2, "content/docs/reference/configuration.mdx", "missing.");
  const seenPaths = new Set();
  const mentioned = (bare, page) => {
    const esc = bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // A one-word key such as `name` or `packs` must be in inline code; dotted paths just need to be a whole token.
    const re = bare.includes(".") ? new RegExp(`(?<![\\w.-])${esc}(?![\\w-])`) : new RegExp(`\`${esc}\``);
    return re.test(page.prose.join("\n"));
  };
  const checkKeys = new Set((checks ?? []).flatMap((c) => (c.configKeys ?? []).map((k) => k.replace(/\[\]/g, ""))));
  const documented = (k, page) => {
    const bare = k.path.replace(/\[\]/g, "");
    if (mentioned(bare, page)) return true;
    if (k.deprecated) return true; // listed (muted, "deprecated") in the generated configuration table
    const fam = /^checks\.([a-z][a-z0-9-]*)\.(?:enabled|severity|corpus\.add|corpus\.remove)$/.exec(bare);
    if (fam && ids.has(fam[1])) return true; // rendered on that check's page
    if (bare.startsWith("checks.") && checkKeys.has(bare)) return true; // one of some check's configKeys: its page lists it
    const srv = /^servers\.\*\.(.+)$/.exec(bare);
    const base = srv ? cfgByPath.get(`server.${srv[1]}`) : null;
    return Boolean(base && documented(base, page));
  };
  for (const k of config ?? []) {
    if (seenPaths.has(k.path)) fail("2b", "content/generated/config.json", `duplicate key path "${k.path}".`);
    seenPaths.add(k.path);
    if (!k.path || /\s/.test(k.path)) fail("2b", "content/generated/config.json", `bad key path "${k.path}".`);
    if (!cfgPage) continue;
    if (!documented(k, cfgPage)) {
      const bare = k.path.replace(/\[\]/g, "");
      fail(2, cfgPage.where, `config key "${k.path}" (config.json) is not documented: name it in the prose${bare.includes(".") ? "" : " (in inline code)"}; checks.<id>.<setting> keys that a check page lists, deprecated keys and servers.*.<x> with a documented server.<x> need no mention.`);
    }
  }

  // ---- Rule 3 and 4: flags and YAML keys
  const keyAllowed = (p) => {
    if (cfgPaths.some((k) => k.path === p || k.path.startsWith(`${p}.`))) return true;
    const parts = p.split(".");
    for (let n = parts.length - 1; n >= 1; n--) {
      const anc = cfgByPath.get(parts.slice(0, n).join("."));
      if (!anc) continue;
      const type = String(anc.type ?? "");
      if (type === "stringMap" || type === "object") return true; // free-form NAME: value (env, headers, profiles, tool overrides)
      if (type === "list") {
        // A list of objects. Where the description names the item keys ("as { tool, arg }"), a direct child must be named in it
        // (role and shape are named in the same sentence); deeper keys (plugin options, probe expectations) are free-form.
        const desc = String(anc.description ?? "");
        if (!/\{[^{}:]*\}/.test(desc) || parts.length - n > 1) return true;
        return new RegExp(`(?<![\\w-])${parts[n].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(desc);
      }
      return false;
    }
    return false;
  };

  const yamlKeys = (fence) => {
    const out = [];
    const stack = [];
    let skipIndent = -1;
    for (const { no, text } of fence.body) {
      if (!text.trim() || /^\s*#/.test(text)) continue;
      const ind = text.length - text.trimStart().length;
      if (skipIndent >= 0) {
        if (ind > skipIndent) continue;
        skipIndent = -1;
      }
      const m = /^(\s*)((?:-\s+)*)("[^"]+"|'[^']+'|[A-Za-z_][\w.-]*)\s*:(?:\s+(.*))?$/.exec(text);
      if (!m) continue;
      const eff = m[1].length + m[2].length;
      while (stack.length && stack[stack.length - 1].indent >= eff) stack.pop();
      const key = m[3].replace(/^["']|["']$/g, "");
      const base = stack.map((s) => s.key);
      out.push({ no, path: [...base, key].join(".") });
      stack.push({ indent: eff, key });
      const val = (m[4] ?? "").trim();
      if (/^[|>][+-]?\d*$/.test(val)) skipIndent = eff;
      if (val.includes("{")) {
        const flat = val.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, '""');
        for (const f of flat.matchAll(/[{,]\s*([A-Za-z_][\w-]*)\s*:/g)) out.push({ no, path: [...base, key, f[1]].join(".") });
      }
    }
    return out;
  };

  const FLAG_RE = /(?<!-)--[a-z][a-z-]+/g;
  for (const p of pages) {
    const flagLines = p.src.map((t, i) => ({ no: i + 1, text: t }));
    const plannedLine = new Set();
    for (const f of p.fences) if (f.planned) for (let i = f.start; i <= f.end; i++) plannedLine.add(i + 1);
    for (const { no, text } of flagLines) {
      if (plannedLine.has(no)) continue;
      // `--start "my-server --port 8000"` quotes the user's own server command, whose flags are not Sealmark's.
      const sealmarkText = text.replace(/(--(?:start|from))(\s+)(?:"[^"]*"|'[^']*')/g, "$1$2");
      for (const m of sealmarkText.matchAll(FLAG_RE)) {
        const flag = m[0].replace(/-+$/, "");
        if (!flagSet.has(flag)) fail(3, `${p.where}:${no}`, `unknown flag ${flag}. cli.json lists: ${[...flagSet].join(" ")}. If it is designed but not built, put it in a fence tagged \`planned\`.`);
      }
    }
    for (const f of p.fences) {
      if (f.planned) continue;
      const looksSealmark = f.lang === "yml" && f.body.some((b) => /^(server|sql_tools|packs)\s*:/.test(b.text));
      if (f.lang !== "yaml" && !looksSealmark) continue; // ```yml is for non-Sealmark YAML such as CI workflows
      for (const k of yamlKeys(f)) if (!keyAllowed(k.path)) fail(4, `${p.where}:${k.no}`, `YAML key "${k.path}" is not a config key (content/generated/config.json). Use a \`yml\` fence for YAML that is not a Sealmark config, or tag the fence \`planned\`.`);
    }
  }

  // ---- Rule 5: links
  const navUrls = new Map();
  for (const g of nav ?? []) for (const it of g.items) {
    if (!it || typeof it.url !== "string" || typeof it.title !== "string" || !it.status) fail("5b", "content/docs/_nav.json", `bad item ${JSON.stringify(it)}: needs title, url, status.`);
    else {
      if (navUrls.has(it.url)) fail("5b", "content/docs/_nav.json", `duplicate url ${it.url}.`);
      navUrls.set(it.url, it);
    }
  }
  // Anchors the generated reference routes emit (mirrors app/docs/reference/{configuration,cli,checks}/**/page.tsx and ref.tsx keyId).
  const generatedAnchors = (url) => {
    const s = new Set();
    if (url === "/docs/reference/configuration") {
      s.add("keys");
      for (const k of cfgPaths) s.add(`key-${k.path.replace(/[^a-zA-Z0-9_]+/g, "-")}`);
    } else if (url === "/docs/reference/cli") {
      for (const a of ["commands", "flags", "exit-codes"]) s.add(a);
      for (const c of cli?.commands ?? []) s.add(`cmd-${c.name}`);
      for (const f of cli?.flags ?? []) s.add(`flag-${String(f.name).replace(/^-+/, "").replace(/[^a-z0-9]+/gi, "-")}`);
    } else if (url === "/docs/reference/checks") {
      for (const g of packs ?? []) s.add(`pack-${g.id}`);
    } else if (/^\/docs\/reference\/checks\/[^/]+$/.test(url)) {
      for (const a of ["probes", "settings", "how-the-verdict-is-established", "what-to-fix", "false-positives", "false-negatives", "notes"]) s.add(a);
    }
    return s;
  };
  const generatedUrls = new Set(["/docs/reference/configuration", "/docs/reference/cli", "/docs/reference/checks", ...(checks ?? []).map((c) => `/docs/reference/checks/${c.id}`)]);

  for (const u of navUrls.keys()) if (!pageByUrl.has(u) && !generatedUrls.has(u)) fail("5b", "content/docs/_nav.json", `${u} has no page (no mdx file and no generated route).`);
  // A check companion is rendered under its generated page (as "Notes"), so it has no nav entry of its own.
  for (const p of pages) if (!navUrls.has(p.url) && !/^\/docs\/reference\/checks\/[^/]+$/.test(p.url)) warn(p.where, `${p.url} is not listed in _nav.json.`);

  for (const p of pages) {
    for (const { no, target } of linksOf(p.prose)) {
      let t = target;
      if (!(t.startsWith("#") || t === "/docs" || t.startsWith("/docs/") || t.startsWith("/docs?") || t.startsWith("/docs#"))) continue;
      const hashAt = t.indexOf("#");
      let pathPart = hashAt >= 0 ? t.slice(0, hashAt) : t;
      let frag = hashAt >= 0 ? t.slice(hashAt + 1) : "";
      try { frag = decodeURIComponent(frag); } catch { /* keep raw */ }
      pathPart = pathPart.replace(/\?.*$/, "").replace(/\/+$/, "") || (t.startsWith("#") ? p.url : "/docs");
      const where = `${p.where}:${no}`;
      const known = navUrls.has(pathPart) || generatedUrls.has(pathPart) || pageByUrl.has(pathPart);
      if (!known) {
        fail(5, where, `link ${target}: ${pathPart} is not a page (not in _nav.json, not a generated route, no mdx file).`);
        continue;
      }
      if (!frag) continue;
      const dest = pageByUrl.get(pathPart);
      const anchors = new Set([...(dest?.anchors ?? []), ...generatedAnchors(pathPart)]);
      if (!anchors.has(frag)) fail(5, where, `link ${target}: no heading or id "${frag}" on ${pathPart}.`);
    }
  }

  // ---- Rule 6: frontmatter, planned banner, server names
  const denyRes = DENY_NAMES.map((n) => ({ n, re: new RegExp(`(?<![\\w-])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i") }));
  // A grade letter: a standalone capital A to F, optionally starred, that is not "Server X" and not the article "A ...".
  const gradeIn = (line) => {
    for (const m of line.matchAll(/(?<![\w'’-])([A-F])(\*)?(?![\w'’])/g)) {
      const before = line.slice(0, m.index);
      const after = line.slice(m.index + m[0].length);
      if (/\bServers?\s*$/.test(before)) continue;
      if (m[1] === "A" && !m[2] && /^\s+[a-z]/.test(after)) continue; // "A server", "A pass": the article
      if (/^\s*[-–—]\s*[A-F]\b/.test(after) && /[\d.]\s*$/.test(before)) continue; // ranges such as "0.1-A"
      return m[0];
    }
    return null;
  };
  for (const p of pages) {
    const m = p.meta;
    if (!m) fail(6, p.where, "no `export const meta = { title, since, status }` in the first 30 lines.");
    else {
      for (const k of ["title", "since"]) if (!m[k]) fail(6, p.where, `frontmatter lacks ${k}.`);
      if (!m.status) fail(6, p.where, "frontmatter lacks status.");
      else if (!STATUSES.includes(m.status)) fail(6, p.where, `status "${m.status}" is not one of ${STATUSES.join(", ")}.`);
      const nav1 = navUrls.get(p.url);
      if (nav1 && m.status && nav1.status !== m.status) fail("6b", p.where, `meta.status is "${m.status}" but _nav.json says "${nav1.status}" for ${p.url}.`);
    }
    if (m?.status === "planned") {
      const head = p.src.slice(0, 10).join("\n");
      if (!/<Status\s+kind=["']planned["']\s*\/?>/.test(head)) fail(6, p.where, 'a planned page must have <Status kind="planned" /> in its first 10 lines.');
      for (const f of p.fences) if (!f.planned) fail("6c", `${p.where}:${f.start + 1}`, "planned page has a fence that is not tagged `planned` (it would get a copy button).");
    }
    p.prose.forEach((line, i) => {
      for (const { n, re } of denyRes) {
        if (!re.test(line)) continue;
        const g = gradeIn(line.replace(re, " "));
        if (g) fail(6, `${p.where}:${i + 1}`, `real name "${n}" on a line that shows grade "${g}". Use Servers A to E for graded examples.`);
      }
      for (const s of line.matchAll(/\bServers?\s+([F-Z])(?![\w/'’])/g)) fail(6, `${p.where}:${i + 1}`, `"Server ${s[1]}": only Servers A to E exist in the invented examples.`);
    });
  }

  // ---- Rule 7: the A-means sentence
  const needle = new RegExp(`\\[\\s*${SENTENCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\]\\(\\s*${SENTENCE_LINK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\)`);
  for (const url of ["/docs/concepts/grades", "/docs/methodology"]) {
    const p = pageByUrl.get(url);
    if (!p) { fail(7, `content/docs${url.slice(5)}.mdx`, "missing."); continue; }
    if (!needle.test(p.prose.join("\n").replace(/\s*\n\s*/g, " "))) fail(7, p.where, `lacks the exact sentence "${SENTENCE}" as a link to ${SENTENCE_LINK}.`);
  }
  const meth = pageByUrl.get("/docs/methodology");
  if (meth && !meth.anchors.has("what-an-a-means")) fail(7, meth.where, 'has no heading with the slug "what-an-a-means" (the sentence links to it).');

  // ---- Rule 8: the committed generated JSON against what the built CLI prints now (skipped when the CLI is not built)
  const gen = path.join(WEB, "scripts", "docs-gen.mjs");
  const cliJs = opts.cliJs ?? path.resolve(root, "node_modules", "sealmark", "dist", "cli.js");
  if (opts.gen === false) { /* the self-test runs the generator only for the rule 8 cases */ } else if (existsSync(cliJs) && existsSync(gen)) {
    const r = spawnSync(process.execPath, [gen, "--check", "--dir", genDir], { encoding: "utf8" });
    if (r.status !== 0) fail(8, "content/generated", (r.stderr || r.stdout || `docs-gen --check exited ${r.status}`).trim().split("\n").slice(0, 6).join(" | "));
  } else warn("content/generated", "rule 8 skipped: node_modules/sealmark/dist/cli.js is missing, so the generated JSON was not compared with the CLI (run npm ci).");

  // ---- Rule 9: the home page's check labels against checks.json
  const dataTs = opts.dataTs ?? path.join(root, "lib", "data.ts");
  if (checks && existsSync(dataTs)) {
    const json = new Map(checks.map((c) => [c.id, c.label]));
    const seen = new Set();
    for (const m of read(dataTs).matchAll(/\{\s*id:\s*"([a-z][a-z-]*)",\s*pack:\s*"[a-z]+",\s*label:\s*"([^"]+)"/g)) {
      seen.add(m[1]);
      if (!json.has(m[1])) fail(9, "lib/data.ts", `check "${m[1]}" is not in checks.json.`);
      else if (json.get(m[1]) !== m[2]) fail(9, "lib/data.ts", `check "${m[1]}" is labelled "${m[2]}", but the CLI label is "${json.get(m[1])}".`);
    }
    // The home page shows the packs data.ts declares (core and db); the other packs have their generated pages only.
    const shownPacks = new Set([...read(dataTs).matchAll(/\{\s*id:\s*"[a-z][a-z-]*",\s*pack:\s*"([a-z]+)",\s*label:/g)].map((m) => m[1]));
    for (const c of checks) if (shownPacks.has(c.pack) && !seen.has(c.id)) fail(9, "lib/data.ts", `has no CHECKS entry for "${c.id}" (pack ${c.pack}).`);
  }

  // ---- Rule 10: the exit codes in cli/README.md against the exit codes the CLI declares (cli.json, from `sealmark describe`)
  // Codes are compared, not wording: every code the CLI prints under `exit codes:` must have a row in the README's
  // "### Exit codes" table, and every row must be a declared code or a signal code (128 and above, 128 plus the signal number).
  const readmePath = opts.readme ?? path.resolve(root, "node_modules", "sealmark", "README.md");
  if (cli && Array.isArray(cli.exitCodes) && existsSync(readmePath)) {
    const text = read(readmePath);
    const at = text.indexOf("### Exit codes");
    if (at < 0) fail(10, "cli/README.md", 'has no "### Exit codes" table.');
    else {
      const end = text.indexOf("\n## ", at);
      const section = text.slice(at, end < 0 ? undefined : end);
      const listed = new Set();
      for (const line of section.split("\n")) {
        const m = /^\|\s*([0-9][0-9,\s/]*?)\s*\|/.exec(line);
        if (m) for (const n of m[1].match(/\d+/g) ?? []) listed.add(Number(n));
      }
      const declared = new Set(cli.exitCodes.map((e) => Number(e.code)));
      for (const code of declared) if (!listed.has(code)) fail(10, "cli/README.md", `exit code ${code} is in the CLI's table (sealmark --help) but has no row in the "Exit codes" table.`);
      for (const code of listed) if (!declared.has(code) && code < 128) fail(10, "cli/README.md", `the "Exit codes" table lists exit code ${code}, which the CLI does not declare.`);
    }
  }

  const stats = { pages: pages.length, checks: checks?.length ?? 0, keys: config?.length ?? 0, flags: flagSet.size };
  return { failures, warnings, stats };
}

// ---------------------------------------------------------------------------------------------------------------
// Reporting

function report({ failures, warnings, stats }) {
  console.log(`docs:check: ${stats.pages} pages, ${stats.checks} checks, ${stats.keys} config keys, ${stats.flags} CLI flags`);
  for (const w of warnings) console.log(`warn  ${w.where}: ${w.msg}`);
  for (const f of failures) console.log(`FAIL  [rule ${f.rule}] ${f.where}: ${f.msg}`);
  if (!failures.length) {
    console.log(`docs:check: OK${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? "" : "s"})` : ""}`);
    return 0;
  }
  const by = {};
  for (const f of failures) by[f.rule] = (by[f.rule] ?? 0) + 1;
  console.log(`docs:check: FAILED, ${failures.length} problem${failures.length === 1 ? "" : "s"} (${Object.entries(by).map(([r, n]) => `rule ${r}: ${n}`).join(", ")})`);
  return 1;
}

// ---------------------------------------------------------------------------------------------------------------
// Self-test: prove each rule can fail, on a throwaway copy of the real content.

function selfTest() {
  const real = path.resolve(process.env.DOCS_CHECK_ROOT || WEB);
  const tmp = mkdtempSync(path.join(tmpdir(), "docs-check-"));
  let bad = 0;
  const key = (f) => `${f.rule}|${f.where}|${f.msg}`;
  try {
    const realOpts = { cliJs: path.resolve(real, "node_modules", "sealmark", "dist", "cli.js"), dataTs: path.join(real, "lib", "data.ts"), readme: path.resolve(real, "node_modules", "sealmark", "README.md") };
    const base = new Set(runChecks(real, { ...realOpts, gen: false }).failures.map(key));
    const fresh = () => {
      const dir = mkdtempSync(path.join(tmp, "c-"));
      cpSync(path.join(real, "content"), path.join(dir, "content"), { recursive: true });
      if (existsSync(realOpts.dataTs)) cpSync(realOpts.dataTs, path.join(dir, "data.ts"));
      if (existsSync(realOpts.readme)) cpSync(realOpts.readme, path.join(dir, "cli-README.md"));
      return dir;
    };
    const docs = (dir, ...p) => path.join(dir, "content", "docs", ...p);
    const gen = (dir, f) => path.join(dir, "content", "generated", f);
    const edit = (file, fn) => writeFileSync(file, fn(read(file)));
    const FM = (status = "shipped") => `export const meta = {\n  title: "Fixture",\n  since: "0.1",\n  status: "${status}",\n};\n\n`;
    const cases = [
      { name: "fake --no-such-flag in a fixture page", rule: "3", expect: true, mutate: (d) => writeFileSync(docs(d, "zz-fixture.mdx"), `${FM()}Run it with:\n\n\`\`\`bash\nsealmark run --no-such-flag\n\`\`\`\n`) },
      { name: "fake flag in inline prose", rule: "3", expect: true, mutate: (d) => writeFileSync(docs(d, "zz-fixture.mdx"), `${FM()}Pass \`--no-such-flag\` to it.\n`) },
      { name: "fake flag inside a planned fence is allowed", rule: "3", expect: false, mutate: (d) => writeFileSync(docs(d, "zz-fixture.mdx"), `${FM()}\`\`\`bash planned\nsealmark run --no-such-flag\n\`\`\`\n`) },
      { name: "real flag --fail-under is allowed", rule: "3", expect: false, mutate: (d) => writeFileSync(docs(d, "zz-fixture.mdx"), `${FM()}Use \`--fail-under B\`.\n`) },
      { name: "unknown YAML key", rule: "4", expect: true, mutate: (d) => writeFileSync(docs(d, "zz-fixture.mdx"), `${FM()}\`\`\`yaml\nname: x\nserver:\n  command: node\n  bogus: 1\n\`\`\`\n`) },
      { name: "unknown top-level YAML key", rule: "4", expect: true, mutate: (d) => writeFileSync(docs(d, "zz-fixture.mdx"), `${FM()}\`\`\`yaml\nbogus_top_level: ci\n\`\`\`\n`) },
      { name: "known YAML keys incl. env names and sql_tools items", rule: "4", expect: false, mutate: (d) => writeFileSync(docs(d, "zz-fixture.mdx"), `${FM()}\`\`\`yaml\nname: x\nserver:\n  command: node\n  env:\n    ANY_NAME: v\nsql_tools:\n  - tool: q\n    arg: sql\n  - { tool: r, arg: s }\npacks: [core]\n\`\`\`\n`) },
      { name: "unknown YAML key in a planned fence is allowed", rule: "4", expect: false, mutate: (d) => writeFileSync(docs(d, "zz-fixture.mdx"), `${FM()}\`\`\`yaml planned\nbogus_top_level: ci\n\`\`\`\n`) },
      { name: "broken page link", rule: "5", expect: true, mutate: (d) => writeFileSync(docs(d, "zz-fixture.mdx"), `${FM()}See [x](/docs/no-such-page).\n`) },
      { name: "broken anchor on a real page", rule: "5", expect: true, mutate: (d) => writeFileSync(docs(d, "zz-fixture.mdx"), `${FM()}See [x](/docs/methodology#no-such-heading).\n`) },
      { name: "broken in-page anchor", rule: "5", expect: true, mutate: (d) => writeFileSync(docs(d, "zz-fixture.mdx"), `${FM()}See [x](#nowhere).\n`) },
      { name: "missing since", rule: "6", expect: true, mutate: (d) => writeFileSync(docs(d, "zz-fixture.mdx"), `export const meta = {\n  title: "F",\n  status: "shipped",\n};\n`) },
      { name: "bad status", rule: "6", expect: true, mutate: (d) => writeFileSync(docs(d, "zz-fixture.mdx"), `export const meta = {\n  title: "F",\n  since: "0.1",\n  status: "beta",\n};\n`) },
      { name: "planned page without the Status banner", rule: "6", expect: true, mutate: (d) => writeFileSync(docs(d, "zz-fixture.mdx"), `${FM("planned")}Text only.\n`) },
      { name: "real server name next to a grade", rule: "6", expect: true, mutate: (d) => writeFileSync(docs(d, "zz-fixture.mdx"), `${FM()}| Supabase MCP | B |\n`) },
      { name: "Server A with a grade is allowed", rule: "6", expect: false, mutate: (d) => writeFileSync(docs(d, "zz-fixture.mdx"), `${FM()}| Server A | B |\n`) },
      { name: "grade sentence missing from grades page", rule: "7", expect: true, mutate: (d) => edit(docs(d, "concepts", "grades.mdx"), (t) => t.replace(SENTENCE, "An A is good")) },
      { name: "grade sentence not linked", rule: "7", expect: true, mutate: (d) => edit(docs(d, "methodology.mdx"), (t) => t.split(SENTENCE_LINK).join("/docs/safety")) },
      { name: "check companion removed (companions are optional)", rule: "1", expect: false, mutate: (d) => rmSync(docs(d, "reference", "checks", "rls.mdx")) },
      { name: "companion for a check id that does not exist", rule: "1", expect: true, mutate: (d) => writeFileSync(docs(d, "reference", "checks", "no-such-check.mdx"), `${FM()}Text.\n`) },
      { name: "companion with a Verdict rules section", rule: "1", expect: true, mutate: (d) => edit(docs(d, "reference", "checks", "pii.mdx"), (t) => `${t}\n## Verdict rules\n\nx\n`) },
      { name: "companion repeating the generated Probes section", rule: "1", expect: true, mutate: (d) => edit(docs(d, "reference", "checks", "pii.mdx"), (t) => `${t}\n## Probes\n\nx\n`) },
      { name: "config key missing from the prose", rule: "2", expect: true, mutate: (d) => edit(gen(d, "config.json"), (t) => { const j = JSON.parse(t); j.push({ path: "server.no_such_key", type: "string", required: false, default: null, since: "0.1", status: "shipped", doc: "x" }); return JSON.stringify(j); }) },
      ...(existsSync(realOpts.cliJs) ? [
        { name: "generated checks.json is stale against the built CLI", rule: "8", expect: true, mutate: (d) => edit(gen(d, "checks.json"), (t) => t.replace('"label": "Valid MCP handshake and tool schemas"', '"label": "Valid handshake"')) },
        { name: "generated cli.json lacks a flag the CLI has", rule: "8", expect: true, mutate: (d) => edit(gen(d, "cli.json"), (t) => t.replace('"name": "--fail-under"', '"name": "--fail-below"')) },
        { name: "generated meta.json carries another methodology", rule: "8", expect: true, mutate: (d) => edit(gen(d, "meta.json"), (t) => t.replace(/"methodology": "[^"]+"/, '"methodology": "0.0-stale"')) },
      ] : []),
      ...(existsSync(realOpts.readme) ? [
        { name: "README exit-code table lacks a code the CLI declares", rule: "10", expect: true, mutate: (d) => edit(path.join(d, "cli-README.md"), (t) => t.replace(/^\| 4 \|.*\n/m, "")) },
        { name: "README exit-code table lists a code the CLI does not declare", rule: "10", expect: true, mutate: (d) => edit(path.join(d, "cli-README.md"), (t) => t.replace(/^(\| 4 \|.*\n)/m, "$1| 7 | made up |\n")) },
        { name: "README exit-code table lists signal codes", rule: "10", expect: false, mutate: (d) => edit(path.join(d, "cli-README.md"), (t) => t.replace(/^(\| 4 \|.*\n)/m, "$1| 137 | killed |\n")) },
      ] : []),
      ...(existsSync(realOpts.dataTs) ? [
        { name: "home page label differs from the CLI label", rule: "9", expect: true, mutate: (d) => edit(path.join(d, "data.ts"), (t) => t.replace('label: "Mutating SQL blocked"', 'label: "Mutating-SQL corpus blocked"')) },
      ] : []),
    ];
    for (const c of cases) {
      const dir = fresh();
      c.mutate(dir);
      const { failures } = runChecks(dir, { cliJs: realOpts.cliJs, dataTs: path.join(dir, "data.ts"), readme: path.join(dir, "cli-README.md"), gen: c.rule === "8" });
      const added = failures.filter((f) => !base.has(key(f)) && f.rule === c.rule);
      const ok = c.expect ? added.length > 0 : added.length === 0;
      if (!ok) bad++;
      console.log(`${ok ? "ok  " : "BAD "} rule ${c.rule}: ${c.name} -> ${c.expect ? (added.length ? "caught" : "NOT caught") : added.length ? "wrongly flagged: " + added[0].msg : "accepted"}`);
    }
    console.log(bad ? `docs:check --self-test: ${bad} case(s) wrong` : `docs:check --self-test: all ${cases.length} cases behave (baseline: ${base.size} existing failure${base.size === 1 ? "" : "s"} ignored)`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return bad ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------------------------

if (process.argv.includes("--self-test")) process.exit(selfTest());
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.env.DOCS_CHECK_ROOT || WEB);
  process.exit(report(runChecks(root)));
}
