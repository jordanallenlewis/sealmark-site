import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readLedger } from "./deploy-guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// Drill (the acceptance test of the forward-only deploy): in a throwaway repo, the real fleet/guarded-deploy.sh is run
// against a stub "wrangler" with the live commit read from a file. An older commit must be refused before anything
// deploys; a newer one deploys, is stamped with its commit and recorded; a deploy that does not become live alerts.
test("drill: guarded-deploy refuses an older commit, ships a newer one, alerts on drift", () => {
  const d = mkdtempSync(join(tmpdir(), "gd-"));
  const g = (...a) => execFileSync("git", ["-C", d, ...a], { encoding: "utf8" }).trim();
  try {
    g("init", "-q"); g("config", "user.name", "t"); g("config", "user.email", "t@example.com");
    mkdirSync(join(d, "fleet"));
    copyFileSync(join(here, "deploy-guard.mjs"), join(d, "fleet/deploy-guard.mjs"));
    copyFileSync(join(here, "guarded-deploy.sh"), join(d, "fleet/guarded-deploy.sh"));
    const commit = (n) => { writeFileSync(join(d, "f"), n); g("add", "."); g("commit", "-qm", n); return g("rev-parse", "HEAD"); };
    const old = commit("1"); const live = commit("2"); const next = commit("3");
    const liveFile = join(d, "live.txt"); const deployed = join(d, "deployed.txt");
    const run = (head, { liveNow, deploys = true, sleepless = true }) => {
      g("checkout", "-q", head);
      writeFileSync(liveFile, liveNow);
      return spawnSync("bash", [join(d, "fleet/guarded-deploy.sh")], {
        cwd: d, encoding: "utf8", timeout: 120000,
        env: { ...process.env, GUARD_LEDGER: join(d, "ledger.jsonl"), GUARD_PROBE_WAIT: "0", GUARD_LIVE_CMD: `cat ${liveFile}`,
          // the stub deploy writes the flags it was given, and (when it works) makes the shipped commit live
          GUARD_DEPLOY_CMD: deploys ? `f() { echo "$*" > ${deployed}; echo "$4" | sed 's/^sha=//' > ${liveFile}; }; f` : `f() { echo "$*" > ${deployed}; }; f` },
      });
    };
    // 1. an older commit than live: refused (exit 4), nothing deployed
    let r = run(old, { liveNow: live });
    assert.equal(r.status, 4, r.stderr);
    assert.match(r.stderr, /DENY \(not-forward\)/);
    assert.equal(existsSync(deployed), false, "an older commit never reaches the deploy command");
    // 2. a newer commit: deployed, stamped with its commit, recorded, live == shipped
    r = run(next, { liveNow: live });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(readFileSync(deployed, "utf8"), new RegExp(`--tag g${next.slice(0, 12)} --message sha=${next}`));
    const rows = readLedger(join(d, "ledger.jsonl"));
    assert.ok(rows.some((x) => x.event === "deployed" && x.sha === next) && rows.some((x) => x.event === "probe-ok"));
    // 3. unknown live (an unstamped Worker): refused, fail closed
    r = run(next, { liveNow: "unknown" });
    assert.equal(r.status, 4);
    assert.match(r.stderr, /DENY \(bad-live\)/);
    // 4. the deploy "succeeds" but the new version never becomes live: exit 5 and a DRIFT error annotation
    r = run(next, { liveNow: live, deploys: false });
    assert.equal(r.status, 5, r.stderr + r.stdout);
    assert.match(r.stdout, /::error::deploy-guard DRIFT: intended /);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
