// Clusters fleet telemetry into Sealmark issues (bugs, crashes, noisy rules, missing checks, slow paths, hardening gaps).
// Reads fleet/telemetry.jsonl; writes fleet/triage.json (stable cluster keys, for dedupe) and fleet/triage-summary.md.
// Public data only: server ids are public package names, no server output or secrets are carried over.
// Usage: node fleet/triage.mjs
import fs from "node:fs";

const WINDOW = Number(process.env.TRIAGE_WINDOW ?? 600); // most recent telemetry records considered
const MIN_N = 20; // a rule needs this many results before it can be called noisy
const NOISY_RATE = 0.35; // rule fails or hedges on this share of graded servers
const SLOW_S = 300;
const LETTERS = "FDCBA";

const rows = fs.existsSync("fleet/telemetry.jsonl")
  ? fs.readFileSync("fleet/telemetry.jsonl", "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];
const recent = rows.slice(-WINDOW);
const ok = recent.filter((r) => r.status === "ok");
const failed = recent.filter((r) => r.status === "failed");
const clusters = [];
const add = (c) => clusters.push({ servers: [], ...c, servers: [...new Set(c.servers)].slice(0, 25) });

// 1. Sealmark crashed (not the server failing to start): always a bug.
const crashes = new Map();
for (const r of failed.filter((x) => x.failClass === "sealmark-crash")) {
  (crashes.get(r.errorSig) ?? crashes.set(r.errorSig, []).get(r.errorSig)).push(r);
}
for (const [sig, rs] of crashes) {
  add({ key: "crash:" + sig.slice(0, 60).replace(/[^a-z0-9]+/gi, "-").toLowerCase(), kind: "crash", labels: ["bug", "crash"],
    title: "Crash: " + sig.slice(0, 80), servers: rs.map((r) => r.id), count: rs.length,
    detail: "Sealmark threw while grading these servers. Signature (scrubbed): `" + sig + "`" });
}

// 2. Noisy rules: a check that fails or can't decide on a large share of servers is a false-positive or missing-coverage candidate.
const rule = new Map();
for (const r of ok) {
  for (const [id, verdict, critical] of r.ruleHits ?? []) {
    const e = rule.get(id) ?? rule.set(id, { fail: [], hedge: [], critical: 0 }).get(id);
    (verdict === "fail" ? e.fail : e.hedge).push(r.id);
    if (critical && verdict === "fail") e.critical += 1;
  }
}
// how many graded records carried each check, estimated by the number of ok records (each pack check is optional)
if (ok.length >= MIN_N) {
  for (const [id, e] of rule) {
    const failRate = e.fail.length / ok.length;
    const hedgeRate = e.hedge.length / ok.length;
    if (failRate >= NOISY_RATE) {
      add({ key: "noisy:" + id, kind: "noisy-rule", labels: ["noisy-rule", "false-positive?"], title: `Noisy rule: ${id} fails on ${Math.round(failRate * 100)}% of graded servers`,
        servers: e.fail, count: e.fail.length, detail: `Check \`${id}\` failed on ${e.fail.length}/${ok.length} recent results (${e.critical} critical). Review a sample for false positives; a rule that fails this widely is either a real ecosystem problem (document it) or too strict.` });
    }
    if (hedgeRate >= NOISY_RATE) {
      add({ key: "undecided:" + id, kind: "missing-check", labels: ["missing-check"], title: `Check cannot decide: ${id} is inconclusive/partial on ${Math.round(hedgeRate * 100)}% of servers`,
        servers: e.hedge, count: e.hedge.length, detail: `Check \`${id}\` returned inconclusive or partial on ${e.hedge.length}/${ok.length} recent results. Probe or fixture coverage is probably missing.` });
    }
  }
}

// 3. Slow paths and timeouts.
const slow = recent.filter((r) => (r.durationS ?? 0) >= SLOW_S || r.failClass === "timeout");
if (slow.length >= 3) {
  add({ key: "slow:run", kind: "slow-path", labels: ["performance"], title: `Slow runs: ${slow.length} servers took over ${SLOW_S / 60} min or timed out`,
    servers: slow.map((r) => r.id), count: slow.length, detail: `Longest: ${Math.max(...slow.map((r) => r.durationS ?? 0))} s. Find which probe or pack dominates and add a per-probe budget.` });
}

// 4. Hardening gap: the harness fails to start servers at a high rate (most need credentials, but each class should be named and skipped cleanly).
const start = failed.filter((r) => r.failClass === "start-fail");
const sigs = new Map();
for (const r of start) { const k = r.errorSig.replace(/\d+/g, "#").slice(0, 80); sigs.set(k, (sigs.get(k) ?? 0) + 1); }
const startRate = recent.length ? start.length / recent.length : 0;
if (recent.length >= MIN_N && startRate >= 0.3) {
  const kinds = new Map();
  for (const r of start) kinds.set(r.startKind ?? "", (kinds.get(r.startKind ?? "") ?? 0) + 1);
  const byKind = [...kinds.entries()].filter(([k]) => k).sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k}: ${n}`);
  if (kinds.get("")) byKind.push(`- untyped (older CLI or no kind): ${kinds.get("")}`);
  const top = [...sigs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `- ${n}x \`${k}\``).join("\n");
  add({ key: "hardening:start-fail", kind: "hardening", labels: ["hardening"], title: `${Math.round(startRate * 100)}% of servers never start under the fleet harness`,
    servers: start.map((r) => r.id), count: start.length, detail: "Most are servers that need credentials or a runtime Sealmark's launch inference does not provide. The CLI types each start failure (sealmark 1.0.1); by kind:\n" + byKind.join("\n") + "\nTop signatures:\n" + top });
}

// 5. Regression candidates: same server version, different Sealmark version, worse grade, no gain in tools.
// More tools on the same id@version is a server change (a bridge to a remote endpoint can gain tools without a new
// package version, sealmark#24), so it is listed apart. Fewer or zero tools stays a regression candidate: a Sealmark
// bug in listing tools (paging, a crash in tools/list) looks exactly like that.
const byKey = new Map();
for (const r of ok) {
  const k = r.id + "@" + r.serverVersion;
  (byKey.get(k) ?? byKey.set(k, []).get(k)).push(r);
}
const regress = [];
const surfaceChanged = [];
const toolsKnown = (r) => Number.isInteger(r.toolCount) && r.toolCount > 0;
for (const [k, rs] of byKey) {
  const vs = [...new Set(rs.map((r) => r.sealmark))];
  if (vs.length < 2) continue;
  const a = rs[rs.length - 2], b = rs[rs.length - 1];
  if (a.sealmark === b.sealmark || LETTERS.indexOf(b.worst) >= LETTERS.indexOf(a.worst)) continue;
  if (toolsKnown(a) && toolsKnown(b) && b.toolCount > a.toolCount) surfaceChanged.push({ id: r0(k), from: a, to: b });
  else regress.push({ id: r0(k), from: a, to: b });
}
function r0(k) { return k.split("@")[0]; }
if (regress.length) {
  add({ key: "regression:grade-drop", kind: "regression", labels: ["bug", "regression"], title: `Grade drops with no server change: ${regress.length} server(s) on ${regress[0].from.sealmark} to ${regress[0].to.sealmark}`,
    servers: regress.map((x) => x.id), count: regress.length,
    detail: "Same server version, newer Sealmark, lower grade. Either a new rule is catching a real problem (add the server to the corpus as a true positive) or a rule regressed (false positive). Decide per server:\n" + regress.slice(0, 15).map((x) => `- ${x.id}: ${x.from.worst} to ${x.to.worst}`).join("\n") });
}

const out = { generatedAt: new Date().toISOString(), window: recent.length, graded: ok.length, failed: failed.length, clusters, surfaceChanged: surfaceChanged.map((x) => x.id) };
fs.writeFileSync("fleet/triage.json", JSON.stringify(out, null, 2) + "\n");
const md = ["## Fleet triage", "", `Window: ${recent.length} results (${ok.length} graded, ${failed.length} failed). ${clusters.length} issue cluster(s).`, "",
  ...(clusters.length ? ["| kind | cluster | servers |", "|---|---|---|", ...clusters.map((c) => `| ${c.kind} | ${c.title.replace(/\|/g, "/")} | ${c.count} |`)] : ["No clusters: nothing for Sealmark to fix from this window."]),
  ...(surfaceChanged.length ? ["", `Grade drops left out of the regression check because the server gained tools on the same version (a server change, not Sealmark): ${surfaceChanged.slice(0, 15).map((x) => `${x.id} (${x.from.toolCount} to ${x.to.toolCount} tools, ${x.from.worst} to ${x.to.worst})`).join(", ")}${surfaceChanged.length > 15 ? `, and ${surfaceChanged.length - 15} more (fleet/triage.json)` : ""}`] : [])];
fs.writeFileSync("fleet/triage-summary.md", md.join("\n") + "\n");
console.log(md.join("\n"));
