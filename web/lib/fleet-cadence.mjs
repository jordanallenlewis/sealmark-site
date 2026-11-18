// How often the fleet really runs (site#63), from fleet/runs.jsonl (fleet/runs.mjs): the runs that recorded results in
// the CADENCE_DAYS ending at the newest one, how many the schedule started and how many were started on request
// (workflow_dispatch; a line with another or no trigger counts in neither), and the gaps between scheduled runs (runs on
// request come in bursts and would hide how the schedule behaves). `from` is the day of the first run in the window. Dated by the data, never the build clock, so
// an unchanged build is identical. Pure: covered by lib/fleet-cadence.test.mjs.
export const CADENCE_DAYS = 14;
const HOUR = 36e5;

/**
 * @param {string | undefined} text the JSONL run log
 * @returns {import("./fleet-cadence.d.mts").FleetCadence | null}
 */
export function fleetCadence(text) {
  /** @type {Map<number, { at: string, scheduled: boolean, onRequest: boolean }>} */
  const seen = new Map();
  for (const raw of String(text ?? "").split("\n")) {
    let r;
    try { r = JSON.parse(raw); } catch { continue; }
    const t = typeof r?.at === "string" ? Date.parse(r.at) : NaN;
    if (Number.isFinite(t) && !seen.has(t)) seen.set(t, { at: r.at, scheduled: r.event === "schedule", onRequest: r.event === "workflow_dispatch" });
  }
  if (!seen.size) return null;
  const times = [...seen.keys()].sort((a, b) => a - b);
  const last = times.at(-1);
  const start = last - CADENCE_DAYS * 24 * HOUR;
  const inWindow = times.filter((t) => t >= start);
  const sched = inWindow.filter((t) => seen.get(t).scheduled);
  const gapsH = sched.slice(1).map((t, i) => Math.round((t - sched[i]) / HOUR));
  const sorted = [...gapsH].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return {
    runs: inWindow.length,
    scheduled: sched.length,
    onRequest: inWindow.filter((t) => seen.get(t).onRequest).length,
    lastAt: seen.get(last).at,
    from: new Date(inWindow[0]).toISOString().slice(0, 10),
    to: new Date(last).toISOString().slice(0, 10),
    gapsH,
    medianGapH: !sorted.length ? null : sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2),
    longestGapH: sorted.length ? sorted.at(-1) : null,
  };
}

/** The hours in the workflow's schedule when it is exactly one plain "M *\/N * * *" line, else null (say nothing rather than guess). */
export function scheduledHours(workflowText) {
  const crons = [...String(workflowText ?? "").matchAll(/^\s*-\s*cron:\s*["']([^"']+)["']/gm)].map((m) => m[1].trim());
  if (crons.length !== 1) return null;
  const m = /^\d{1,2} \*\/(\d{1,2}) \* \* \*$/.exec(crons[0]);
  return m ? Number(m[1]) : null;
}
