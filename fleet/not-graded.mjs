// Servers the fleet tried but never graded, each with one typed reason, for the "Not graded yet" list on /results/.
// Not a grade and not a claim about the server: it says why our default run got no grade. Only the typed reason is
// kept; the error text and the server's stderr never leave history.jsonl.
// Usage: node fleet/not-graded.mjs (from the repository root; fleet/merge.mjs also calls writeNotGraded after a run)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const OUT = path.join("fleet", "not-graded.json");
const HISTORY = path.join("fleet", "history.jsonl");
const TELEMETRY = path.join("fleet", "telemetry.jsonl");
const RESULTS = path.join("web", "content", "data", "server-results.json");

// The CLI's typed start kinds (cli/src/start-failure.ts), plus harness-error: our own job failed, not the server.
export const REASONS = ["dependency-resolution", "needs-credentials", "missing-runtime", "bad-launch", "initialize-timeout", "exited-no-error", "needs-service", "harness-error", "unknown"];
const CLI_KINDS = new Set(REASONS.filter((r) => r !== "harness-error"));

// Read only for records the CLI did not type (older runs). The first rule that matches wins; anything else is unknown.
// npm's update notice is skipped on purpose: it is printed at exit and pushes the real error out of the saved stderr.
const RULES = [
  // Only a missing report is ours for sure: a stack trace in the error text is usually the server's own stderr.
  ["harness-error", /^no report$/],
  ["initialize-timeout", /did not answer (?:initialize )?within \d+ s|connect-timeout/i],
  ["needs-credentials", /\bnot (?:signed|logged) in\b|\bnot authenticated\b/i],
  ["needs-credentials", /\b[A-Z][A-Z0-9_]{0,60}(?:API_?KEY|TOKEN|SECRET)\b[^|\n]{0,60}?\b(?:is required|are required|missing|must be set)\b/],
  ["dependency-resolution", /\bE404\b|\bETARGET\b|No matching (?:version|distribution)|ModuleNotFoundError|No module named|Cannot find package/],
  ["missing-runtime", /\bspawn \S{1,200} ENOENT\b|: (?:command )?not found\b|command not found/],
  ["bad-launch", /(?:^|[|(:]\s?)usage: |unrecognized arguments?\b|\bunknown (?:option|argument)\b/i],
  // uvx lists the executables a package has when the one it was asked for is not among them
  ["bad-launch", /The following executables are available:/],
  ["missing-runtime", /\bis not on PATH\b/],
  // npm prints this pointer only when npm itself failed (an install or resolution error), so its own error was the cause
  ["dependency-resolution", /npm error A complete log of this run can be found/],
  // it looks for another program on the machine (a local port, a desktop application) that the default run does not have
  ["needs-service", /cannot reach https?:\/\/(?:localhost|127\.0\.0\.1)[:/\d]|(?:is )?not reachable on port \d+|Did you run [^.]{0,80}to start/i],
];

// The connection closed and the server's saved stderr holds nothing it wrote itself: it is empty, or only npm's update
// notice (printed at exit by npm) and the package manager's install progress (npm, uv: Downloaded, Built, Installed...).
// Any other stderr line, an error or a hint keeps it out of this reason.
const NOISE = /^(?:npm notice\b|(?:Downloaded|Downloading|Built|Installed|Prepared|Resolved|Audited|Using|Updated)\b|[+~-] \S+==)/;
export function exitedWithoutError(error) {
  const m = /^[^]*?Connection closed \(server stderr: ([^]*)\)\.?\s*$/.exec(String(error ?? ""));
  if (!m) return false;
  return m[1].split("|").map((l) => l.trim()).filter(Boolean).every((l) => NOISE.test(l));
}

/** One typed reason for a failed attempt's error text. */
export function reasonOf(error) {
  const e = String(error ?? "");
  for (const [reason, re] of RULES) if (re.test(e)) return reason;
  if (exitedWithoutError(e)) return "exited-no-error";
  return "unknown";
}

const isRecord = (r) => r && typeof r === "object" && typeof r.id === "string" && r.id;

/**
 * history: history.jsonl records; telemetry: telemetry.jsonl records (for the CLI's startKind); graded: ids on the results page.
 * Returns { count, byReason, servers: [{ id, version, lastTried, attempts, reason }] }, newest attempt first.
 */
export function buildNotGraded({ history = [], telemetry = [], graded = [] }) {
  const skip = new Set(graded);
  const everOk = new Set();
  const last = new Map();
  const attempts = new Map();
  for (const r of history) {
    if (!isRecord(r)) continue;
    if (r.status === "ok") everOk.add(r.id);
    if (r.status !== "failed") continue;
    attempts.set(r.id, (attempts.get(r.id) ?? 0) + 1);
    const prev = last.get(r.id);
    if (!prev || String(r.testedAt ?? "") >= String(prev.testedAt ?? "")) last.set(r.id, r);
  }
  const kind = new Map();
  for (const t of telemetry) {
    if (isRecord(t) && t.status === "failed" && CLI_KINDS.has(t.startKind)) kind.set(t.id + "@" + t.testedAt, t.startKind);
  }
  const servers = [];
  for (const [id, r] of last) {
    if (skip.has(id) || everOk.has(id)) continue;
    servers.push({
      id,
      version: typeof r.version === "string" ? r.version : null,
      lastTried: String(r.testedAt ?? ""),
      attempts: attempts.get(id),
      reason: kind.get(id + "@" + r.testedAt) ?? reasonOf(r.error),
    });
  }
  servers.sort((a, b) => b.lastTried.localeCompare(a.lastTried) || a.id.localeCompare(b.id));
  const byReason = {};
  for (const s of servers) byReason[s.reason] = (byReason[s.reason] ?? 0) + 1;
  return { count: servers.length, byReason, servers };
}

function readLines(file) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip a bad line
    }
  }
  return out;
}

/** Rebuilds fleet/not-graded.json from the committed fleet files. */
export function writeNotGraded() {
  let graded = [];
  try {
    graded = JSON.parse(fs.readFileSync(RESULTS, "utf8")).servers.map((s) => s.id);
  } catch {
    // no results file: list against nothing graded
  }
  const data = buildNotGraded({ history: readLines(HISTORY), telemetry: readLines(TELEMETRY), graded });
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + "\n");
  return data;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const d = writeNotGraded();
  console.log(`not graded: ${d.count} server(s)`, d.byReason);
}
