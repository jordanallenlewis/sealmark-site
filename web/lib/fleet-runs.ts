// The fleet's real cadence for /status/ (site#63): fleet/runs.jsonl (appended by fleet/merge.mjs) and the schedule line in
// .github/workflows/fleet.yml, read at build time. A missing file means nothing is shown, never a guess.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fleetCadence, scheduledHours, type FleetCadence } from "@/lib/fleet-cadence.mjs";

const read = (...p: string[]) => { try { return readFileSync(resolve(process.cwd(), "..", ...p), "utf8"); } catch { return undefined; } };

export function loadCadence(): { cadence: FleetCadence | null; everyH: number | null } {
  return { cadence: fleetCadence(read("fleet", "runs.jsonl")), everyH: scheduledHours(read(".github", "workflows", "fleet.yml")) };
}
