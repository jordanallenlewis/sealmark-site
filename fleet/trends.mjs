// Grade trends per Sealmark version: coverage, grade mix, regressions and improvements.
// Reads fleet/history.jsonl; writes web/content/data/trends.json (site) and fleet/trends-summary.md (CI summary).
import fs from "node:fs";
const LETTERS = "FDCBA";
const rows = fs.readFileSync("fleet/history.jsonl", "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const ver = (r) => r.sealmark ?? "pre-1.0 (unrecorded)";
const versions = new Map();
for (const r of rows) {
  const v = versions.get(ver(r)) ?? versions.set(ver(r), { version: ver(r), servers: new Set(), graded: 0, failed: 0, letters: {}, firstSeen: r.testedAt, lastSeen: r.testedAt }).get(ver(r));
  v.servers.add(r.id);
  if (r.testedAt < v.firstSeen) v.firstSeen = r.testedAt;
  if (r.testedAt > v.lastSeen) v.lastSeen = r.testedAt;
  if (r.status === "ok") { v.graded += 1; v.letters[r.worst] = (v.letters[r.worst] ?? 0) + 1; } else v.failed += 1;
}
// latest result per server per Sealmark version, to compare the same server across versions
const last = new Map();
for (const r of rows) if (r.status === "ok") last.set(r.id + "|" + ver(r), r);
const order = [...versions.keys()].sort((a, b) => versions.get(a).firstSeen.localeCompare(versions.get(b).firstSeen) || a.localeCompare(b));
const moves = [];
for (let i = 1; i < order.length; i++) {
  let up = 0, down = 0, same = 0;
  for (const id of new Set(rows.map((r) => r.id))) {
    const a = last.get(id + "|" + order[i - 1]), b = last.get(id + "|" + order[i]);
    if (!a || !b) continue;
    const d = LETTERS.indexOf(b.worst) - LETTERS.indexOf(a.worst);
    if (d > 0) up++; else if (d < 0) down++; else same++;
  }
  moves.push({ from: order[i - 1], to: order[i], improved: up, regressed: down, unchanged: same });
}
const byVersion = order.map((k) => { const v = versions.get(k); return { version: k, servers: v.servers.size, graded: v.graded, failed: v.failed, letters: v.letters, firstSeen: v.firstSeen, lastSeen: v.lastSeen }; });
const latestOk = new Map(); for (const r of rows) if (r.status === "ok") latestOk.set(r.id, r);
const total = { trackedWithGrade: latestOk.size, everFailedOnly: new Set(rows.map((r) => r.id)).size - latestOk.size };
fs.writeFileSync("web/content/data/trends.json", JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), total, byVersion, moves }, null, 2) + "\n");
const md = ["## Grade trends by Sealmark version", "", `Graded now: ${total.trackedWithGrade} servers; never graded: ${total.everFailedOnly}.`, "",
  "| Sealmark | servers | graded | failed to start | A | B | C | D | F |", "|---|---|---|---|---|---|---|---|---|",
  ...byVersion.map((v) => `| ${v.version} | ${v.servers} | ${v.graded} | ${v.failed} | ${["A","B","C","D","F"].map((l) => v.letters[l] ?? 0).join(" | ")} |`), "",
  ...(moves.length ? ["| from | to | improved | regressed | unchanged |", "|---|---|---|---|---|", ...moves.map((m) => `| ${m.from} | ${m.to} | ${m.improved} | ${m.regressed} | ${m.unchanged} |`)] : [])];
fs.writeFileSync("fleet/trends-summary.md", md.join("\n") + "\n");
console.log(md.join("\n"));
