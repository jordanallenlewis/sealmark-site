// Fleet status page (site#59 slice 2): what the grading fleet has done, from the committed data only
// (content/data/server-results.json, fleet/history.jsonl through lib/history.ts, fleet/not-graded.json). Every date comes
// from the data, never the build clock, so the page says what the data says and an unchanged build is identical.
// Pure functions, no I/O: covered by lib/fleet-status.test.mjs.
import { STALE_AFTER_DAYS, gradeAgeDays } from "./grade-age.mjs";
import { reasonRows } from "./not-graded.mjs";

/** Days of runs shown, ending at the latest date in the data. A day counts each server once (lib/history.ts keeps its last
 * run that day), for graded servers and first tries alike. */
export const STATUS_DAYS = 14;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v) => (typeof v === "string" && DAY.test(v) && Number.isFinite(Date.parse(v)) ? v : null);
const minusDays = (d, n) => new Date(Date.parse(d) - n * 864e5).toISOString().slice(0, 10);

/**
 * @param {(x: any) => boolean} hasGrade the results pages' grade rule (lib/api-data.ts gradeOf is not null): a server with no
 *   tools to test has no grade even when an area has a letter
 * @param {any[] | undefined} servers ServerResult entries
 * @param {{ id: string, runs: { date: string, status: string }[] }[] | undefined} histories lib/history.ts loadHistory()
 * @param {{ count?: unknown, byReason?: Record<string, number> } | undefined} notGraded fleet/not-graded.json
 */
export function fleetStatus(hasGrade, servers, histories, notGraded) {
  const list = (Array.isArray(servers) ? servers : []).filter((x) => x && typeof x.id === "string");
  const hs = (Array.isArray(histories) ? histories : []).filter((h) => h && Array.isArray(h.runs));
  const tested = list.map((x) => day(x.testedAt)).filter(Boolean).sort();
  const runDays = hs.flatMap((h) => h.runs.map((r) => day(r?.date))).filter(Boolean);
  const latest = [...tested, ...runDays].sort().at(-1) ?? null;
  const graded = list.filter((x) => hasGrade(x)).length;
  // Same rule as a results page's age note (lib/grade-age.mjs): at most STALE_AFTER_DAYS whole days old is current.
  const fresh = latest ? list.filter((x) => { const a = gradeAgeDays(x.testedAt, latest); return a != null && a <= STALE_AFTER_DAYS; }).length : 0;
  const days = [];
  let retests = 0;
  if (latest) {
    for (let i = 0; i < STATUS_DAYS; i++) {
      const date = minusDays(latest, i);
      let ok = 0, failed = 0;
      for (const h of hs) for (const r of h.runs) {
        if (r?.date !== date) continue;
        if (r.status === "ok") ok++;
        else failed++;
      }
      retests += ok + failed;
      days.push({ date, graded: ok, failed });
    }
  }
  const count = Number.isInteger(notGraded?.count) && notGraded.count >= 0 ? notGraded.count : 0;
  return {
    listed: list.length,
    graded,
    fresh,
    // Rounded down: one grade out of date must never read as 100%.
    freshPct: list.length ? Math.floor((fresh / list.length) * 100) : null,
    staleAfter: STALE_AFTER_DAYS,
    latest,
    oldest: tested[0] ?? null,
    days,
    retests,
    notGraded: count,
    reasons: count ? reasonRows(notGraded?.byReason) : [],
  };
}
