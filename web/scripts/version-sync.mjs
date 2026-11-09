// npm run version:sync -- <version> [--notes-file <file>] [--date YYYY-MM-DD]   rewrite the hand-written Sealmark version markers
// npm run version:check                                                          fail when any marker or the changelog is behind the pinned CLI
// The marker list below is the whole set of places the docs name the CLI's own version (not an example server's version).
// The generated JSON (content/generated) is not touched here: `npm run docs:gen` rebuilds it from the pinned CLI.
// Used by .github/workflows/release-sync.yml so sealmark.dev follows every npm release.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const check = argv.includes("--check");
const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const pinned = JSON.parse(readFileSync(resolve(web, "package.json"), "utf8")).devDependencies.sealmark;
const version = argv.find((a) => /^\d+\.\d+\.\d+$/.test(a)) ?? pinned;
if (!/^\d+\.\d+\.\d+$/.test(version)) { console.error(`version:sync: "${version}" is not a plain x.y.z version`); process.exit(1); }

const V = "\\d+\\.\\d+\\.\\d+";
const markers = [
  ["content/docs/index.mdx", new RegExp(`(Sealmark )${V}(, methodology)`), `$1${version}$2`],
  ["content/docs/reference/output.mdx", new RegExp(`(^sealmark )${V}( · methodology)`, "m"), `$1${version}$2`],
  ["content/docs/reference/output.mdx", new RegExp(`("sealmark": \\{ "version": ")${V}(")`), `$1${version}$2`],
  ["content/docs/concepts/standard-vs-custom.mdx", new RegExp(`(^sealmark )${V}( · methodology)`, "gm"), `$1${version}$2`],
  ["content/docs/changelog.mdx", new RegExp(`(Sealmark )${V}( is the CLI release)`), `$1${version}$2`],
];

const stale = [];
const files = new Map();
const read = (f) => (files.has(f) ? files.get(f) : files.set(f, readFileSync(resolve(web, f), "utf8")).get(f));
for (const [f, re, to] of markers) {
  const text = read(f);
  if (!re.test(text)) { stale.push(`${f}: marker ${re} not found (the docs changed; update scripts/version-sync.mjs)`); continue; }
  const next = text.replace(re, to);
  if (next !== text) { stale.push(`${f}: names an older Sealmark version than ${version}`); files.set(f, next); }
}

// Changelog: a "## <version> (" heading must exist. Sync adds one from the GitHub Release notes when it is missing.
const cl = "content/docs/changelog.mdx";
let log = read(cl);
if (!new RegExp(`^## ${version.replace(/\./g, "\\.")}( |$)`, "m").test(log)) {
  stale.push(`${cl}: no "## ${version}" entry`);
  const notesFile = opt("--notes-file");
  if (!check && notesFile) {
    const notes = readFileSync(notesFile, "utf8").trim().replace(/^#+ .*\n+/, "");
    const date = opt("--date") ?? new Date().toISOString().slice(0, 10);
    // MDX treats { < as syntax: keep the notes plain by escaping braces and angle brackets outside code spans.
    const safe = notes.split(/(`[^`]*`)/).map((p, i) => (i % 2 ? p : p.replace(/[{}<>]/g, (c) => `\\${c}`))).join("");
    const at = log.search(/^## /m);
    log = `${log.slice(0, at)}## ${version} (${date})\n\n${safe}\n\n${log.slice(at)}`;
    files.set(cl, log);
  }
}

if (check) {
  if (stale.length) { console.error(`version:check: the docs are behind sealmark@${version}:\n- ${stale.join("\n- ")}\nRun: npm run version:sync`); process.exit(1); }
  console.log(`version:check: docs match sealmark@${version}`);
} else {
  for (const [f, t] of files) writeFileSync(resolve(web, f), t);
  const still = !new RegExp(`^## ${version.replace(/\./g, "\\.")}( |$)`, "m").test(files.get(cl));
  if (still) { console.error(`version:sync: no changelog entry for ${version} and no --notes-file given`); process.exit(1); }
  console.log(`version:sync: markers now name sealmark@${version}`);
}
