// plan.mjs picks a server whose grade is STALE_DAYS old (default 5): the site's oldest-grade invariant is "< 7 days",
// so a re-test has to start before it is red. Runs plan.mjs in a scratch folder with the network stubbed out.
// Run from the repository root: node --test fleet/plan-stale.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const plan = path.join(here, "plan.mjs");

function planned(ageDays) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-stale-"));
  try {
    fs.mkdirSync(path.join(dir, "web/content/data"), { recursive: true });
    fs.mkdirSync(path.join(dir, "fleet"));
    fs.writeFileSync(path.join(dir, "preload.mjs"), "globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });\n");
    const testedAt = new Date(Date.now() - ageDays * 86400000).toISOString();
    const server = { id: "x", name: "x", ecosystem: "other", launch: "npx -y x", versionTested: "1.0.0", testedAt };
    fs.writeFileSync(path.join(dir, "web/content/data/server-results.json"), JSON.stringify({ servers: [server] }));
    execFileSync(process.execPath, ["--import", path.join(dir, "preload.mjs"), plan], {
      cwd: dir,
      env: { PATH: process.env.PATH, MAX_NEW: "0", TARGET_TOTAL: "0" },
      stdio: "pipe",
    });
    return JSON.parse(fs.readFileSync(path.join(dir, "fleet-plan.json"), "utf8")).jobs.map((j) => j.id);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("a grade 5 days old is due", () => {
  assert.deepEqual(planned(5.1), ["x"]);
});

test("a grade 4 days old is not due", () => {
  assert.deepEqual(planned(4), []);
});
