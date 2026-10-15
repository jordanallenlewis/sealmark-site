// npm run docs:gen
// Regenerates web/content/generated/{meta,checks,config,cli,packs,profiles}.json from the real, built CLI:
//   node node_modules/sealmark/dist/cli.js describe          (sealmark.describe/1)
//   node node_modules/sealmark/dist/cli.js explain <id> --json   (one call per check id, for the remediation and scoring text)
// The JSON is checked in, so the web build never needs the CLI built; `npm run docs:check` runs this script with
// --check whenever node_modules/sealmark/dist/cli.js exists, so a stale committed file fails the build.
//
// Usage:
//   node scripts/docs-gen.mjs                 write the files
//   node scripts/docs-gen.mjs --check         compare a fresh mapping with the committed files; exit 1 on any difference
//   node scripts/docs-gen.mjs --check --dir <generated dir>   the same against another directory (used by docs:check --self-test)
//
// Exit codes: 0 ok, 1 anything else (the CLI is not built, it crashed, printed bad JSON, or --check found a difference).
// The output is byte-stable: keys in the order the CLI prints them, no timestamps, so `git diff --exit-code` works in CI.
import { execFile, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliJs = resolve(web, "node_modules/sealmark/dist/cli.js");
const argv = process.argv.slice(2);
const checkMode = argv.includes("--check");
const dirAt = argv.indexOf("--dir");
const outDir = dirAt >= 0 && argv[dirAt + 1] ? resolve(argv[dirAt + 1]) : resolve(web, "content/generated");

const die = (msg, more = []) => {
  console.error(`docs:gen: ${msg}`);
  for (const m of more) console.error(m);
  process.exit(1);
};

if (!existsSync(cliJs)) die(`${cliJs} does not exist.`, ["docs:gen needs the Sealmark CLI from npm. Install it first:  npm ci"]);

// Run from an empty directory so no sealmark.yaml or environment of the caller can change what the CLI prints.
const cwd = tmpdir();
const runCli = (args) => {
  const r = spawnSync(process.execPath, [cliJs, ...args], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (r.error) die(`could not run the CLI: ${r.error.message}`);
  if (r.status !== 0) die(`"sealmark ${args.join(" ")}" failed with exit ${r.status ?? r.signal}.`, [(r.stderr || "").trim().split("\n").slice(0, 8).join("\n")]);
  try {
    return JSON.parse(r.stdout);
  } catch (e) {
    return die(`"sealmark ${args.join(" ")}" printed invalid JSON: ${e.message}`);
  }
};

const d = runCli(["describe"]);
if (d.format !== "sealmark.describe/1") die(`expected format "sealmark.describe/1", got ${JSON.stringify(d.format)}.`);
const missing = ["sealmark", "packs", "checks", "configKeys", "profiles", "cli"].filter((k) => d[k] === undefined);
if (missing.length || !d.sealmark?.version || !d.sealmark?.methodology || !Array.isArray(d.checks) || !Array.isArray(d.configKeys) || !Array.isArray(d.packs) || !Array.isArray(d.profiles) || !d.cli?.commands || !d.cli?.flags || !d.cli?.exitCodes) {
  die(`describe output is missing: ${missing.join(", ") || "sealmark.version, sealmark.methodology or cli.commands, flags, exitCodes"}`);
}

// checks.json: the check as describe prints it, plus what only `explain` knows: the remediation, the scoring sentence
// and the settings (key, default, meaning) of the check. One CLI start per check id, eight at a time (each start is ~1 s).
const explain = (id) =>
  new Promise((res) => {
    execFile(process.execPath, [cliJs, "explain", id, "--json"], { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return die(`"sealmark explain ${id} --json" failed: ${err.message}`, [String(stderr).trim().split("\n").slice(0, 6).join("\n")]);
      try {
        res(JSON.parse(stdout));
      } catch (e) {
        die(`"sealmark explain ${id} --json" printed invalid JSON: ${e.message}`);
      }
    });
  });
const explained = new Array(d.checks.length);
let nextIdx = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (nextIdx < d.checks.length) {
      const i = nextIdx++;
      explained[i] = await explain(d.checks[i].id);
    }
  }),
);
const checks = d.checks.map((c, i) => {
  const e = explained[i];
  if (JSON.stringify(e.check) !== JSON.stringify(c)) die(`"explain ${c.id}" and "describe" disagree about the check; the CLI is inconsistent.`);
  return { ...c, remediation: e.remediation ?? "", scoring: e.scoring ?? "", settings: e.settings ?? [] };
});

const files = {
  "meta.json": { methodology: d.sealmark.methodology, cliVersion: d.sealmark.version, format: d.format, source: "describe" },
  "checks.json": checks,
  "config.json": d.configKeys,
  "cli.json": { commands: d.cli.commands, flags: d.cli.flags.map((f) => ({ ...f, name: `--${f.name}`, doc: f.description })), exitCodes: d.cli.exitCodes },
  "packs.json": d.packs,
  "profiles.json": d.profiles,
};
const render = (v) => `${JSON.stringify(v, null, 2)}\n`;

if (checkMode) {
  const stale = [];
  for (const [name, value] of Object.entries(files)) {
    const f = resolve(outDir, name);
    if (!existsSync(f)) stale.push(`${name} is missing`);
    else if (readFileSync(f, "utf8") !== render(value)) stale.push(`${name} differs from what the CLI prints now`);
  }
  if (stale.length) die(`the committed files are stale (CLI ${d.sealmark.version}, methodology ${d.sealmark.methodology}):`, [...stale.map((s) => `  - ${s}`), "Run `npm run docs:gen` in web/ and commit content/generated."]);
  console.log(`docs:gen --check: OK, ${Object.keys(files).length} files match the built CLI ${d.sealmark.version} (methodology ${d.sealmark.methodology}).`);
} else {
  mkdirSync(outDir, { recursive: true });
  for (const [name, value] of Object.entries(files)) writeFileSync(resolve(outDir, name), render(value));
  console.log(`docs:gen: wrote ${checks.length} checks, ${d.configKeys.length} config keys, ${d.cli.commands.length} commands, ${d.cli.flags.length} flags, ${d.packs.length} packs, ${d.profiles.length} profiles to content/generated (from the real CLI ${d.sealmark.version}).`);
}
