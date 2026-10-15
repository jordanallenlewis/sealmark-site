// npm run build: docs:check and docs:index first (once those scripts exist), then next build, then the page budget.
// Written so the build works before work packages D1 (docs-index.mjs) and D7 (docs-check.mjs) have landed.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = resolve(web, "node_modules/next/dist/bin/next");

function step(label, args) {
  console.log(`build: ${label}`);
  const r = spawnSync(process.execPath, args, { cwd: web, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`build: ${label} failed (exit ${r.status ?? r.signal})`);
    process.exit(r.status || 1);
  }
}

for (const [name, label] of [["docs-check.mjs", "docs:check"], ["docs-index.mjs", "docs:index"]]) {
  const file = resolve(web, "scripts", name);
  if (existsSync(file)) step(label, [file]);
  else console.log(`build: skipping ${label} (scripts/${name} does not exist yet)`);
}
step("next build", [nextBin, "build"]);
// Per-page weight ceilings and "no docs code on the marketing pages" (scripts/budget.mjs).
step("budget", [resolve(web, "scripts", "budget.mjs")]);
// The home page stays simple and the copy policy holds (word ceiling, no sealmark.ai, no status wording, honesty lines).
step("home-check", [resolve(web, "scripts", "home-check.mjs")]);
