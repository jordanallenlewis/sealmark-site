// Package facts for each server page, from fleet/server-facts.json (written by the fleet's re-test run,
// fleet/server-facts.mjs). Read at build time; a missing or unreadable file shows nothing.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { maintainerClaim, serverFacts } from "@/lib/server-facts.mjs";
import { BUILD_DATE } from "@/lib/results";

type Entry = Parameters<typeof serverFacts>[0];
let all: Record<string, NonNullable<Entry>> | undefined;
function load() {
  if (!all) {
    try { all = (JSON.parse(readFileSync(resolve(process.cwd(), "..", "fleet", "server-facts.json"), "utf8")) as { servers?: Record<string, NonNullable<Entry>> }).servers ?? {}; }
    catch { all = {}; }
  }
  return all;
}
export function serverFactsFor(server: { id: string; ecosystem: string; versionTested: string }, held: boolean) {
  const facts = load();
  if (!Object.prototype.hasOwnProperty.call(facts, server.id)) return null;
  return serverFacts(facts[server.id], server, { held, today: BUILD_DATE });
}
/** The Maintainer block's claim (sealmark-site#69): claimed, open to a claim, or null (always null for a held server). */
export function maintainerFor(server: { id: string }, held: boolean) {
  const facts = load();
  if (!Object.prototype.hasOwnProperty.call(facts, server.id)) return null;
  return maintainerClaim(facts[server.id], server, { held, today: BUILD_DATE });
}
