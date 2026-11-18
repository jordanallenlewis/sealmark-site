// The fleet's run log (site#63): one line per fleet run that merged reports, appended by fleet/merge.mjs to
// fleet/runs.jsonl, so the site can show how often the fleet really runs. GitHub starts scheduled runs late or skips them,
// so the cron line is not the cadence. `at` is when merge.mjs folded the reports in (shortly before the commit). The
// lines before 2026-11-18 were seeded from the times of the fleet's own result commits, matched to the workflow run that
// made each one (for its trigger), and carry no counts. `event` is GitHub's trigger: "schedule" or "workflow_dispatch" (by hand).
import fs from "node:fs";
import path from "node:path";

export const RUNS = path.join("fleet", "runs.jsonl");

const count = (n) => Number.isInteger(n) && n >= 0;

const EVENT = /^[a-z_]{1,40}$/;

/** @returns {{ at: string, event?: string, graded: number, failed: number, new: number } | null} null when the run merged no reports */
export function runRecord(at, { graded, failed, added }, event) {
  if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) return null;
  if (![graded, failed, added].every(count) || graded + failed === 0) return null;
  return { at, ...(typeof event === "string" && EVENT.test(event) ? { event } : {}), graded, failed, new: added };
}

export function appendRun(file, rec) {
  if (!rec) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(rec) + "\n");
}
