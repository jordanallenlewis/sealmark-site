// Merges a fleet run's Sealmark JSON reports into the website's results file
// and appends grade history.
// Usage: node fleet/merge.mjs <reportsDir>

import fs from "node:fs";
import path from "node:path";

const RESULTS = path.join("web", "content", "data", "server-results.json");
const DISCOVERED = path.join("fleet", "discovered.json");
const HISTORY = path.join("fleet", "history.jsonl");

const reportsDir = process.argv[2];
if (!reportsDir) {
  console.error("usage: node fleet/merge.mjs <reportsDir>");
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);

function readJson(file) {
  try {
    const text = fs.readFileSync(file, "utf8");
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return null;
  }
}

const results = readJson(RESULTS) ?? { servers: [] };
if (!Array.isArray(results.servers)) results.servers = [];
let discovered = readJson(DISCOVERED);
if (!Array.isArray(discovered)) discovered = [];

// History is an append-only JSONL log; create it and its folder if needed.
fs.mkdirSync(path.dirname(HISTORY), { recursive: true });
if (!fs.existsSync(HISTORY)) fs.writeFileSync(HISTORY, "");

function appendHistory(rec) {
  fs.appendFileSync(HISTORY, JSON.stringify(rec) + "\n");
}

const subfolders = fs
  .readdirSync(reportsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const LETTERS = "FDCBA"; // ascending, F is the worst letter
let merged = 0;
let failed = 0;
let added = 0;

for (const name of subfolders) {
  const dir = path.join(reportsDir, name);
  const meta = readJson(path.join(dir, "meta.json"));
  if (!meta || !meta.id) continue;
  const report = readJson(path.join(dir, "sealmark.json"));
  if (!report || report.status === "failed") {
    appendHistory({
      id: meta.id,
      version: meta.version,
      testedAt: today,
      status: "failed",
      error: report?.error ?? "no report",
    });
    failed += 1;
    continue;
  }
  const r = report;
  const entry = {
    id: meta.id,
    name: meta.name,
    ecosystem: meta.ecosystem,
    round: "fleet",
    refTested: meta.ecosystem === "github" ? (meta.version ?? null) : undefined,
    versionTested: r.server?.resolved?.package?.version ?? meta.version ?? r.server?.version ?? null,
    serverInfoName: r.server?.name ?? null,
    testedAt: (r.startedAt ?? today).slice(0, 10),
    sealmark: r.sealmark,
    standard: r.config?.standard ?? null,
    configHash: (r.config?.hash ?? "").slice(0, 19),
    launch: meta.launch,
    transport: r.server?.transport ?? null,
    toolCount: (r.server?.tools ?? []).length,
    packs: Object.entries(r.packs ?? {}).map(([id, p]) => ({
      id: id,
      status: p.status,
      letter: p.grade?.letter ?? null,
      points: p.grade?.points ?? null,
      scored: p.grade?.scored ?? null,
      pct: p.grade?.pct ?? null,
      provisional: !!p.grade?.provisional,
      capped: !!p.grade?.capped,
      criticalFails: p.grade?.criticalFails ?? [],
      reason: p.reason ?? null,
    })),
    checks: (r.checks ?? []).map((c) => ({
      id: c.id,
      pack: c.pack,
      label: c.label,
      critical: !!c.critical,
      advisory: !!c.advisory,
      verdict: c.verdict,
      summary: c.summary,
    })),
    coverage: r.coverage ?? null,
    badge: r.badge ?? null,
    notCovered: r.notCovered ?? [],
    warnings: r.warnings ?? [],
    automated: true,
  };
  const idx = results.servers.findIndex((s) => s.id === meta.id);
  if (idx >= 0) results.servers[idx] = entry;
  else results.servers.push(entry);
  merged += 1;
  if (meta.isNew && !discovered.some((d) => d.id === meta.id)) {
    discovered.push({ id: meta.id, name: meta.name, ecosystem: meta.ecosystem, launch: meta.launch });
    added += 1;
  }
  let worst = null;
  const graded = {};
  for (const p of entry.packs) {
    if (p.status !== "graded" || p.letter == null) continue;
    graded[p.id] = p.letter;
    if (worst === null || LETTERS.indexOf(p.letter) < LETTERS.indexOf(worst)) worst = p.letter;
  }
  appendHistory({
    id: meta.id,
    version: entry.versionTested,
    sealmark: entry.sealmark?.version ?? null,
    testedAt: entry.testedAt,
    status: "ok",
    worst,
    packs: graded,
  });
}

fs.writeFileSync(RESULTS, JSON.stringify(results, null, 2) + "\n");
fs.writeFileSync(DISCOVERED, JSON.stringify(discovered, null, 2) + "\n");
console.log(`merged ${merged} report(s), ${failed} failed, ${added} new`);
