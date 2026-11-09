// Opens or updates one GitHub issue per triage cluster in the Sealmark repo. Deduped by a hidden key in the body.
// Needs GH_TOKEN with Issues write on SEALMARK_REPO (default jordanallenlewis/sealmark). `--dry` prints only.
// Issues carry public server ids, rule ids, counts and scrubbed signatures: no server output, no secrets.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const REPO = process.env.SEALMARK_REPO ?? "jordanallenlewis/sealmark";
const DRY = process.argv.includes("--dry");
const MAX_NEW = Number(process.env.MAX_NEW_ISSUES ?? 5); // rate limit per run
const gh = (args, input) => execFileSync("gh", args, { encoding: "utf8", input });
const triage = JSON.parse(fs.readFileSync("fleet/triage.json", "utf8"));
const existing = DRY ? [] : JSON.parse(gh(["issue", "list", "-R", REPO, "--label", "from-fleet", "--state", "all", "--limit", "200", "--json", "number,state,body"]));
let opened = 0;
for (const c of triage.clusters) {
  const marker = `<!-- sealmark-triage:${c.key} -->`;
  const body = `${marker}\n${c.detail}\n\n**Servers that exposed it (${c.count}):** ${c.servers.map((s) => "`" + s + "`").join(", ")}${c.count > c.servers.length ? ", ..." : ""}\n\nWindow: ${triage.window} results, ${triage.graded} graded. Filed by the fleet triage (sealmark-site \`fleet/triage.mjs\`); updated each cycle. When fixed, the fixing PR adds the servers to the regression corpus (\`cli/test/corpus/\`) and the release regrades them.`;
  const hit = existing.find((i) => i.body?.includes(marker));
  if (DRY) { console.log("[dry]", hit ? "update" : "open", c.key, c.title); continue; }
  if (hit) {
    if (hit.state === "OPEN") gh(["issue", "edit", String(hit.number), "-R", REPO, "--body-file", "-"], body);
    else console.log("closed earlier, left alone (reopen by hand if it came back):", c.key);
    continue;
  }
  if (opened >= MAX_NEW) { console.log("rate limit reached, rest next cycle:", c.key); continue; }
  for (const l of ["from-fleet", ...c.labels]) { try { gh(["label", "create", l, "-R", REPO, "--force"]); } catch {} }
  gh(["issue", "create", "-R", REPO, "--title", c.title.slice(0, 120), "--body-file", "-", ...["from-fleet", ...c.labels].flatMap((l) => ["--label", l])], body);
  opened += 1;
}
console.log("issues opened:", opened);
