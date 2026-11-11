// npm run build (scripts/build.mjs): writes worker/grades.json, the compact grade table the notify Worker bundles
// (one row per server: name, version, letter, graded packs, failing check ids and their labels). The Worker is
// redeployed with every fleet run, so this table is always the grades the site shows. Generated, not tracked.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gradeRow } from "../worker/notify-core.mjs";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(resolve(web, "content/data/server-results.json"), "utf8"));
const out = {};
// The results pages honour SEALMARK_PUBLISH_RESULTS=0 (lib/results.ts); so does the Worker's table.
if (process.env.SEALMARK_PUBLISH_RESULTS !== "0") for (const s of data.servers) out[s.id] = gradeRow(s);
writeFileSync(resolve(web, "worker/grades.json"), JSON.stringify(out));
console.log(`notify-grades: ${Object.keys(out).length} servers -> worker/grades.json`);
