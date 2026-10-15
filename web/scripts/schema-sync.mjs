// node scripts/schema-sync.mjs           copy node_modules/sealmark/schema/sealmark.schema.json to public/schema/v1/sealmark.schema.json
// node scripts/schema-sync.mjs --check   compare the two files and exit 1 when they differ (npm run schema:check)
//
// The sealmark npm package ships schema/sealmark.schema.json from the config registry. The website serves a byte copy of it at
// https://sealmark.dev/schema/v1/sealmark.schema.json (Next.js serves public/ from the site root), so editors can point at a
// stable URL. The copy only goes live with the next deploy. cli/src/test/schema-hosted.docs.test.ts runs the same comparison.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(web, "node_modules/sealmark/schema/sealmark.schema.json");
const target = resolve(web, "public/schema/v1/sealmark.schema.json");
const shown = (p) => relative(process.cwd(), p) || p;

if (!existsSync(source)) {
  console.error(`schema-sync: ${shown(source)} does not exist. Build the CLI first: cd cli && npm run build`);
  process.exit(1);
}

if (process.argv.includes("--check")) {
  const same = existsSync(target) && readFileSync(source, "utf8") === readFileSync(target, "utf8");
  if (!same) {
    console.error(`schema-sync: ${shown(target)} is ${existsSync(target) ? "out of date with" : "missing next to"} ${shown(source)}. Run: npm run schema:sync`);
    process.exit(1);
  }
  console.log("schema-sync: the hosted schema matches the CLI schema");
} else {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  console.log(`schema-sync: copied ${shown(source)} to ${shown(target)}`);
}
