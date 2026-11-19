// Evidence lines for each server page, from fleet/evidence.json (written by the fleet's re-test run,
// fleet/evidence.mjs). Read at build time; a missing or unreadable file shows nothing.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkEvidence } from "@/lib/check-evidence.mjs";
import type { ServerResult } from "@/lib/results-shared";

let all: Record<string, unknown> | undefined;
export function checkEvidenceFor(server: ServerResult, held: boolean) {
  if (!all) {
    try { all = (JSON.parse(readFileSync(resolve(process.cwd(), "..", "fleet", "evidence.json"), "utf8")) as { servers?: Record<string, unknown> }).servers ?? {}; }
    catch { all = {}; }
  }
  if (!Object.prototype.hasOwnProperty.call(all, server.id)) return null;
  return checkEvidence(all[server.id], server, { held });
}
