#!/usr/bin/env node
// deploy-guard: forward-only production deploys. Zero dependencies.
// Rule: a prod deploy's target must be a git descendant of the live prod SHA,
// unless it is an explicit, logged rollback that carries an approval id. After the deploy, live must equal intended.
//
//   deploy-guard check  --repo <dir> --target <ref> --worker <name> | --live-cmd "<prints a sha>"
//                       [--rollback --approval <id> --reason "<why>"] [--ledger <file>] [--task <id>]
//   deploy-guard record --repo <dir> --target <ref> [--task <id>] [--ledger <file>]   (after a green deploy)
//   deploy-guard probe  --expect <ref> --repo <dir> (--worker <name> | --live-cmd ..) [--alert-cmd "<cmd>"] [--ledger <file>]
//   deploy-guard tag    --repo <dir> --target <ref>   prints the wrangler flags that stamp a Worker version with its SHA
//
// Exit codes: 0 allowed/ok, 4 DENIED (not forward-only), 5 live != intended or live unknown (alert fired), 2 usage.
// Live SHA sources, in order: --live-cmd output, a Worker version message "sha=<40 hex>" (set by `tag`), the last
// ledger entry. No source means DENY (fail closed): bootstrap with `record` once after a verified deploy.
import { execFileSync, execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA = /^[0-9a-f]{40}$/;

// PURE. The whole policy. isAncestor(live, target) is injected so tests need no git.
export function decide({ live, target, isAncestor, rollback = false, approval = "", reason = "" }) {
  if (!SHA.test(target || "")) return { allow: false, code: "bad-target", why: `target is not a full sha: ${target}` };
  if (!live) return { allow: false, code: "live-unknown", why: "live prod SHA is unknown; refusing (fail closed). Bootstrap: deploy-guard record after a verified deploy" };
  if (!SHA.test(live)) return { allow: false, code: "bad-live", why: `live is not a full sha: ${live}` };
  if (live === target) return { allow: true, code: "same", why: "target equals live (redeploy)" };
  if (isAncestor(live, target)) return { allow: true, code: "forward", why: "target descends from live" };
  if (rollback) {
    if (!approval || !reason) return { allow: false, code: "rollback-unapproved", why: "rollback needs --approval <id> and --reason" };
    return { allow: true, code: "rollback", why: `logged rollback (${approval}): ${reason}`, rollback: true };
  }
  return { allow: false, code: "not-forward", why: `target ${target.slice(0, 12)} is not a descendant of live ${live.slice(0, 12)}; explicit rollback with --rollback --approval <id> --reason required` };
}

// PURE. Pull the live sha out of a Worker version annotations object.
export function shaFromAnnotations(a = {}) {
  const m = /sha=([0-9a-f]{40})/.exec(`${a["workers/message"] || ""} ${a["workers/tag"] || ""}`);
  return m ? m[1] : null;
}

const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
export const resolveSha = (repo, ref) => git(repo, "rev-parse", "--verify", `${ref}^{commit}`);
export function isAncestorGit(repo) {
  return (a, b) => {
    try { execFileSync("git", ["-C", repo, "merge-base", "--is-ancestor", a, b], { stdio: "ignore" }); return true; } catch (e) {
      if (e.status === 1) return false;
      throw new Error(`git merge-base failed (is ${a.slice(0, 12)} fetched?): ${e.message}`);
    }
  };
}

export function readLedger(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
export function appendLedger(file, entry) {
  mkdirSync(dirname(file), { recursive: true });
  const gen = readLedger(file).reduce((m, e) => Math.max(m, e.generation || 0), 0) + 1;
  const row = { at: new Date().toISOString(), generation: gen, ...entry };
  appendFileSync(file, JSON.stringify(row) + "\n");
  return row;
}
export const ledgerLive = (file) => readLedger(file).filter((e) => e.event === "deployed" || e.event === "probe-ok").map((e) => e.sha).pop() || null;

function workerLive(name) {
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };
  const run = (c) => JSON.parse(execSync(c, { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }));
  const dep = run(`npx -y wrangler@4 deployments list --name ${JSON.stringify(name)} --json`);
  const cur = dep[dep.length - 1];
  const top = (cur?.versions || []).find((v) => v.percentage === 100) || (cur?.versions || [])[0];
  if (!top) return null;
  return shaFromAnnotations(run(`npx -y wrangler@4 versions view ${top.version_id} --name ${JSON.stringify(name)} --json`).annotations);
}

function liveSha(o, ledger) {
  if (o["live-cmd"]) return execSync(o["live-cmd"], { encoding: "utf8" }).trim();
  if (o.worker) { try { const s = workerLive(o.worker); if (s) return s; } catch (e) { console.error(`deploy-guard: could not read the live Worker version (${String(e.message).split("\n")[0]}); falling back to the ledger`); } }
  return ledger ? ledgerLive(ledger) : null;
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const k = argv[i].slice(2);
    o[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return o;
}

export function main(argv, out = console) {
  const [cmd, ...rest] = argv;
  const o = args(rest);
  const repo = resolve(o.repo || ".");
  const ledger = o.ledger || join(homedir(), ".deploy-guard", `${repo.split(/[\\/]/).pop()}.jsonl`);
  const need = (k) => { if (!o[k] || o[k] === true) { out.error(`missing --${k}`); process.exit(2); } return o[k]; };
  if (cmd === "check") {
    const target = resolveSha(repo, need("target"));
    const live = liveSha(o, ledger);
    const d = decide({ live, target, isAncestor: isAncestorGit(repo), rollback: !!o.rollback, approval: o.approval || "", reason: o.reason || "" });
    appendLedger(ledger, { event: d.allow ? "check-allow" : "check-deny", code: d.code, sha: target, live, task: o.task || null, why: d.why, rollback: !!d.rollback });
    (d.allow ? out.log : out.error)(`deploy-guard: ${d.allow ? "ALLOW" : "DENY"} (${d.code}): ${d.why}`);
    return d.allow ? 0 : 4;
  }
  if (cmd === "record") {
    const sha = resolveSha(repo, need("target"));
    appendLedger(ledger, { event: "deployed", sha, task: o.task || null });
    out.log(`deploy-guard: recorded deploy ${sha.slice(0, 12)}`);
    return 0;
  }
  if (cmd === "probe") {
    const expect = resolveSha(repo, need("expect"));
    const live = liveSha(o, null);
    if (live === expect) { appendLedger(ledger, { event: "probe-ok", sha: expect }); out.log(`deploy-guard: live == intended (${expect.slice(0, 12)})`); return 0; }
    const msg = `deploy-guard DRIFT: intended ${expect.slice(0, 12)} but live is ${live ? live.slice(0, 12) : "unknown"}`;
    appendLedger(ledger, { event: "probe-fail", sha: expect, live, why: msg });
    out.error(msg);
    if (o["alert-cmd"]) { try { execSync(o["alert-cmd"], { input: msg, stdio: ["pipe", "inherit", "inherit"] }); } catch { out.error("alert command failed"); } }
    return 5;
  }
  if (cmd === "tag") { const sha = resolveSha(repo, need("target")); out.log(`--tag g${sha.slice(0, 12)} --message sha=${sha}`); return 0; }
  out.error("usage: deploy-guard check|record|probe|tag (see file header)");
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exit(main(process.argv.slice(2))); } catch (e) { console.error(`deploy-guard: ${e.message}`); process.exit(2); }
}
