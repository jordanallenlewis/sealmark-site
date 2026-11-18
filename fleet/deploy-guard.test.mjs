import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide, shaFromAnnotations, main, readLedger } from "./deploy-guard.mjs";

const A = "a".repeat(40), B = "b".repeat(40);
const fwd = () => true, back = () => false;

test("forward deploy allowed; same sha allowed", () => {
  assert.equal(decide({ live: A, target: B, isAncestor: fwd }).code, "forward");
  assert.equal(decide({ live: A, target: A, isAncestor: back }).code, "same");
});
test("older target denied", () => assert.equal(decide({ live: A, target: B, isAncestor: back }).allow, false));
test("rollback needs approval and reason", () => {
  assert.equal(decide({ live: A, target: B, isAncestor: back, rollback: true }).code, "rollback-unapproved");
  const d = decide({ live: A, target: B, isAncestor: back, rollback: true, approval: "ASK-1", reason: "500s" });
  assert.equal(d.allow, true);
  assert.equal(d.rollback, true);
});
test("fail closed on unknown live or non-sha target", () => {
  assert.equal(decide({ live: null, target: B, isAncestor: fwd }).allow, false);
  assert.equal(decide({ live: A, target: "HEAD", isAncestor: fwd }).allow, false);
});
test("sha from worker version annotations", () => {
  assert.equal(shaFromAnnotations({ "workers/message": `x sha=${A}` }), A);
  assert.equal(shaFromAnnotations({}), null);
});

// Drill: a real git repo; live is the newest commit; deploying the older one is refused on the CLI, with a ledger row.
test("drill: older version refused end to end, rollback only when logged, drift alerts", () => {
  const d = mkdtempSync(join(tmpdir(), "dg-"));
  const g = (...a) => execFileSync("git", ["-C", d, ...a], { encoding: "utf8" }).trim();
  g("init", "-q");
  g("config", "user.name", "t");
  g("config", "user.email", "t@example.com");
  writeFileSync(join(d, "f"), "1");
  g("add", ".");
  g("commit", "-qm", "one");
  const old = g("rev-parse", "HEAD");
  writeFileSync(join(d, "f"), "2");
  g("add", ".");
  g("commit", "-qm", "two");
  const live = g("rev-parse", "HEAD");
  const ledger = join(d, "ledger.jsonl");
  const quiet = { log() {}, error() {} };
  const base = ["--repo", d, "--ledger", ledger, "--live-cmd", `echo ${live}`];
  try {
    assert.equal(main(["check", ...base, "--target", old], quiet), 4, "older version refused");
    assert.equal(main(["check", ...base, "--target", old, "--rollback"], quiet), 4, "rollback without approval refused");
    assert.equal(main(["check", ...base, "--target", old, "--rollback", "--approval", "A-1", "--reason", "prod 500"], quiet), 0);
    assert.equal(main(["check", ...base, "--target", live], quiet), 0);
    assert.equal(main(["probe", "--repo", d, "--ledger", ledger, "--expect", live, "--live-cmd", `echo ${old}`, "--alert-cmd", `cat > ${d}/alert.txt`], quiet), 5, "drift detected");
    assert.match(readFileSync(`${d}/alert.txt`, "utf8"), /DRIFT/);
    assert.equal(main(["probe", "--repo", d, "--ledger", ledger, "--expect", live, "--live-cmd", `echo ${live}`], quiet), 0);
    const rows = readLedger(ledger);
    assert.ok(rows.some((r) => r.code === "not-forward") && rows.some((r) => r.rollback === true));
    assert.deepEqual(rows.map((r) => r.generation), rows.map((_, i) => i + 1), "generation is monotonic");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("the sha= parse is anchored: a longer hex run or a prefixed word is not a live sha", () => {
  assert.equal(shaFromAnnotations({ "workers/message": `sha=${A}${"c".repeat(8)}` }), null);
  assert.equal(shaFromAnnotations({ "workers/message": `notsha=${A}` }), null);
  assert.equal(shaFromAnnotations({ "workers/message": `deploy sha=${A}` }), A);
});
test("an unreadable live Worker is DENY even when the ledger has a deploy (the ledger is a log, not a source)", () => {
  const d = mkdtempSync(join(tmpdir(), "dg-nolive-"));
  const run = (...a) => execFileSync("git", ["-C", d, ...a], { encoding: "utf8" }).trim();
  const quiet = { log() {}, error() {} };
  try {
    run("init", "-q"); run("config", "user.email", "t@t"); run("config", "user.name", "t");
    writeFileSync(join(d, "f"), "1"); run("add", "."); run("commit", "-qm", "one"); const one = run("rev-parse", "HEAD");
    writeFileSync(join(d, "f"), "2"); run("commit", "-qam", "two"); const two = run("rev-parse", "HEAD");
    const ledger = join(d, "ledger.jsonl");
    assert.equal(main(["record", "--repo", d, "--ledger", ledger, "--target", one], quiet), 0);
    const bin = join(d, "bin"); execFileSync("mkdir", [bin]);
    writeFileSync(join(bin, "npx"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const saved = process.env.PATH; process.env.PATH = `${bin}:${saved}`;
    try { assert.equal(main(["check", "--repo", d, "--ledger", ledger, "--worker", "sealmark", "--target", two], quiet), 4); } finally { process.env.PATH = saved; }
  } finally { rmSync(d, { recursive: true, force: true }); }
});
